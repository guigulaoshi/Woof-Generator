// 三渲二表面工具箱：色阶、反壳描边、SDF 表面贴花。
// 这些函数只依赖 SDF 图元数组，不含任何物种专属的解剖假设。

import * as THREE from 'three';
import { evalField } from './sdf.js';
import { injectPoke } from './softPoke.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);


// 二次元硬二分色阶：亮面 / 暗面两档，NearestFilter 保证边界干脆
let _gradientMap = null;
export function toonGradientMap() {
  if (!_gradientMap) {
    // 暗阶只做很轻的底衬，主要的暗面颜色由 hatch.js 的 uShadeColor/uShadeAlpha 控制（可调）
    const data = new Uint8Array([232, 255]);
    _gradientMap = new THREE.DataTexture(data, 2, 1, THREE.RedFormat);
    _gradientMap.minFilter = THREE.NearestFilter;
    _gradientMap.magFilter = THREE.NearestFilter;
    _gradientMap.needsUpdate = true;
  }
  return _gradientMap;
}

// 反向外壳描边：顶点沿法线外扩、背面渲染。
// jitter 用多频正弦噪声扰动外扩厚度，模仿手绘线的粗细呼吸感。
export function makeOutline(
  geo,
  thickness = 0.011,
  color = '#4a3428',
  jitter = 0,
  // 描边也要跟着待机动画一起形变，否则轮廓线会留在原地。
  // 具体怎么动由调用方决定，这个模块不关心。
  injectIdle = null
) {
  // The outline only needs the surface plus attributes that actually deform
  // it. Cloning the whole fur geometry copied all dynamic-coat buffers (and,
  // before this optimization, every rig buffer) a second time on each rebuild.
  const og = new THREE.BufferGeometry();
  og.setAttribute('position', geo.getAttribute('position').clone());
  og.setAttribute('normal', geo.getAttribute('normal').clone());
  if (geo.index) og.setIndex(geo.index.clone());
  for (const name of [
    'idleRegion',
    'idleTailU',
    'rigPart',
    'rigInfluence',
    'rigTailU',
    'rigLegId',
    'rigLegU',
    'rigLegBlend',
    'rigLegCoord',
  ]) {
    const attribute = geo.getAttribute(name);
    if (attribute) og.setAttribute(name, attribute.clone());
  }
  const op = og.getAttribute('position');
  const on = og.getAttribute('normal');
  const rigInfluence = og.getAttribute('rigInfluence');
  const rigLegU = og.getAttribute('rigLegU');
  for (let i = 0; i < op.count; i++) {
    const x = op.getX(i), y = op.getY(i), z = op.getZ(i);
    let t = thickness;
    if (jitter > 0) {
      const n =
        Math.sin(x * 61.7 + y * 43.1) * 0.5 +
        Math.sin(y * 57.3 + z * 39.7) * 0.3 +
        Math.sin(z * 71.9 + x * 33.3) * 0.2;
      t = thickness * (1 + jitter * 1.6 * n);
    }
    if (rigInfluence) {
      const bodyWeight = rigInfluence.getX(i);
      const headWeight = rigInfluence.getY(i);
      const legWeight = rigInfluence.getZ(i);
      const tailWeight = rigInfluence.getW(i);
      const dominance = Math.max(bodyWeight, headWeight, legWeight, tailWeight);
      // The inverted-hull outline can turn inside-out at a heavily blended
      // SDF joint. Thin the shell only in those transition zones; the outer
      // silhouette remains fully outlined.
      const transitionKeep = THREE.MathUtils.clamp(
        (dominance - 0.42) / 0.42,
        0,
        1
      );
      t *= THREE.MathUtils.lerp(0.18, 1, transitionKeep);
      if (legWeight > 0.42 && rigLegU && rigLegU.getX(i) >= 0) {
        const kneeDistance = Math.abs(rigLegU.getX(i) - 0.52);
        const kneeKeep = THREE.MathUtils.clamp((kneeDistance - 0.07) / 0.22, 0, 1);
        t *= THREE.MathUtils.lerp(0.22, 1, kneeKeep);
      }
    }
    op.setXYZ(
      i,
      x + on.getX(i) * t,
      Math.max(y + on.getY(i) * t, 0.002), // 不越过地面，避免贴地露白
      z + on.getZ(i) * t
    );
  }
  op.needsUpdate = true;
  let material = injectPoke(new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }));
  if (injectIdle) material = injectIdle(material);
  const mesh = new THREE.Mesh(og, material);
  mesh.name = 'outline';
  return mesh;
}
// 支持反向边界（e0 > e1）的 smoothstep
export const sstep = (e0, e1, x) => {
  let t = (x - e0) / (e1 - e0);
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

// 从 origin 沿 dir 用二分法找 SDF 真实表面（平滑融合会把表面推出理想椭球，
// 眼睛等贴脸件必须贴真实表面，否则会被姿势相关的鼓包吞掉）
export function surfaceAlong(prims, origin, dir, tMin, tMax) {
  let a = tMin, b = tMax;
  const p = new THREE.Vector3();
  for (let i = 0; i < 26; i++) {
    const m = (a + b) / 2;
    p.copy(origin).addScaledVector(dir, m);
    if (evalField(prims, p.x, p.y, p.z) < 0) a = m;
    else b = m;
  }
  return origin.clone().addScaledVector(dir, (a + b) / 2);
}

export function surfaceNormal(prims, point, eps = 0.003) {
  const gx = evalField(prims, point.x + eps, point.y, point.z) - evalField(prims, point.x - eps, point.y, point.z);
  const gy = evalField(prims, point.x, point.y + eps, point.z) - evalField(prims, point.x, point.y - eps, point.z);
  const gz = evalField(prims, point.x, point.y, point.z + eps) - evalField(prims, point.x, point.y, point.z - eps);
  return V(gx, gy, gz).normalize();
}

export function wateryContour(radius, amount, innerSide, phase = 0) {
  const points = [];
  const count = 160;
  const a = THREE.MathUtils.clamp(amount, 0, 2);
  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    const cx = Math.cos(theta);
    const cy = Math.sin(theta);
    const lower = Math.max(0, -cy);
    const inner = Math.max(0, cx * innerSide);
    const wobble = a * (
      Math.sin(theta * 2 + innerSide * 0.8 + phase * 0.42) * 0.065 +
      Math.sin(theta * 3 - innerSide * 0.55 + phase) * 0.055 +
      Math.sin(theta * 5 + innerSide * 0.35 - phase * 0.72) * 0.036 +
      Math.sin(theta * 7 - phase * 1.18) * 0.022 +
      Math.sin(theta * 11 + innerSide * 0.9 + phase * 0.28) * 0.012
    );
    const radial = 1 + wobble - a * inner * lower * 0.09;
    const taper = 1 - a * lower * 0.1;
    const lowerPull = a * Math.pow(lower, 1.72) * 0.31;
    const sideAsymmetry = a * Math.sin(theta * 2 + innerSide * 0.9 + phase * 0.55) * 0.032;
    points.push(V(
      radius * (cx * radial * taper + innerSide * lower * a * 0.025),
      radius * (cy * radial - lowerPull + sideAsymmetry),
      0
    ));
  }
  return points;
}

export function traceContour(ctx, contour, yOffset = 0, yScale = 1) {
  ctx.beginPath();
  ctx.moveTo(contour[0].x, -contour[0].y * yScale + yOffset);
  for (let i = 1; i < contour.length; i++) {
    ctx.lineTo(contour[i].x, -contour[i].y * yScale + yOffset);
  }
  ctx.closePath();
}

export function createEyeTexture(irisColor, irisRatio, wateryAmount, innerSide) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;

  const a = THREE.MathUtils.clamp(wateryAmount, 0, 2);
  let staticDrawn = false;
  let lastGazeX = Number.POSITIVE_INFINITY;
  let lastGazeY = Number.POSITIVE_INFINITY;
  const draw = (time = 0, gazeX = 0, gazeY = 0) => {
    const gazeLength = Math.hypot(gazeX, gazeY);
    if (gazeLength > 1) {
      gazeX /= gazeLength;
      gazeY /= gazeLength;
    }
    if (
      a === 0 &&
      staticDrawn &&
      Math.abs(gazeX - lastGazeX) < 0.004 &&
      Math.abs(gazeY - lastGazeY) < 0.004
    ) return;
    lastGazeX = gazeX;
    lastGazeY = gazeY;

    const phase = time * 5.8 + innerSide * 0.8;
    const shake = Math.min(a, 1.6) / 1.6;
    const shakeX = Math.sin(time * 8.2 + innerSide) * 7.5 * shake;
    const shakeY = Math.sin(time * 10.4 + innerSide * 1.7) * 5.5 * shake;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(2, 2);
    ctx.translate(128 + shakeX, 128 + shakeY);

    // 外眼也参与泪眼形变，但振幅低于虹膜，保持眼眶的整体稳定感。
    const eyeContour = wateryContour(104, a * 0.42, innerSide, phase * 0.55);
    traceContour(ctx, eyeContour, 0, 1.07);
    ctx.fillStyle = '#fffdf8';
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#4a3428';
    ctx.stroke();

    const irisRadius = 104 * irisRatio;
    const gazeRoom = Math.max(7, (104 - irisRadius) * 0.72);
    ctx.save();
    ctx.translate(gazeX * gazeRoom, -gazeY * gazeRoom * 0.82);
    const contour = wateryContour(irisRadius, a * 0.76, innerSide, phase);
    traceContour(ctx, contour, 4);
    ctx.fillStyle = irisColor;
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#4a3428';
    ctx.stroke();

    const highlightScale = 0.85 + a * 0.055;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(22, -24, 16 * highlightScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-18, 24, 7 * highlightScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.restore();
    texture.needsUpdate = true;
    staticDrawn = true;
  };

  draw(0);
  return { texture, draw };
}

export function makeSurfacePatch(
  prims, headC, centerDir, width, height, depth, segments = 18,
  // 贴片的"上"方向。不给的话就从世界轴推，但那样左右两只眼睛的
  // centerDir 不同，正交化出来的面内旋转也不同——两只眼睛会各歪各的，
  // 头一旦再歪一下就彻底不对称了。所以脸上的贴片必须显式传头的 up。
  upHint = null
) {
  let tangentY;
  let tangentX;
  if (upHint) {
    tangentY = upHint.clone().addScaledVector(centerDir, -upHint.dot(centerDir));
    if (tangentY.lengthSq() < 1e-8) tangentY = V(0, 1, 0);
    tangentY.normalize();
    tangentX = new THREE.Vector3().crossVectors(tangentY, centerDir).normalize();
  } else {
    // 没有给参考方向时退回世界轴：挑一根和投影方向最不平行的，
    // 避免投影方向正好沿着该轴时相减得到零向量、整片 decal 变成 NaN。
    const reference = Math.abs(centerDir.x) < 0.9 ? V(1, 0, 0) : V(0, 0, 1);
    tangentX = reference.addScaledVector(centerDir, -reference.dot(centerDir)).normalize();
    tangentY = centerDir.clone().cross(tangentX).normalize();
  }
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let y = 0; y <= segments; y++) {
    const v = y / segments;
    for (let x = 0; x <= segments; x++) {
      const u = x / segments;
      const target = headC.clone()
        .addScaledVector(centerDir, depth)
        .addScaledVector(tangentX, (u - 0.5) * width)
        .addScaledVector(tangentY, (v - 0.5) * height);
      const ray = target.sub(headC).normalize();
      const point = surfaceAlong(prims, headC, ray, depth * 0.25, depth * 2.6);
      const normal = surfaceNormal(prims, point);
      point.addScaledVector(normal, 0.0025);
      positions.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(u, v);
    }
  }

  const stride = segments + 1;
  for (let y = 0; y < segments; y++) {
    for (let x = 0; x < segments; x++) {
      const a = x + y * stride;
      const b = a + 1;
      const c = a + stride + 1;
      const d = a + stride;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export function makeEyeDecal(
  prims, headC, centerDir, eyeR, irisColor, irisRatio, wateryAmount, innerSide,
  // 眼睛的画法和贴片长宽比由调用方给：狗是横向的杏仁形眼裂。
  { painter = createEyeTexture, widthScale = 2.48, heightScale = 2.58, upHint = null } = {}
) {
  const center = surfaceAlong(prims, headC, centerDir, eyeR, eyeR * 8);
  const painterInstance = painter(irisColor, irisRatio, wateryAmount, innerSide);
  const geometry = makeSurfacePatch(
    prims,
    headC,
    centerDir,
    eyeR * widthScale,
    eyeR * heightScale,
    center.distanceTo(headC),
    28,
    upHint
  );
  const material = injectPoke(new THREE.MeshBasicMaterial({
    map: painterInstance.texture,
    transparent: true,
    alphaTest: 0.025,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  }));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = innerSide < 0 ? 'eyeDecalLeft' : 'eyeDecalRight';
  mesh.renderOrder = 4;
  mesh.userData.eyeAnimator = painterInstance.draw;
  mesh.userData.skipPokeSync = true;
  return mesh;
}

export function makeDecalTexture(draw) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  draw(ctx, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

export function makeSurfaceDecal(geometry, texture, name, renderOrder = 3, alphaTest = 0.025) {
  const material = injectPoke(new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  }));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.renderOrder = renderOrder;
  mesh.userData.skipPokeSync = true;
  return mesh;
}

export function makeEarSurfacePatch(prims, ear, segments = 14) {
  const side = V(1, 0, 0).addScaledVector(ear.dir, -ear.dir.x).normalize();
  const front = V(0, 0, 1).addScaledVector(ear.dir, -ear.dir.z).normalize();
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let y = 0; y <= segments; y++) {
    const v = y / segments;
    const t = THREE.MathUtils.lerp(0.38, 0.93, v);
    const radius = THREE.MathUtils.lerp(ear.r1, ear.r2, t);
    for (let x = 0; x <= segments; x++) {
      const u = x / segments;
      const interior = ear.a.clone()
        .addScaledVector(ear.dir, ear.len * t)
        .addScaledVector(side, (u - 0.5) * radius * 1.08);
      const point = surfaceAlong(prims, interior, front, 0, radius * 2.7 + 0.1);
      const normal = surfaceNormal(prims, point);
      point.addScaledVector(normal, 0.0028);
      positions.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(u, v);
    }
  }

  const stride = segments + 1;
  for (let y = 0; y < segments; y++) {
    for (let x = 0; x < segments; x++) {
      const a = x + y * stride;
      const b = a + 1;
      const c = a + stride + 1;
      const d = a + stride;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export function makeInnerEarDecal(prims, ear, withIdleAttributes = false) {
  const texture = makeDecalTexture((ctx) => {
    ctx.clearRect(0, 0, 256, 256);
    const path = new Path2D();
    path.moveTo(128, 26);
    path.quadraticCurveTo(141, 31, 151, 54);
    path.lineTo(221, 202);
    path.quadraticCurveTo(232, 229, 201, 231);
    path.lineTo(55, 231);
    path.quadraticCurveTo(24, 229, 35, 202);
    path.lineTo(105, 54);
    path.quadraticCurveTo(115, 31, 128, 26);
    path.closePath();

    const wash = ctx.createLinearGradient(128, 24, 128, 232);
    wash.addColorStop(0, 'rgba(250, 207, 205, 0.66)');
    wash.addColorStop(0.55, 'rgba(241, 184, 189, 0.58)');
    wash.addColorStop(1, 'rgba(226, 143, 154, 0.42)');

    // 先铺大范围晕染，再补一层低透明主体；保留圆角三角轮廓但不出现硬描边。
    ctx.save();
    ctx.filter = 'blur(14px)';
    ctx.fillStyle = wash;
    ctx.fill(path);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.filter = 'blur(5px)';
    ctx.fillStyle = wash;
    ctx.fill(path);
    ctx.restore();
  });
  const geometry = makeEarSurfacePatch(prims, ear);
  if (withIdleAttributes) {
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const idleRegion = new Float32Array(position.count * 3);
    const idleTailU = new Float32Array(position.count);
    const component = ear.side < 0 ? 1 : 2;
    for (let index = 0; index < position.count; index++) {
      const v = uv.getY(index);
      const weight = v * v * (3 - 2 * v);
      idleRegion[index * 3 + component] = weight;
    }
    geometry.setAttribute('idleRegion', new THREE.BufferAttribute(idleRegion, 3));
    geometry.setAttribute('idleTailU', new THREE.BufferAttribute(idleTailU, 1));
  }
  return makeSurfaceDecal(
    geometry,
    texture,
    ear.side < 0 ? 'innerEarDecalLeft' : 'innerEarDecalRight',
    3,
    0.004
  );
}

// 炸毛：沿法线按多频噪声把表面顶点顶出去，脸周围保留干净。
// lengthScale 让不同体量的角色用同一个「炸毛程度」数值得到相当的观感。
export function applyFluffGeometry(
  geometry,
  amount,
  seed,
  headC,
  hr,
  lengthScale = 1,
  faceScale = 1,
  noiseScale = 1
) {
  if (amount <= 0) return;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const phase = (seed % 100000) * 0.017;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    const noise =
      Math.sin((x * 47.3 + y * 31.7) * noiseScale + phase) * 0.5 +
      Math.sin((y * 59.1 + z * 43.9) * noiseScale - phase * 0.7) * 0.3 +
      Math.sin((x - z) * 83.7 * noiseScale + phase * 1.3) * 0.2;
    const bristle = Math.pow(THREE.MathUtils.clamp(noise * 0.5 + 0.5, 0, 1), 3);
    // 保护区是一个罩住脸的椭球。口吻伸得越远，faceScale 就要开得越大，
    // 否则鼻子和嘴角会被毛刺扎穿。
    const faceDistance = Math.hypot(
      (x - headC.x) / (hr * 0.9 * faceScale),
      (y - headC.y) / (hr * 0.8 * faceScale),
      (z - (headC.z + hr * 0.7 * faceScale)) / (hr * 0.55 * faceScale)
    );
    // 脸必须是完全保护，不能只留一成。眼睛和鼻子是贴在原始曲面上的独立贴片，
    // 底下的毛只要抬起一点点就会从贴片边缘钻出来，看起来像眼睛上也炸了毛。
    const faceKeep = sstep(1.24, 0.6, faceDistance);
    const exposure = THREE.MathUtils.clamp(0.45 + ny * 0.35 - nz * 0.12, 0.2, 1);
    const lift = amount * lengthScale * (0.014 + 0.095 * bristle) * exposure * (1 - faceKeep);
    position.setXYZ(
      i,
      x + nx * lift,
      Math.max(0.004, y + ny * lift),
      z + nz * lift
    );
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}
