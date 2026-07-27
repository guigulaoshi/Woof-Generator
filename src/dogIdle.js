import * as THREE from 'three';

const _fallback = new THREE.Vector3();

/**
 * 小狗的待机动作：摇尾巴 + 耳朵抖动。
 *
 * 摇尾巴是狗待机时的主角，不是背景噪声，所以三处都得给足：
 *   - 幅度 0.5rad：不是慢悠悠地扫，是真的在摇
 *   - 频率 ~2.2Hz，并叠一层慢波让节奏不机械
 *   - 开关做成能量值而不是 0/1 开关：直接切会让尾巴瞬间弹回原位，
 *     看起来就像按钮没生效；这里让它在 0.35 秒里平滑收尾。
 */
export function createDogIdleState({
  tailPivot = _fallback,
  earLeftPivot = _fallback,
  earRightPivot = _fallback,
} = {}) {
  return {
    uniforms: {
      uWagTime: { value: 0 },
      uWagEnergy: { value: 1 },
      uTailPivot: { value: tailPivot.clone() },
      uEarLeftPivot: { value: earLeftPivot.clone() },
      uEarRightPivot: { value: earRightPivot.clone() },
    },
    energy: 1,
    lastSample: { enabled: true, tailAngle: 0, leftEarAngle: 0, rightEarAngle: 0 },
  };
}

const DECLARATIONS = `
attribute vec3 idleRegion;
attribute float idleTailU;
uniform float uWagTime;
uniform float uWagEnergy;
uniform vec3 uTailPivot;
uniform vec3 uEarLeftPivot;
uniform vec3 uEarRightPivot;

vec2 dogIdleRotate(vec2 point, float angle) {
  float sine = sin(angle);
  float cosine = cos(angle);
  return mat2(cosine, -sine, sine, cosine) * point;
}
`;

const TRANSFORM = `
{
  float energy = clamp(uWagEnergy, 0.0, 1.0);

  // 尾巴：快摇为主、慢摆为辅，尾梢比尾根摆得多
  float wag = sin(uWagTime * 13.8) * 0.74 + sin(uWagTime * 4.3 + 0.9) * 0.26;
  float tip = smoothstep(0.0, 0.62, idleTailU);
  float tailAngle = wag * 0.5 * idleRegion.x * tip * energy;
  vec3 tailPoint = transformed - uTailPivot;
  tailPoint.xz = dogIdleRotate(tailPoint.xz, tailAngle);
  transformed = uTailPivot + tailPoint;
  // 摇到两端时尾巴会被自己甩得往上弹一下
  transformed.y +=
    abs(sin(uWagTime * 13.8)) * 0.03 * idleRegion.x * tip * energy;

  // 耳朵：低频轻抖，偶尔来一下快的，像被声音惊到
  float earTwitch = sin(uWagTime * 1.7) * 0.55
    + pow(max(sin(uWagTime * 0.63), 0.0), 12.0) * 1.6;
  float leftEarAngle = earTwitch * 0.075 * idleRegion.y * energy;
  vec3 leftEarPoint = transformed - uEarLeftPivot;
  leftEarPoint.xy = dogIdleRotate(leftEarPoint.xy, leftEarAngle);
  leftEarPoint.yz = dogIdleRotate(leftEarPoint.yz, leftEarAngle * 0.34);
  transformed = uEarLeftPivot + leftEarPoint;

  float rightEarAngle = -earTwitch * 0.075 * idleRegion.z * energy;
  vec3 rightEarPoint = transformed - uEarRightPivot;
  rightEarPoint.xy = dogIdleRotate(rightEarPoint.xy, rightEarAngle);
  rightEarPoint.yz = dogIdleRotate(rightEarPoint.yz, rightEarAngle * 0.34);
  transformed = uEarRightPivot + rightEarPoint;
}
`;

export function injectDogIdle(material, state) {
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    if (previousCompile) previousCompile(shader, renderer);
    Object.assign(shader.uniforms, state.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DECLARATIONS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TRANSFORM}`);
  };
  material.customProgramCacheKey = () => `${previousCacheKey?.() ?? ''}|dog-idle-v1`;
  return material;
}

export function updateDogIdle(state, time, delta, enabled = true) {
  // 能量按指数逼近目标值：停下来时尾巴是慢慢摆停的，不是"啪"一下归位
  const target = enabled ? 1 : 0;
  state.energy += (target - state.energy) * (1 - Math.exp(-delta * 6));
  if (Math.abs(state.energy - target) < 0.002) state.energy = target;
  state.uniforms.uWagTime.value = time;
  state.uniforms.uWagEnergy.value = state.energy;

  const wag = Math.sin(time * 13.8) * 0.74 + Math.sin(time * 4.3 + 0.9) * 0.26;
  const earTwitch = Math.sin(time * 1.7) * 0.55
    + Math.pow(Math.max(Math.sin(time * 0.63), 0), 12) * 1.6;
  state.lastSample = {
    enabled: state.energy > 0.01,
    tailAngle: wag * 0.5 * state.energy,
    leftEarAngle: earTwitch * 0.075 * state.energy,
    rightEarAngle: -earTwitch * 0.075 * state.energy,
  };
  return state.lastSample;
}
