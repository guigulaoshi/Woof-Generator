import * as THREE from 'three';

/**
 * 吐出来的舌头。
 *
 * 之前用两三颗压扁的球拼，怎么调都像下巴上粘了块口香糖。舌头有两个特点
 * 必须做出来才成立：
 *   1. 它是一片有厚度的软肉——根窄、中段最宽、末端收成圆头，边缘还带一点
 *      翻卷。这就得真的按截面环去搭多边形，球拼不出来。
 *   2. 它是软的。狗一动、一摇尾巴，舌头会甩、会滞后、会上下颠。所以中轴线
 *      每帧重算，顶点跟着重排，而不是整块刚体转一下。
 *
 * 局部坐标：舌根在原点，沿 -Y 垂下，+Z 是舌面朝外的方向。
 */

const SEGMENTS = 15;
const SIDES = 12;

export function createDogTongue(hr, { color = '#ea7f92', creaseColor = '#c8637a' } = {}) {
  const length = hr * 0.3;
  // 沿舌长的半宽与半厚。sin 包络给出"根窄—中宽—尖圆"的轮廓。
  const halfWidthAt = (u) => hr * (0.042 + 0.088 * Math.sin(Math.min(u, 1) * Math.PI * 0.9));
  const halfThickAt = (u) => hr * (0.026 * (1 - 0.4 * u) + 0.006);

  const positionCount = (SEGMENTS + 1) * SIDES;
  const positions = new Float32Array(positionCount * 3);
  const normals = new Float32Array(positionCount * 3);
  const indices = [];
  for (let ring = 0; ring < SEGMENTS; ring++) {
    for (let side = 0; side < SIDES; side++) {
      const a = ring * SIDES + side;
      const b = ring * SIDES + ((side + 1) % SIDES);
      indices.push(a, b, a + SIDES, b, b + SIDES, a + SIDES);
    }
  }
  // 两端封口
  const capCenterRoot = positionCount;
  const capCenterTip = positionCount + 1;
  const allPositions = new Float32Array((positionCount + 2) * 3);
  const allNormals = new Float32Array((positionCount + 2) * 3);
  for (let side = 0; side < SIDES; side++) {
    indices.push(capCenterRoot, (side + 1) % SIDES, side);
    const base = SEGMENTS * SIDES;
    indices.push(capCenterTip, base + side, base + ((side + 1) % SIDES));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(allPositions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(allNormals, 3));
  geometry.setIndex(indices);

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshToonMaterial({ color, side: THREE.DoubleSide })
  );
  mesh.name = 'tongue';
  mesh.frustumCulled = false;

  // 中缝：一条同样跟着中轴线走的细带
  const creaseCount = SEGMENTS + 1;
  const creasePositions = new Float32Array(creaseCount * 2 * 3);
  const creaseIndices = [];
  for (let ring = 0; ring < SEGMENTS; ring++) {
    const a = ring * 2;
    creaseIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const creaseGeometry = new THREE.BufferGeometry();
  creaseGeometry.setAttribute('position', new THREE.BufferAttribute(creasePositions, 3));
  creaseGeometry.setIndex(creaseIndices);
  const crease = new THREE.Mesh(
    creaseGeometry,
    new THREE.MeshBasicMaterial({ color: creaseColor, side: THREE.DoubleSide })
  );
  crease.name = 'tongueCrease';
  crease.frustumCulled = false;
  mesh.add(crease);

  const centre = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const sideAxis = new THREE.Vector3();
  const faceAxis = new THREE.Vector3();
  const previous = new THREE.Vector3();
  const point = new THREE.Vector3();

  // 每帧重算：舌头是软的，弯曲量随时间变化，摇尾巴时甩得更开
  function update(time = 0, energy = 1) {
    const swing = energy * 0.5;
    previous.set(0, 0, 0);
    for (let ring = 0; ring <= SEGMENTS; ring++) {
      const u = ring / SEGMENTS;
      // 中轴线：整体下垂 + 越靠舌尖越明显的侧摆和前后颠
      const droop = u * length;
      const lateral = Math.sin(time * 6.1 + u * 2.3) * hr * 0.075 * swing * u * u;
      const flick = Math.sin(time * 8.7 + u * 3.1 + 1.1) * hr * 0.055 * swing * u * u
        + u * u * hr * 0.1; // 静态时也往前翻一点，不是笔直挂着
      centre.set(lateral, -droop, flick);

      if (ring === 0) tangent.set(0, -1, 0);
      else tangent.copy(centre).sub(previous).normalize();
      previous.copy(centre);

      // 截面基底：sideAxis 是宽度方向，faceAxis 是厚度方向
      sideAxis.set(1, 0, 0).addScaledVector(tangent, -tangent.x).normalize();
      faceAxis.crossVectors(sideAxis, tangent).normalize();

      const halfWidth = halfWidthAt(u);
      const halfThick = halfThickAt(u);
      for (let side = 0; side < SIDES; side++) {
        const theta = (side / SIDES) * Math.PI * 2;
        const offset = ring * SIDES + side;
        point.copy(centre)
          .addScaledVector(sideAxis, Math.cos(theta) * halfWidth)
          .addScaledVector(faceAxis, Math.sin(theta) * halfThick);
        allPositions[offset * 3] = point.x;
        allPositions[offset * 3 + 1] = point.y;
        allPositions[offset * 3 + 2] = point.z;
      }

      const creaseOffset = ring * 2;
      point.copy(centre).addScaledVector(faceAxis, halfThick * 1.02);
      creasePositions[creaseOffset * 3] = point.x - halfWidth * 0.09;
      creasePositions[creaseOffset * 3 + 1] = point.y;
      creasePositions[creaseOffset * 3 + 2] = point.z;
      creasePositions[(creaseOffset + 1) * 3] = point.x + halfWidth * 0.09;
      creasePositions[(creaseOffset + 1) * 3 + 1] = point.y;
      creasePositions[(creaseOffset + 1) * 3 + 2] = point.z;
    }

    // 封口点放在首尾环的中心
    for (const [target, ring] of [[capCenterRoot, 0], [capCenterTip, SEGMENTS]]) {
      let x = 0; let y = 0; let z = 0;
      for (let side = 0; side < SIDES; side++) {
        const offset = (ring * SIDES + side) * 3;
        x += allPositions[offset];
        y += allPositions[offset + 1];
        z += allPositions[offset + 2];
      }
      allPositions[target * 3] = x / SIDES;
      allPositions[target * 3 + 1] = y / SIDES;
      allPositions[target * 3 + 2] = z / SIDES;
    }

    geometry.getAttribute('position').needsUpdate = true;
    creaseGeometry.getAttribute('position').needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }

  update(0, 0);
  mesh.userData.updateTongue = update;
  return mesh;
}
