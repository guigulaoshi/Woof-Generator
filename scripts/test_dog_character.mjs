// 程序化小狗的回归测试。
//
// 重点盯住两件曾经出问题的事：
//   1. 体型滑杆拉到极端时还能不能生成一只完整的狗（旧的骨骼缩放方案会塌）
//   2. 换毛色是不是只换背上那块皮，而不是把整只狗刷成一个颜色
import assert from 'node:assert/strict';
import * as THREE from 'three';

// buildDog 会为眼睛和耳内贴花画 canvas 纹理。Node 里没有 DOM，
// 用一个只吞不吐的假 2D 上下文顶上：几何和顶点色完全不依赖画布内容。
const canvasContextStub = new Proxy({}, {
  get(_target, key) {
    if (key === 'createLinearGradient' || key === 'createRadialGradient') {
      return () => ({ addColorStop() {} });
    }
    if (key === 'measureText') return () => ({ width: 0 });
    return () => {};
  },
  set() {
    return true;
  },
});

globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error(`unexpected element: ${tag}`);
    return { width: 1, height: 1, getContext: () => canvasContextStub };
  },
};

const { buildDog, DOG_DEFAULTS, DOG_WORLD_SCALE } = await import('../src/dogBuilder.js');
const { DOG_COATS, DOG_POSES, DOG_EAR_TYPES, DOG_EAR_TIPS } = await import('../src/dogCoats.js');

// ---- 基础结构 --------------------------------------------------------------

const dog = buildDog({ ...DOG_DEFAULTS, seed: 7 });
const fur = dog.getObjectByName('fur');
assert.ok(fur, 'the dog must expose a fur mesh');
assert.ok(dog.getObjectByName('outline'), 'the dog must carry a hand-drawn inverted-hull outline');
assert.ok(dog.getObjectByName('face'), 'the dog must carry a face group');
assert.ok(
  dog.getObjectByName('eyeDecalLeft') && dog.getObjectByName('eyeDecalRight'),
  'both eyes must be projected onto the real SDF surface'
);
assert.ok(
  dog.getObjectByName('innerEarDecalLeft') && dog.getObjectByName('innerEarDecalRight'),
  'both inner ears must be surface decals, not floating plates'
);

const position = fur.geometry.getAttribute('position');
assert.ok(position.count > 4000, `the surface should be dense, got ${position.count} vertices`);
for (const name of ['color', 'idleRegion', 'idleTailU', 'rigPart']) {
  assert.ok(fur.geometry.getAttribute(name), `fur geometry must carry the ${name} attribute`);
}
assert.equal(
  Math.round(dog.scale.x * 1e6) / 1e6,
  DOG_WORLD_SCALE,
  'the finished dog must be scaled into the shared cat-generator world'
);

// ---- 极端体型：每一档都重新造网格，不是拉伸蒙皮 ----------------------------
// 这是旧方案最明显的失败点：一超出原始比例就塌陷、穿模、贴图拉花。

const EXTREMES = [
  { name: 'minimum', headSize: 0.4, chubbiness: 0.35, legLength: 0.08, torsoLength: 0.5, muzzleLength: 0.22, earSize: 0.15, tailLength: 0.1, tailCurl: -0.55 },
  { name: 'maximum', headSize: 2.4, chubbiness: 3.2, legLength: 2.6, torsoLength: 2, muzzleLength: 2.4, earSize: 2.8, tailLength: 2.8, tailCurl: 1.6 },
  { name: 'stilts', headSize: 0.4, chubbiness: 0.35, legLength: 2.6, torsoLength: 2, muzzleLength: 2.4, earSize: 0.15, tailLength: 2.8, tailCurl: 1.6 },
  { name: 'dachshund', headSize: 2.4, chubbiness: 3.2, legLength: 0.08, torsoLength: 2, muzzleLength: 0.22, earSize: 2.8, tailLength: 0.1, tailCurl: -0.55 },
];

for (const pose of DOG_POSES) {
  for (const earType of DOG_EAR_TYPES) {
    for (const extreme of EXTREMES) {
      const label = `${pose.id}/${earType.id}/${extreme.name}`;
      const built = buildDog({
        ...DOG_DEFAULTS, ...extreme, seed: 11, pose: pose.id, earType: earType.id,
      }, 'draft');
      const builtFur = built.getObjectByName('fur');
      assert.ok(builtFur, `${label}: must still produce a body`);

      const points = builtFur.geometry.getAttribute('position');
      assert.ok(points.count > 500, `${label}: surface collapsed to ${points.count} vertices`);
      const index = builtFur.geometry.getIndex();
      assert.ok(index && index.count > 900, `${label}: surface produced no faces`);

      const box = new THREE.Box3().setFromObject(built);
      for (const value of [...box.min.toArray(), ...box.max.toArray()]) {
        assert.ok(Number.isFinite(value), `${label}: bounding box went non-finite`);
      }
      assert.ok(box.min.y > -0.02, `${label}: the dog sank through the floor (${box.min.y})`);
      assert.ok(box.max.y > 0.1, `${label}: the dog has no height`);
      // 摊平检查：任何一个方向都不允许退化成一张纸
      const size = box.getSize(new THREE.Vector3());
      assert.ok(
        Math.min(size.x, size.y, size.z) > 0.06,
        `${label}: silhouette degenerated to ${size.toArray().join(' x ')}`
      );

      const colors = builtFur.geometry.getAttribute('color');
      for (let i = 0; i < colors.count * 3; i++) {
        assert.ok(
          Number.isFinite(colors.array[i]),
          `${label}: vertex colours contain NaN`
        );
      }
    }
  }
}

// ---- 耳型 × 耳尖：六种组合都要长出真的耳朵 ----------------------------------

for (const earType of DOG_EAR_TYPES) {
  for (const earTip of DOG_EAR_TIPS) {
    const label = `${earType.id}/${earTip.id}`;
    const withEars = buildDog({ ...DOG_DEFAULTS, seed: 21, earType: earType.id, earTip: earTip.id });
    const bare = buildDog({ ...DOG_DEFAULTS, seed: 21, earType: earType.id, earSize: 0.15 });
    const earVolume = new THREE.Box3().setFromObject(withEars).getSize(new THREE.Vector3());
    const bareVolume = new THREE.Box3().setFromObject(bare).getSize(new THREE.Vector3());
    assert.ok(
      earVolume.y > bareVolume.y * 0.98,
      `${label}: ears must add to the silhouette, not vanish into the skull`
    );
    assert.ok(
      withEars.getObjectByName('innerEarDecalLeft') && withEars.getObjectByName('innerEarDecalRight'),
      `${label}: both inner-ear decals must survive`
    );
  }
}

// ---- 换色只换背上那块皮 -----------------------------------------------------

// 用鞍背花色来验证——默认的"大黄"是纯色，主色本来就该染满全身。
const SADDLE_COAT = {
  coatId: 'blackBack',
  saddleColor: '#3b352f',
  underColor: '#c98a48',
};

function coatSample(overrides) {
  const built = buildDog({ ...DOG_DEFAULTS, ...SADDLE_COAT, seed: 3, ...overrides });
  const geometry = built.getObjectByName('fur').geometry;
  return {
    position: geometry.getAttribute('position'),
    color: geometry.getAttribute('color'),
  };
}

const baseline = coatSample({});
const saddleChanged = coatSample({ saddleColor: '#1133ff' });
const underChanged = coatSample({ underColor: '#1133ff' });

assert.equal(
  baseline.color.count,
  saddleChanged.color.count,
  'the same parameters must produce the same mesh so colours are comparable'
);

function changedMask(other) {
  const mask = new Uint8Array(baseline.color.count);
  let count = 0;
  for (let i = 0; i < baseline.color.count; i++) {
    const delta = Math.abs(baseline.color.getX(i) - other.color.getX(i))
      + Math.abs(baseline.color.getY(i) - other.color.getY(i))
      + Math.abs(baseline.color.getZ(i) - other.color.getZ(i));
    if (delta > 0.04) {
      mask[i] = 1;
      count++;
    }
  }
  return { mask, count };
}

const saddleMask = changedMask(saddleChanged);
const underMask = changedMask(underChanged);
const total = baseline.color.count;
const saddleShare = saddleMask.count / total;
const underShare = underMask.count / total;

assert.ok(
  saddleShare > 0.05,
  `the saddle colour must actually paint something, only ${(saddleShare * 100).toFixed(1)}% changed`
);
assert.ok(
  saddleShare < 0.6,
  `the saddle colour must stay a patch on the back, but it repainted ${(saddleShare * 100).toFixed(1)}% of the dog`
);
assert.ok(
  underShare > 0.2,
  `the under colour must cover the belly, chest and legs, only ${(underShare * 100).toFixed(1)}% changed`
);

// 背鞍长在背上：被主色染到的顶点，平均高度必须明显高于被底色染到的顶点。
function averageHeight(mask) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    sum += baseline.position.getY(i);
    count++;
  }
  return count ? sum / count : 0;
}

const saddleHeight = averageHeight(saddleMask.mask);
const underHeight = averageHeight(underMask.mask);
assert.ok(
  saddleHeight > underHeight * 1.15,
  `the saddle must sit on the back (saddle y=${saddleHeight.toFixed(3)}, under y=${underHeight.toFixed(3)})`
);

// 纯色反过来：主色本来就应该盖满全身，只有腹部被底色提亮
const solidBaseline = coatSample({ coatId: 'yellow', saddleColor: '#d99850', underColor: '#f5e3c2' });
const solidChanged = coatSample({ coatId: 'yellow', saddleColor: '#1133ff', underColor: '#f5e3c2' });
let solidChangedCount = 0;
for (let i = 0; i < solidBaseline.color.count; i++) {
  const delta = Math.abs(solidBaseline.color.getX(i) - solidChanged.color.getX(i))
    + Math.abs(solidBaseline.color.getY(i) - solidChanged.color.getY(i))
    + Math.abs(solidBaseline.color.getZ(i) - solidChanged.color.getZ(i));
  if (delta > 0.04) solidChangedCount++;
}
assert.ok(
  solidChangedCount / solidBaseline.color.count > 0.85,
  'a solid coat is supposed to repaint the whole dog'
);

// ---- 每种花色都要能生成 -----------------------------------------------------

for (const coat of DOG_COATS) {
  const built = buildDog({
    ...DOG_DEFAULTS,
    seed: 5,
    coatId: coat.id,
    saddleColor: coat.saddle,
    underColor: coat.under,
  }, 'draft');
  const colors = built.getObjectByName('fur').geometry.getAttribute('color');
  const seen = new Set();
  for (let i = 0; i < colors.count; i += 7) {
    seen.add([
      Math.round(colors.getX(i) * 12),
      Math.round(colors.getY(i) * 12),
      Math.round(colors.getZ(i) * 12),
    ].join(':'));
  }
  assert.ok(seen.size > 1, `${coat.id}: coat must not be a single flat colour`);
}

console.log(JSON.stringify({
  status: 'ok',
  model: 'procedural SDF Chinese village dog',
  poses: DOG_POSES.length,
  earTypes: DOG_EAR_TYPES.length,
  coats: DOG_COATS.length,
  extremeCombinations: DOG_POSES.length * DOG_EAR_TYPES.length * EXTREMES.length,
  defaultVertices: position.count,
  saddleRepaintShare: Number(saddleShare.toFixed(3)),
  underRepaintShare: Number(underShare.toFixed(3)),
}, null, 2));
