import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createRng } from './rng.js';
import { buildDogToys } from './dogToys.js';

// 每个玩具随机尺寸的区间，按 kind 查表。
const TOY_SCALE_RANGES = {
  dogBed: [0.86, 1.34],
  bone: [0.72, 2.05],
  tennis: [0.76, 1.85],
  frisbee: [0.82, 1.7],
  rope: [0.74, 1.95],
  bowl: [0.82, 1.46],
  piggy: [0.72, 1.85],
  slipper: [0.78, 1.75],
};

// 偶尔出现的“巨型玩具”彩蛋只挑有脸或有轮廓的道具，
// 巨型骨头和巨型吱吱猪比巨型狗碗有意思得多。
const GIANT_TOY_KINDS = new Set(['bone', 'piggy', 'slipper']);

/**
 * 小狗周围的玩具 + 刚体物理（cannon-es）。
 * 玩具可被鼠标抓起拖拽、甩出去摔；与地面、彼此、狗身碰撞。
 * 视觉语言：Toon 材质 + 反壳描边 + 投影进素描影子。
 */

const OUTLINE_COLOR = '#4a3428';
// 刚体仍真实落地；只把可见网格抬高约 1–2 像素，防止反壳描边被接触面吞掉。
const VISUAL_CONTACT_LIFT = 0.01;

function toonMat(color, gradientMap) {
  return new THREE.MeshToonMaterial({ color, gradientMap });
}

function gradientMap() {
  const data = new Uint8Array([232, 255]);
  const tex = new THREE.DataTexture(data, 2, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// 反壳描边
function outlineOf(geo, thickness = 0.01) {
  const og = geo.clone();
  const op = og.getAttribute('position');
  const on = og.getAttribute('normal');
  for (let i = 0; i < op.count; i++) {
    op.setXYZ(
      i,
      op.getX(i) + on.getX(i) * thickness,
      op.getY(i) + on.getY(i) * thickness,
      op.getZ(i) + on.getZ(i) * thickness
    );
  }
  op.needsUpdate = true;
  return new THREE.Mesh(og, new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide }));
}

// 毛线球纹理：底色 + 缠绕线
// 小鱼布偶纹理：低对比度弯曲条纹，保留手绘与布面感。
export function createToyWorld(scene) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  const mat = new CANNON.Material('toy');
  world.addContactMaterial(new CANNON.ContactMaterial(mat, mat, { friction: 0.35, restitution: 0.4 }));
  world.defaultContactMaterial.friction = 0.35;
  world.defaultContactMaterial.restitution = 0.4;

  // 地面
  const groundBody = new CANNON.Body({ type: CANNON.Body.STATIC, material: mat, shape: new CANNON.Plane() });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  const grad = gradientMap();
  const group = new THREE.Group();
  group.name = 'toys';
  scene.add(group);

  const toys = []; // { mesh, body, kind, radius, baseRadius, scale, ... }
  let currentCharacterColliders = [];

  function snapshotShape(shape, offset) {
    const base = {
      offset: new CANNON.Vec3(offset.x, offset.y, offset.z),
      type: 'other',
    };
    if (shape instanceof CANNON.Sphere) {
      base.type = 'sphere';
      base.radius = shape.radius;
    } else if (shape instanceof CANNON.Box) {
      base.type = 'box';
      base.halfExtents = new CANNON.Vec3(
        shape.halfExtents.x,
        shape.halfExtents.y,
        shape.halfExtents.z
      );
    }
    return base;
  }

  function addToy(mesh, body, radius, kind = 'toy') {
    mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const material of materials) {
        // 和狗身体一致：用可见正面写 ShadowMap，避免开放网格或反壳描边
        // 只用背面投影时形成空心阴影。
        material.shadowSide = o.userData.doubleSidedShadow
          ? THREE.DoubleSide
          : THREE.FrontSide;
      }
    });
    group.add(mesh);
    world.addBody(body);
    toys.push({
      mesh,
      body,
      kind,
      radius,
      baseRadius: radius,
      scale: 1,
      baseMass: body.mass,
      baseMeshScale: mesh.scale.clone(),
      baseShapes: body.shapes.map((shape, index) => snapshotShape(shape, body.shapeOffsets[index])),
    });
  }

  function setToyScale(toy, factor) {
    toy.scale = factor;
    toy.radius = toy.baseRadius * factor;
    toy.mesh.scale.set(
      toy.baseMeshScale.x * factor,
      toy.baseMeshScale.y * factor,
      toy.baseMeshScale.z * factor
    );

    for (let i = 0; i < toy.body.shapes.length; i++) {
      const shape = toy.body.shapes[i];
      const base = toy.baseShapes[i];
      toy.body.shapeOffsets[i].set(
        base.offset.x * factor,
        base.offset.y * factor,
        base.offset.z * factor
      );
      if (base.type === 'sphere') {
        shape.radius = base.radius * factor;
        shape.updateBoundingSphereRadius();
      } else if (base.type === 'box') {
        shape.halfExtents.set(
          base.halfExtents.x * factor,
          base.halfExtents.y * factor,
          base.halfExtents.z * factor
        );
        shape.updateConvexPolyhedronRepresentation();
        shape.updateBoundingSphereRadius();
      }
    }

    toy.body.mass = toy.baseMass * Math.pow(factor, 2.35);
    toy.body.updateMassProperties();
    toy.body.updateBoundingRadius();
    toy.body.aabbNeedsUpdate = true;
    toy.body.wakeUp();
  }

  function restingBodyY(toy) {
    let minY = Infinity;
    for (let i = 0; i < toy.body.shapes.length; i++) {
      const shape = toy.body.shapes[i];
      const offset = toy.body.shapeOffsets[i];
      if (shape instanceof CANNON.Sphere) {
        minY = Math.min(minY, offset.y - shape.radius);
      } else if (shape instanceof CANNON.Box) {
        minY = Math.min(minY, offset.y - shape.halfExtents.y);
      }
    }
    return Number.isFinite(minY) ? Math.max(0.016, 0.016 - minY) : toy.radius + 0.016;
  }

  {
    // 狗的玩具组：狗窝垫、骨头、网球、飞盘、磨牙绳、狗碗、吱吱猪、被叼走的拖鞋。
    buildDogToys({ THREE, CANNON, addToy, material: mat, gradientMap: grad, outlineOf, toonMat });
  }

  // ---- 角色碰撞体（静态球组，随重建更新）----------------------------------
  let characterBody = null;
  let characterColliderSource = [];
  function setCharacterColliders(spheres) {
    if (characterBody) world.removeBody(characterBody);
    characterColliderSource = spheres.map((s) => ({
      x: s.c.x,
      y: s.c.y,
      z: s.c.z,
      r: s.r,
    }));
    currentCharacterColliders = spheres.map((s) => ({
      x: s.c.x,
      y: s.c.y,
      z: s.c.z,
      r: s.r,
    }));
    characterBody = new CANNON.Body({ type: CANNON.Body.STATIC, material: mat });
    for (const s of spheres) {
      characterBody.addShape(new CANNON.Sphere(s.r), new CANNON.Vec3(s.c.x, s.c.y, s.c.z));
    }
    world.addBody(characterBody);
  }

  function setCharacterTransform(x = 0, z = 0, yaw = 0) {
    if (!characterBody) return;
    characterBody.position.set(x, 0, z);
    characterBody.quaternion.setFromEuler(0, yaw, 0);
    characterBody.aabbNeedsUpdate = true;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    currentCharacterColliders = characterColliderSource.map((collider) => ({
      x: x + collider.x * c + collider.z * s,
      y: collider.y,
      z: z - collider.x * s + collider.z * c,
      r: collider.r,
    }));
  }

  // ---- 石头碰撞体（静态球组，随环境重建更新）------------------------------
  let rockBody = null;
  function setRockColliders(spheres) {
    if (rockBody) world.removeBody(rockBody);
    rockBody = null;
    if (!spheres.length) return;
    rockBody = new CANNON.Body({ type: CANNON.Body.STATIC, material: mat });
    for (const s of spheres) {
      rockBody.addShape(new CANNON.Sphere(s.r), new CANNON.Vec3(s.c.x, s.c.y, s.c.z));
    }
    world.addBody(rockBody);
  }

  // 只在随机生成新角色时重抽尺寸和散落点；普通调参不会重置用户拖动过的玩具。
  function randomizeToyScales(rng) {
    const giantCandidates = toys.filter((toy) => GIANT_TOY_KINDS.has(toy.kind));
    const giants = new Set();
    if (giantCandidates.length && rng.chance(0.38)) {
      giants.add(rng.pick(giantCandidates));
      if (rng.chance(0.1)) {
        const remaining = giantCandidates.filter((toy) => !giants.has(toy));
        if (remaining.length) giants.add(rng.pick(remaining));
      }
    }

    for (const toy of toys) {
      let factor;
      if (giants.has(toy)) {
        factor = toy.kind === 'bone'
          ? rng.range(3.6, 6.2)
          : rng.range(3.3, 5.8);
      } else {
        const [min, max] = TOY_SCALE_RANGES[toy.kind] || [0.75, 1.7];
        factor = rng.range(min, max);
      }
      setToyScale(toy, Math.round(factor * 50) / 50);
    }
  }

  function shuffleWithRng(items, rng) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function isPlacementClear(x, z, radius, placed) {
    for (const other of placed) {
      const minDistance = radius + other.radius + 0.09;
      const dx = x - other.x;
      const dz = z - other.z;
      if (dx * dx + dz * dz < minDistance * minDistance) return false;
    }

    for (const collider of currentCharacterColliders) {
      const minDistance = radius + collider.r * 0.78 + 0.1;
      const dx = x - collider.x;
      const dz = z - collider.z;
      if (dx * dx + dz * dz < minDistance * minDistance) return false;
    }
    return true;
  }

  function placeToyBody(toy, x, z, yaw, rng) {
    const dropHeight = rng.range(1.45, 3.6) + Math.min(toy.radius * 0.62, 1.35);
    toy.body.position.set(x, restingBodyY(toy) + dropHeight, z);
    toy.body.velocity.set(
      rng.range(-0.24, 0.24),
      rng.range(-0.08, 0.06),
      rng.range(-0.24, 0.24)
    );
    toy.body.angularVelocity.set(
      rng.range(-2.2, 2.2),
      rng.range(-2.2, 2.2),
      rng.range(-2.2, 2.2)
    );
    toy.body.force.set(0, 0, 0);
    toy.body.torque.set(0, 0, 0);
    toy.body.quaternion.setFromEuler(0, yaw, 0);
    toy.body.aabbNeedsUpdate = true;
    toy.body.wakeUp();
  }

  // 新 seed 同时重抽玩具尺寸和位置。大约三至四成玩具落在地毯内，
  // 其余围绕垫子边缘；所有候选点都会避开狗身和已经放好的玩具。
  function scatterAroundMat(bounds, seed) {
    const rng = createRng((seed ^ 0x31d2c88f) >>> 0);
    randomizeToyScales(rng);

    const halfWidth = bounds.width * 0.5;
    const halfDepth = bounds.depth * 0.5;
    const insideTarget = Math.round(toys.length * rng.range(0.3, 0.46));
    const insideEligible = shuffleWithRng(
      toys.filter((toy) => toy.radius < Math.min(halfWidth, halfDepth) * 0.3),
      rng
    );
    const insideSet = new Set(insideEligible.slice(0, insideTarget));
    const ordered = [...toys].sort((a, b) => b.radius - a.radius);
    const placed = [];

    for (const toy of ordered) {
      const wantsInside = insideSet.has(toy);
      let selected = null;

      for (let attempt = 0; attempt < 180; attempt++) {
        let x;
        let z;
        if (wantsInside) {
          const availableX = Math.max(0.18, halfWidth * 0.84 - toy.radius);
          const availableZ = Math.max(0.18, halfDepth * 0.84 - toy.radius);
          const angle = rng.range(0, Math.PI * 2);
          const radial = Math.sqrt(rng.next());
          x = bounds.centerX + Math.cos(angle) * availableX * radial;
          z = bounds.centerZ + Math.sin(angle) * availableZ * radial;
        } else {
          const angle = rng.range(0, Math.PI * 2);
          const gap = rng.range(0.12, 0.56);
          // 半径只加一部分，让外圈玩具有机会自然压住地毯边缘。
          const ringX = halfWidth * rng.range(0.82, 1.02) + toy.radius * 0.62 + gap;
          const ringZ = halfDepth * rng.range(0.82, 1.02) + toy.radius * 0.62 + gap;
          x = bounds.centerX + Math.cos(angle) * ringX;
          z = bounds.centerZ + Math.sin(angle) * ringZ;
        }

        if (isPlacementClear(x, z, toy.radius, placed)) {
          selected = { x, z };
          break;
        }
      }

      // 极端大尺寸或拥挤 seed 的兜底：逐步扩大的黄金角环，仍然检查碰撞。
      if (!selected) {
        for (let attempt = 0; attempt < 120; attempt++) {
          const angle = (placed.length + attempt) * 2.399963229728653;
          const expansion = Math.floor(attempt / 12) * 0.35;
          const ringX = halfWidth * 0.92 + toy.radius + 0.3 + expansion;
          const ringZ = halfDepth * 0.92 + toy.radius + 0.3 + expansion;
          const x = bounds.centerX + Math.cos(angle) * ringX;
          const z = bounds.centerZ + Math.sin(angle) * ringZ;
          if (isPlacementClear(x, z, toy.radius, placed)) {
            selected = { x, z };
            break;
          }
        }
      }

      if (!selected) {
        const angle = placed.length * 2.399963229728653;
        const distance = Math.max(halfWidth, halfDepth) + toy.radius + 2.5 + placed.length * 0.45;
        selected = {
          x: bounds.centerX + Math.cos(angle) * distance,
          z: bounds.centerZ + Math.sin(angle) * distance,
        };
      }

      placeToyBody(toy, selected.x, selected.z, rng.range(-Math.PI, Math.PI), rng);
      placed.push({ x: selected.x, z: selected.z, radius: toy.radius });
    }
  }

  // ---- 鼠标抓取：点对点约束挂到运动学小球上 --------------------------------
  const mouseBody = new CANNON.Body({ type: CANNON.Body.KINEMATIC, shape: new CANNON.Sphere(0.02) });
  mouseBody.collisionResponse = false;
  world.addBody(mouseBody);
  let constraint = null;

  function grabToy(toy, worldPoint) {
    mouseBody.position.set(worldPoint.x, worldPoint.y, worldPoint.z);
    const local = toy.body.pointToLocalFrame(new CANNON.Vec3(worldPoint.x, worldPoint.y, worldPoint.z));
    constraint = new CANNON.PointToPointConstraint(toy.body, local, mouseBody, new CANNON.Vec3(0, 0, 0), 60);
    world.addConstraint(constraint);
    toy.body.angularDamping = 0.7;
    toy.body.wakeUp();
    return constraint;
  }

  function moveGrab(worldPoint) {
    if (!constraint) return;
    mouseBody.position.set(worldPoint.x, Math.max(worldPoint.y, 0.06), worldPoint.z);
  }

  function releaseGrab() {
    if (!constraint) return;
    const toy = toys.find((t) => t.body === constraint.bodyA);
    if (toy) toy.body.angularDamping = 0.25;
    world.removeConstraint(constraint);
    constraint = null;
  }

  function step(dt) {
    world.step(1 / 60, dt, 6);
    for (const t of toys) {
      t.mesh.position.copy(t.body.position);
      t.mesh.position.y += VISUAL_CONTACT_LIFT;
      t.mesh.quaternion.copy(t.body.quaternion);
    }
  }

  return {
    group, toys, world, step, setCharacterColliders, setCharacterTransform, setRockColliders,
    grabToy, moveGrab, releaseGrab, scatterAroundMat, setToyScale,
    get dragging() { return !!constraint; },
  };
}
