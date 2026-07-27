import * as THREE from 'three';

/**
 * 软体抓捏形变系统。
 * 每个"抓点"= 世界坐标锚点 + 三维偏移向量：
 *   - 戳：偏移沿视线压进去
 *   - 捏脸颊：偏移跟随鼠标左右扯（外部负责限幅）
 *   - 提后颈：皮肤局部上提（整体位移由 main 负责）
 * 顶点着色器里以锚点为中心做高斯衰减位移 + 法线方向的体积挤出环；
 * 五官等独立小件由 JS 侧用同一公式计算偏移，保证不陷进模型。
 * 松手后偏移向量做欠阻尼弹簧回零（果冻回弹）。
 */

export const MAX_POKES = 6;

export const pokeUniforms = {
  uPokePos: { value: Array.from({ length: MAX_POKES }, () => new THREE.Vector3(0, -99, 0)) },
  uPokeOff: { value: Array.from({ length: MAX_POKES }, () => new THREE.Vector3()) },
  uPokeRadius: { value: 0.42 },
};

const GLSL_DECL = `
uniform vec3 uPokePos[${MAX_POKES}];
uniform vec3 uPokeOff[${MAX_POKES}];
uniform float uPokeRadius;
`;

// 角色组只有整体平移/缩放，形变在 object space 做即可；normal 属性所有内置材质都有
const GLSL_APPLY = `
for (int pi = 0; pi < ${MAX_POKES}; pi++) {
  float amp = length(uPokeOff[pi]);
  if (amp < 1e-4) continue;
  float pd = distance(transformed, uPokePos[pi]);
  float r = uPokeRadius;
  float dent = exp(-(pd * pd) / (r * r));
  float bodyDrag = exp(-(pd * pd) / (r * r * 4.2));
  float ring = exp(-pow(pd - r * 1.7, 2.0) / (r * r * 0.62));
  transformed += uPokeOff[pi] * dent;
  transformed += uPokeOff[pi] * (bodyDrag * 0.24);
  transformed += normal * (amp * 0.34 * ring);
}
`;

// 往任意 three 内置材质的顶点着色器里注入形变
export function injectPoke(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, pokeUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GLSL_APPLY}`);
  };
  material.customProgramCacheKey = () => 'poke';
  return material;
}

// JS 侧同款位移（五官小件用）。normalDir 传小件的表面外法线以获得挤出环项，
// 缺省可传 null 只算主凹陷。
export function pokeOffsetAt(point, normalDir, out) {
  out.set(0, 0, 0);
  const r = pokeUniforms.uPokeRadius.value;
  for (let i = 0; i < MAX_POKES; i++) {
    const off = pokeUniforms.uPokeOff.value[i];
    const amp = off.length();
    if (amp < 1e-4) continue;
    const d = point.distanceTo(pokeUniforms.uPokePos.value[i]);
    const dent = Math.exp(-(d * d) / (r * r));
    out.addScaledVector(off, dent);
    const bodyDrag = Math.exp(-(d * d) / (r * r * 4.2));
    out.addScaledVector(off, bodyDrag * 0.24);
    if (normalDir) {
      const ring = Math.exp(-((d - r * 1.7) ** 2) / (r * r * 0.62));
      out.addScaledVector(normalDir, amp * 0.34 * ring);
    }
  }
  return out;
}

// ---------------------------------------------------------------- 弹簧手感
export const pokeFeel = {
  maxDepth: 0.15,  // 戳的力度：按到底的凹陷深度
  freq: 4.2,       // 软硬：回弹振荡频率 Hz（越高越"硬"）
  damping: 0.075,  // Q 弹：阻尼比（越小抖越久）
};

const slots = Array.from({ length: MAX_POKES }, () => ({
  active: false, pressing: false,
  off: new THREE.Vector3(), vel: new THREE.Vector3(), target: new THREE.Vector3(),
}));
const pulseDirection = new THREE.Vector3();
const springAcceleration = new THREE.Vector3();

function quietestSlot() {
  return slots.find((s) => !s.active)
    ?? slots.reduce((a, b) => (
      a.off.lengthSq() + a.vel.lengthSq() < b.off.lengthSq() + b.vel.lengthSq()
        ? a
        : b
    ));
}

function activateSlot(slot, point, pressing) {
  const i = slots.indexOf(slot);
  slot.active = true;
  slot.pressing = pressing;
  slot.target.set(0, 0, 0);
  pokeUniforms.uPokePos.value[i].copy(point);
  return i;
}

export function beginGrab(point) {
  return activateSlot(quietestSlot(), point, true);
}

/**
 * Immediate rua feedback for taps and fast strokes.
 * Nearby repeated impacts reuse the same spring and accumulate energy, while
 * hard limits keep rapid clicking from tearing the surface apart.
 */
export function pulsePoke(point, inwardDirection, strength = 1) {
  const reuseDistanceSq = (pokeUniforms.uPokeRadius.value * 0.62) ** 2;
  let slot = slots.find((candidate, index) => (
    candidate.active
    && !candidate.pressing
    && pokeUniforms.uPokePos.value[index].distanceToSquared(point) < reuseDistanceSq
  ));
  const reusing = !!slot;
  slot ??= quietestSlot();
  const i = slots.indexOf(slot);
  if (reusing) {
    slot.active = true;
    slot.pressing = false;
    slot.target.set(0, 0, 0);
    pokeUniforms.uPokePos.value[i].lerp(point, 0.45);
  } else {
    activateSlot(slot, point, false);
  }

  const direction = pulseDirection.copy(inwardDirection);
  if (direction.lengthSq() < 1e-6) direction.set(0, 0, -1);
  else direction.normalize();

  const impact = pokeFeel.maxDepth * THREE.MathUtils.clamp(
    0.72 + strength * 0.45,
    0.68,
    1.65
  );
  if (reusing) {
    slot.off.addScaledVector(direction, impact * 0.62);
    slot.vel.addScaledVector(direction, impact * pokeFeel.freq * 2.2);
  } else {
    slot.off.copy(direction).multiplyScalar(impact);
    slot.vel.copy(direction).multiplyScalar(impact * pokeFeel.freq * 1.65);
  }

  const maxOffset = pokeFeel.maxDepth * 2.05;
  const maxVelocity = pokeFeel.maxDepth * pokeFeel.freq * 4.8;
  if (slot.off.length() > maxOffset) slot.off.setLength(maxOffset);
  if (slot.vel.length() > maxVelocity) slot.vel.setLength(maxVelocity);
  pokeUniforms.uPokeOff.value[i].copy(slot.off);
  return i;
}

export function setGrabPoint(i, point) {
  if (i < 0 || !slots[i].active) return;
  pokeUniforms.uPokePos.value[i].copy(point);
}

export function setGrabTarget(i, targetOffset) {
  if (i < 0 || !slots[i].active) return;
  slots[i].target.copy(targetOffset);
}

export function endGrab(i) {
  if (i < 0) return;
  slots[i].pressing = false;
}

export function updatePokes(dt) {
  dt = Math.min(dt, 1 / 30);
  const w = 2 * Math.PI * pokeFeel.freq;
  for (let i = 0; i < MAX_POKES; i++) {
    const s = slots[i];
    if (!s.active) continue;
    if (s.pressing) {
      // 跟手：快速趋近目标，不振荡
      s.off.lerp(s.target, Math.min(1, dt * 16));
      s.vel.set(0, 0, 0);
    } else {
      // 欠阻尼向量弹簧回零
      springAcceleration
        .copy(s.off)
        .multiplyScalar(-w * w)
        .addScaledVector(s.vel, -2 * pokeFeel.damping * w);
      s.vel.addScaledVector(springAcceleration, dt);
      s.off.addScaledVector(s.vel, dt);
      if (s.off.lengthSq() < 2.5e-7 && s.vel.lengthSq() < 2.5e-5) {
        s.active = false;
        s.off.set(0, 0, 0);
        s.vel.set(0, 0, 0);
        pokeUniforms.uPokePos.value[i].set(0, -99, 0);
      }
    }
    pokeUniforms.uPokeOff.value[i].copy(s.off);
  }
}

export function anyPokeActive() {
  return slots.some((s) => s.active);
}
