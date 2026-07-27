// 程序化中华田园犬：SDF 图元 + smooth min 融合 + Surface Nets 网格化 + 三渲二。
//
// 每次调参都用新参数重新摆一遍 SDF 图元，再把整只狗重新网格化。形状是被
// “造”出来的，不是把一个现成模型“拉”出来的，所以任何极端比例都仍然是一只
// 完整、不穿模、不拉花的狗。
//
// 让它一眼是中华田园犬的几处关键解剖：
//   1. 楔形头骨：颅顶偏平、两耳间最宽、向前收窄，额头与鼻梁之间有明显的止部
//   2. 突出的长口吻 + 圆鼻头
//   3. 横向的杏仁眼配圆瞳
//   4. 立耳 / 垂耳 / 折耳三种耳型
//   5. 后腿的膝—跗二段折线，深胸收腹的腰线
//   6. 沿脊柱卷起的尾巴

import * as THREE from 'three';
import { createRng } from './rng.js';
import { DOG_COATS, DOG_EYE_COLORS } from './dogCoats.js';
import { sphere, roundCone, meshFromSDF, nearestPrim } from './sdf.js';
import { injectPoke } from './softPoke.js';
import { injectBodyHatch } from './hatch.js';
import { createDogIdleState, injectDogIdle, updateDogIdle } from './dogIdle.js';
import { createDogEyeTexture } from './dogEye.js';
import { createDogTongue } from './dogTongue.js';
import {
  sstep,
  applyFluffGeometry,
  toonGradientMap,
  makeOutline,
  makeSurfacePatch,
  makeEyeDecal,
  makeDecalTexture,
  makeSurfaceDecal,
} from './toonSurface.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const WORLD_UP = V(0, 1, 0);
const DOG_MESH_REFERENCE_VOLUME = 3.2;

// 解剖是按“一只狗大约两个单位高”这个尺度写的，读写都舒服，但直接摆进场景
// 就比玩具和垫子大了一圈。整只成品统一缩到这个比例：SDF 网格换算到世界单位
// 约 0.01，描边也落在 0.011 这个手绘线宽上。
export const DOG_WORLD_SCALE = 0.65;

// 花色是画在顶点上的，所以斑点和背鞍的边界有多干净，直接由三角形有多小决定。
// 0.03 那档一个斑点的过渡带只跨得过一两个顶点，边缘就会出现明显的台阶。
// 定稿这一版加密到 0.016（换算到世界单位约 0.010），代价是网格化
// 从 ~70ms 涨到 ~190ms——而它只在松手 180ms 之后跑一次，拖动时用的是 draft。
export const DOG_MESH_QUALITY = Object.freeze({
  staticCell: 0.016,
  draftCell: 0.045,
  staticMaxVolumeScale: 1.25,
  draftMaxVolumeScale: 1.28,
});

export function resolveDogMeshCellSize(quality = 'full', boundsVolume = DOG_MESH_REFERENCE_VOLUME) {
  const isDraft = quality === 'draft';
  const baseCell = isDraft ? DOG_MESH_QUALITY.draftCell : DOG_MESH_QUALITY.staticCell;
  const maxVolumeScale = isDraft
    ? DOG_MESH_QUALITY.draftMaxVolumeScale
    : DOG_MESH_QUALITY.staticMaxVolumeScale;
  const safeVolume = Math.max(Number(boundsVolume) || DOG_MESH_REFERENCE_VOLUME, 0.001);
  const volumeScale = Math.max(1, Math.cbrt(safeVolume / DOG_MESH_REFERENCE_VOLUME));
  return baseCell * Math.min(volumeScale, maxVolumeScale);
}

// 默认值就是一只标准的中华田园犬：中等骨量、腿不矮、楔形头配中长吻、
// 立耳、尾巴卷在背上。想要别的犬型全靠滑杆拉出来。
export const DOG_DEFAULTS = Object.freeze({
  pose: 'standing',
  coatId: 'yellow',
  saddleColor: '#d99850',
  underColor: '#f5e3c2',
  eyeColor: '#4a3122',
  headSize: 0.79,
  chubbiness: 1,
  legLength: 0.34,
  torsoLength: 1.02,
  muzzleLength: 1.3,
  earType: 'prick',
  earTip: 'pointed',
  earSize: 1,
  tailLength: 1,
  tailCurl: 1.05,
  eyeSize: 1.08,
  irisScale: 0.66,
  eyebrowDots: true,
  tongueOut: true,
  fluffy: false,
  furFluff: 0.9,
  outlineJitter: 0.25,
});

// 沿脊柱的“背鞍坐标系”。
// 背上那块皮不能用世界坐标的高度来切——狗一趴下、一作揖，高度和背就没关系了。
// 这里把每个顶点投影到脊柱折线上，得到 (沿脊柱的 t, 绕脊柱的角度)，
// 花色就永远长在正确的解剖位置上，不管姿势怎么变。
function makeSpineSampler(points, up) {
  const segments = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const delta = points[i + 1].clone().sub(a);
    const length = Math.max(delta.length(), 1e-5);
    segments.push({ a, dir: delta.clone().divideScalar(length), length, start: total });
    total += length;
  }
  const relative = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const reference = new THREE.Vector3();
  const result = { t: 0, around: Math.PI * 0.5, radial: 0 };

  return function sampleSpine(point) {
    let bestDistance = Infinity;
    let bestSegment = segments[0];
    let bestT = 0;
    for (const segment of segments) {
      relative.copy(point).sub(segment.a);
      const t = THREE.MathUtils.clamp(relative.dot(segment.dir), 0, segment.length);
      projected.copy(segment.a).addScaledVector(segment.dir, t);
      const distance = projected.distanceToSquared(point);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSegment = segment;
        bestT = t;
        closest.copy(projected);
      }
    }
    result.t = total > 1e-5 ? (bestSegment.start + bestT) / total : 0;
    offset.copy(point).sub(closest);
    offset.addScaledVector(bestSegment.dir, -offset.dot(bestSegment.dir));
    result.radial = offset.length();
    reference.copy(up).addScaledVector(bestSegment.dir, -up.dot(bestSegment.dir));
    if (result.radial > 1e-5 && reference.lengthSq() > 1e-8) {
      reference.normalize();
      result.around = Math.acos(
        THREE.MathUtils.clamp(offset.dot(reference) / result.radial, -1, 1)
      );
    } else {
      result.around = Math.PI * 0.5;
    }
    return result;
  };
}

// 手绘毛边：多频正弦，让花色边界像笔刷扫出来的，而不是数学切出来的
function paintNoise(p, scale = 1) {
  return (
    Math.sin(p.x * 17.3 * scale + p.y * 11.7) * 0.5 +
    Math.sin(p.y * 13.9 * scale + p.z * 19.1) * 0.32 +
    Math.sin((p.x + p.z) * 27.7 * scale - p.y * 9.3) * 0.18
  );
}

function orthogonalUp(forward) {
  const up = WORLD_UP.clone().addScaledVector(forward, -WORLD_UP.dot(forward));
  // 头正对天或正对地时世界上方退化，改用后方向当参考轴
  if (up.lengthSq() < 1e-6) {
    up.set(0, 0, -1).addScaledVector(forward, forward.z);
  }
  return up.normalize();
}

export function buildDog(params = {}, quality = 'full') {
  const buildStartedAt = performance.now();
  const options = { ...DOG_DEFAULTS, ...params };
  const rng = createRng(options.seed ?? 1);
  const coat = DOG_COATS.find((entry) => entry.id === options.coatId) ?? DOG_COATS[0];

  const chub = THREE.MathUtils.clamp(options.chubbiness, 0.3, 4);
  const wid = Math.sqrt(chub);
  const hr = 0.43 * options.headSize;
  const earS = options.earSize;
  const tl = options.tailLength;
  const curl = options.tailCurl;
  const muz = THREE.MathUtils.clamp(options.muzzleLength, 0.2, 2.6);
  const tor = THREE.MathUtils.clamp(options.torsoLength, 0.45, 2.2);
  const legF = THREE.MathUtils.clamp(options.legLength, 0.05, 3);
  const pose = options.pose;

  const prims = [];
  const P = (primitive) => (prims.push(primitive), primitive);
  const earDef = [];
  let headFrame = null;
  let muzzleTip = null;
  let mouthCenter = null;
  let tailRootC = null;
  let spinePoints = null;
  const spineUp = WORLD_UP.clone();
  let gradLow = 0.1;
  let gradHigh = 1;
  let chestHint = null;

  // ---- 解剖构件 -----------------------------------------------------------

  function addHead(center, forward, neckFrom = null, neckR = 0.26, roll = 0) {
    const fwd = forward.clone().normalize();
    // roll 是绕视线轴的歪头。狗讨food、听声音、作揖的时候几乎都会把头歪一下，
    // 这是它跟人互动时最有辨识度的一个小动作。
    const up = orthogonalUp(fwd);
    if (roll) up.applyAxisAngle(fwd, roll).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    headFrame = { c: center.clone(), fwd, up, right };

    // 头骨。狗的脑袋不是球——中华田园犬是标准的楔形头：
    // 颅顶偏平、两耳之间最宽、往前逐级收窄，额头和鼻梁之间还有一道明显的
    // 折角（解剖学叫"止部 / stop"）。这三件事缺一件，脸就不像狗了。
    //
    // 1) 颅盖：上下扁、前后略长的椭球。横向要收着——中华田园犬的脸是"窄长"
    //    的楔形，不是宽扁的圆盘；横向一放开就会变成一张大饼脸。
    P(sphere({ c: center, r: hr, s: [0.9, 0.84, 1.06], k: 0.12, tag: 'head' }));
    // 2) 枕骨：后脑勺那个小凸起，侧影上是"狗头"和"球"的分界
    P(sphere({
      c: center.clone().addScaledVector(fwd, -hr * 0.36).addScaledVector(up, hr * 0.06),
      r: hr * 0.62, s: [0.86, 0.9, 0.88], k: 0.12, tag: 'head',
    }));
    // 3) 额平台：一块又宽又薄的板压在颅顶前半段。它的前缘就是止部——
    //    口吻从这块板"下面"伸出去，两者之间自然出现一道折。
    P(sphere({
      c: center.clone().addScaledVector(up, hr * 0.26).addScaledVector(fwd, hr * 0.24),
      r: hr * 0.46, s: [0.82, 0.4, 0.9], k: 0.07, tag: 'head',
    }));
    for (const side of [-1, 1]) {
      // 4) 颧弓与咬肌：只是脸侧一道浅浅的隆起，别做成两颊鼓包
      P(sphere({
        c: center.clone()
          .addScaledVector(right, side * hr * 0.4)
          .addScaledVector(up, -hr * 0.2)
          .addScaledVector(fwd, hr * 0.04),
        r: hr * 0.3, s: [0.7, 0.8, 1.06], k: 0.1, tag: 'head',
      }));
      // 5) 眉弓：额平台前缘两侧的小隆起，把眼睛托在止部上方
      P(sphere({
        c: center.clone()
          .addScaledVector(right, side * hr * 0.3)
          .addScaledVector(up, hr * 0.2)
          .addScaledVector(fwd, hr * 0.52),
        r: hr * 0.2, s: [0.9, 0.8, 0.92], k: 0.07, tag: 'head',
      }));
    }

    if (neckFrom) {
      // 狗的脖子又粗又长，后颈还有一团鬃毛似的厚肉。把头直接坐在肩膀上
      // 会显得没脖子。
      const neckEnd = center.clone()
        .addScaledVector(fwd, -hr * 0.26)
        .addScaledVector(up, -hr * 0.16);
      P(roundCone({
        a: neckFrom, b: neckEnd,
        r1: neckR * 1.12, r2: hr * 0.56,
        k: 0.17, tag: 'body',
      }));
      P(sphere({
        c: neckFrom.clone().lerp(neckEnd, 0.42).addScaledVector(up, hr * 0.14),
        r: neckR * 0.72, s: [0.86, 0.82, 1.1], k: 0.16, tag: 'body',
      }));
    }

    // 口吻：向前下方伸出的圆头锥 + 末端鼻球。muzzleLength 只改这一段的长度，
    // 颅顶尺寸不动，所以从短鼻巴哥到长嘴牧羊犬都是同一只狗在变脸。
    const snoutDir = fwd.clone().addScaledVector(up, -0.28).normalize();
    // 口吻必须明显冲出颅骨轮廓才读得出是狗：根部就已经在头半径外，
    // 融合半径也压到很小，否则整段鼻子会被脑袋吞掉。
    const snoutLen = hr * (0.26 + 0.52 * muz);
    const snoutRoot = center.clone().addScaledVector(snoutDir, hr * 0.36);
    muzzleTip = snoutRoot.clone().addScaledVector(snoutDir, snoutLen);
    P(roundCone({
      a: snoutRoot, b: muzzleTip,
      r1: hr * 0.4, r2: hr * 0.265,
      k: 0.05, tag: 'muzzle',
    }));
    P(sphere({
      c: muzzleTip.clone().addScaledVector(snoutDir, -hr * 0.04),
      r: hr * 0.215, s: [1.06, 0.88, 1.08], k: 0.04, tag: 'muzzle',
    }));
    // 下颚：侧面看有下巴，不是一根尖锥
    P(roundCone({
      a: snoutRoot.clone().addScaledVector(up, -hr * 0.14),
      b: muzzleTip.clone().addScaledVector(snoutDir, -hr * 0.14).addScaledVector(up, -hr * 0.09),
      r1: hr * 0.3, r2: hr * 0.17, k: 0.05, tag: 'muzzle',
    }));
    headFrame.snoutDir = snoutDir;
    headFrame.snoutLen = snoutLen;
    mouthCenter = muzzleTip.clone()
      .addScaledVector(snoutDir, -hr * 0.02)
      .addScaledVector(up, -hr * 0.19);
    return headFrame;
  }

  // 耳型（立 / 垂 / 折）说的是耳朵怎么长在头上，耳尖形状是另一条独立的轴：
  // 同样是立耳，中华田园犬多是收得很尖的三角，也有一批是顶端浑圆的圆耳。
  // 两条轴分开，六种组合都成立。
  function addEars(type, tip) {
    const round = tip === 'round';
    const { c: center, fwd, up, right } = headFrame;
    for (const side of [-1, 1]) {
      if (type === 'floppy') {
        // 垂耳是一块挂在头侧的软皮：从耳根往下逐渐变宽，到三分之二处最宽，
        // 末端才收成圆头。之前写成「从上到下一路变窄、紧贴脸颊、还跟脑袋
        // 融在一起」，读出来就是两片鬓角而不是耳朵。
        // 关键三点：耳根挪到颅骨轮廓外、前后（Z）方向明显加宽、融合半径调小。
        const base = center.clone()
          .addScaledVector(right, side * hr * 0.72)
          .addScaledVector(up, hr * 0.36)
          .addScaledVector(fwd, -hr * 0.02);
        const dropDir = right.clone().multiplyScalar(side * 0.2)
          .addScaledVector(up, -1)
          .addScaledVector(fwd, 0.06)
          .normalize();
        // 又大又长的垂耳配上矮身姿势会一路垂到地板以下：网格会被地面截平，
        // 耳内贴花更是直接射到地下去。真狗的耳朵也就搭到地上为止，这里同样
        // 按“碰到地面就停”来限长。
        const groundLimit = dropDir.y < -1e-3
          ? Math.max(hr * 0.34, (base.y - 0.07) / -dropDir.y)
          : Infinity;
        const len = Math.min(hr * (0.66 + 0.86 * earS), groundLimit) * (round ? 0.94 : 1);
        const flapWidth = hr * (round ? 0.37 : 0.33) * Math.sqrt(earS);
        const segments = 4;
        for (let i = 0; i < segments; i++) {
          const t = (i + 0.5) / segments;
          // 上窄下宽再收圆：正弦包络比线性收窄更像一片真的耳朵皮
          let profile = 0.72 + 0.62 * Math.sin(THREE.MathUtils.clamp(t, 0, 1) * Math.PI * 0.86);
          // 尖耳的下半截继续收窄成一个钝角；圆耳保持宽度、末端直接兜圆
          if (!round) profile *= THREE.MathUtils.lerp(1, 0.52, sstep(0.5, 1, t));
          const c = base.clone()
            .addScaledVector(dropDir, len * t)
            .addScaledVector(fwd, Math.sin(t * Math.PI) * hr * 0.14)
            .addScaledVector(right, side * Math.sin(t * Math.PI) * hr * 0.05);
          const flap = P(sphere({
            c,
            r: flapWidth * profile,
            // 世界轴向的薄片：X 方向薄（贴着脸侧），Y 略长，Z 最宽（耳朵的前后幅面）
            s: [0.3, round ? 1.0 : 1.08, round ? 1.36 : 1.28],
            k: 0.05,
            tag: 'ear',
            u: t,
          }));
          flap.idleEarSide = side;
        }
        earDef.push({
          a: base, dir: dropDir, len,
          r1: flapWidth * 1.3, r2: flapWidth * 0.8,
          side, type,
        });
        continue;
      }

      // 立耳 / 折耳。尖耳是一个收得很细的三角，圆耳则是顶端兜圆的短耳——
      // 靠 roundCone 末端半径就能一次做出来：r2 很小是尖，r2 很大是圆头。
      const base = center.clone()
        .addScaledVector(right, side * hr * 0.5)
        .addScaledVector(up, hr * 0.46)
        .addScaledVector(fwd, -hr * 0.12);
      const dir = right.clone().multiplyScalar(side * 0.42)
        .addScaledVector(up, 1)
        .addScaledVector(fwd, -0.1)
        .normalize();
      // 圆耳整体更矮更宽，不然一个大圆头顶在细长的耳朵上会像棉签
      const len = hr * (round ? 0.3 + 0.44 * earS : 0.36 + 0.6 * earS);
      const rootR = hr * (round ? 0.38 : 0.34) * Math.sqrt(earS);
      const tipR = round ? hr * 0.2 * Math.sqrt(earS) : hr * 0.055;
      const foldAt = type === 'semi' ? 0.58 : 1;
      const knee = base.clone().addScaledVector(dir, len * foldAt);
      const shaft = P(roundCone({
        a: base, b: knee,
        r1: rootR, r2: THREE.MathUtils.lerp(rootR, tipR, foldAt),
        k: 0.05, tag: 'ear', u0: 0, u1: foldAt,
      }));
      shaft.idleEarSide = side;
      if (type === 'semi') {
        // 折耳：上半截向前倒下来，柴犬 / 边牧的招牌
        const foldDir = right.clone().multiplyScalar(side * 0.2)
          .addScaledVector(up, -0.12)
          .addScaledVector(fwd, 0.98)
          .normalize();
        const fold = P(roundCone({
          a: knee,
          b: knee.clone().addScaledVector(foldDir, len * 0.62),
          r1: THREE.MathUtils.lerp(rootR, tipR, foldAt), r2: tipR,
          k: 0.04, tag: 'ear', u0: foldAt, u1: 1,
        }));
        fold.idleEarSide = side;
      }
      earDef.push({ a: base, dir, len, r1: rootR, r2: tipR, side, type });
    }
  }

  function addTailFromPoints(points, r0, r1t, k = 0.05) {
    if (!tailRootC && points.length) tailRootC = points[0].clone();
    const curve = new THREE.CatmullRomCurve3(points);
    const steps = 16;
    let previous = curve.getPoint(0);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const point = curve.getPoint(t);
      P(roundCone({
        a: previous, b: point,
        r1: THREE.MathUtils.lerp(r0, r1t, (i - 1) / steps),
        r2: THREE.MathUtils.lerp(r0, r1t, t),
        k, tag: 'tail', u: t, u0: (i - 1) / steps, u1: t,
      }));
      previous = point;
    }
  }

  // 尾巴按“每段继续转多少度”生成，而不是几个写死的控制点。
  // curl < 0 是垂尾，0.5 左右是上翘的镰刀尾，接近上限就卷成田园犬的团子尾，
  // 中间任何一个值都是连续过渡，不会出现折断或自穿。
  function addDogTail({
    root,
    back,
    up = WORLD_UP,
    length = tl,
    curlAmount = curl,
    r0 = 0.078,
    r1t = 0.042,
    lean = 0,
    floor = 0.055,
  }) {
    const backDir = back.clone().normalize();
    const upDir = up.clone().addScaledVector(backDir, -up.dot(backDir)).normalize();
    const sideDir = new THREE.Vector3().crossVectors(upDir, backDir).normalize();
    const segments = 8;
    const total = (0.4 + 0.44 * length) * (0.92 + 0.14 * wid);
    const step = total / segments;
    let angle = THREE.MathUtils.lerp(
      -1.2, 1.0,
      THREE.MathUtils.clamp((curlAmount + 0.6) / 1.95, 0, 1)
    );
    const turn = Math.max(0, curlAmount) * 0.56;
    const points = [root.clone()];
    const cursor = root.clone();
    const direction = new THREE.Vector3();
    for (let i = 0; i < segments; i++) {
      direction.copy(backDir).multiplyScalar(Math.cos(angle))
        .addScaledVector(upDir, Math.sin(angle))
        .addScaledVector(sideDir, lean * ((i + 1) / segments));
      cursor.addScaledVector(direction.normalize(), step);
      cursor.y = Math.max(cursor.y, floor);
      points.push(cursor.clone());
      angle += turn;
    }
    addTailFromPoints(points, r0 * wid, r1t * Math.sqrt(wid));
  }

  function addPaw(center, radius) {
    P(sphere({ c: center, r: radius, s: [1.02, 0.7, 1.34], k: 0.06, tag: 'leg' }));
  }

  function addLimb(joints, radii, k = 0.075) {
    for (let i = 0; i < joints.length - 1; i++) {
      P(roundCone({
        a: joints[i], b: joints[i + 1],
        r1: radii[i], r2: radii[i + 1],
        k, tag: 'leg',
      }));
    }
  }

  // 后腿的膝—跗二段折线。这条折线是四足动物侧影里最先被认出来的特征，
  // 简化成一根直柱就没有狗味了。
  function addHindLeg(side, hip, footZ, legHeight, thickness = 1) {
    const x = side * 0.185 * wid;
    const footY = 0.082;
    // 站立时的后腿角度。之前膝盖往前伸 0.30、跗关节又往后拐 0.16，一条腿
    // 画成了一个大 Z 字——那是蹲踞或者预备起跳的姿势，不是站着。
    //
    // 正常站姿的比例（以离地高度算）：
    //   髋 100% ── 膝约 56%，只比髋略微靠前 ── 跗约 26%，基本回到髋的正下方
    //   ── 跗关节以下那一截（跖骨）几乎垂直落地
    // 保留折线是对的，狗的后腿本来就不是直柱；但幅度要收到这个量级。
    const stifle = V(x * 1.03, footY + legHeight * 0.56, footZ + legHeight * 0.15);
    const hock = V(x, footY + legHeight * 0.26, footZ - legHeight * 0.02);
    const ankle = V(x, footY + 0.05, footZ - legHeight * 0.01);
    addLimb(
      [hip, stifle, hock, ankle],
      [0.178 * wid * thickness, 0.128 * thickness, 0.094 * thickness, 0.085 * thickness]
    );
    addPaw(V(x, footY, footZ + 0.04), 0.108 * thickness);
  }

  function addForeLeg(side, shoulder, footZ, legHeight, thickness = 1) {
    const x = side * 0.17 * wid;
    const footY = 0.082;
    const elbow = V(x * 1.02, footY + legHeight * 0.5, footZ - legHeight * 0.05);
    const wrist = V(x, footY + 0.08, footZ + 0.02);
    addLimb(
      [shoulder, elbow, wrist],
      [0.138 * wid * thickness, 0.11 * thickness, 0.09 * thickness]
    );
    addPaw(V(x, footY, footZ + 0.07), 0.105 * thickness);
  }

  // ---- 姿势 ---------------------------------------------------------------

  if (pose === 'sit') {
    // 端坐：后半身坐在地上，脊柱斜向上，前腿笔直撑住
    const frontLen = 0.24 + 0.4 * legF;
    const rumpY = 0.26 * wid;
    const chestY = 0.14 + frontLen * 0.95;
    const rumpZ = -0.42 * tor;
    const chestZ = 0.26 * tor;
    P(sphere({ c: V(0, rumpY + 0.1, rumpZ), r: 0.36 * wid, s: [1, 1.02, 0.98], k: 0.16, tag: 'body' }));
    P(roundCone({
      a: V(0, rumpY + 0.18, rumpZ + 0.08), b: V(0, chestY, chestZ),
      r1: 0.31 * wid, r2: 0.28 * wid, k: 0.18, tag: 'body',
    }));
    P(sphere({ c: V(0, chestY + 0.02, chestZ + 0.04), r: 0.27 * wid, s: [1, 1.1, 0.94], k: 0.15, tag: 'body' }));
    addHead(
      V(0, chestY + 0.22 + hr * 0.6, chestZ + 0.1 + hr * 0.06),
      V(0, 0.06, 1),
      V(0, chestY + 0.06, chestZ + 0.02),
      0.24 * wid
    );
    for (const side of [-1, 1]) {
      addForeLeg(side, V(side * 0.16 * wid, chestY - 0.06, chestZ + 0.02), chestZ + 0.06, frontLen);
      // 折叠的后腿：大腿平摊在体侧，跗关节支在身前
      addLimb(
        [
          V(side * 0.2 * wid, rumpY + 0.14, rumpZ + 0.04),
          V(side * 0.28 * wid, rumpY * 0.62 + 0.08, rumpZ + 0.34),
          V(side * 0.25 * wid, 0.13, rumpZ + 0.2),
          V(side * 0.24 * wid, 0.1, rumpZ + 0.44),
        ],
        [0.192 * wid, 0.14, 0.098, 0.088]
      );
      addPaw(V(side * 0.24 * wid, 0.082, rumpZ + 0.5), 0.105);
    }
    addDogTail({
      root: V(0, rumpY + 0.16, rumpZ - 0.26 * wid),
      back: V(0, 0, -1),
      lean: rng.range(-0.3, 0.3),
    });
    spinePoints = [
      V(0, chestY + 0.14, chestZ + 0.16),
      V(0, (chestY + rumpY) * 0.5 + 0.12, (chestZ + rumpZ) * 0.5),
      V(0, rumpY + 0.17, rumpZ - 0.2),
    ];
    chestHint = V(0, chestY - 0.02, chestZ + 0.2 * wid);
    gradLow = 0.08;
    gradHigh = chestY + 0.4;
  } else if (pose === 'sphinx') {
    // 趴卧：肚子贴地，前腿向前平伸，头抬起来看人
    const bodyY = 0.2 * wid + 0.08;
    const rumpZ = -0.44 * tor;
    const chestZ = 0.34 * tor;
    P(sphere({ c: V(0, bodyY, -0.04 * tor), r: 0.33, s: [1.16 * wid, 0.9, 1.6 * tor], k: 0.16, tag: 'body' }));
    P(sphere({ c: V(0, bodyY + 0.06, rumpZ), r: 0.31 * wid, s: [1.06, 0.94, 0.94], k: 0.15, tag: 'body' }));
    P(sphere({ c: V(0, bodyY + 0.08, chestZ), r: 0.28 * wid, s: [1.02, 1, 0.94], k: 0.15, tag: 'body' }));
    addHead(
      V(0, bodyY + 0.24 + hr * 0.56, chestZ + 0.12 + hr * 0.2),
      V(0, 0.1, 1),
      V(0, bodyY + 0.14, chestZ + 0.06),
      0.24 * wid
    );
    for (const side of [-1, 1]) {
      addLimb(
        [
          V(side * 0.18 * wid, bodyY + 0.02, chestZ - 0.02),
          V(side * 0.18 * wid, 0.12, chestZ + 0.24),
          V(side * 0.18 * wid, 0.085, chestZ + 0.44),
        ],
        [0.14 * wid, 0.106, 0.09]
      );
      addPaw(V(side * 0.18 * wid, 0.078, chestZ + 0.52), 0.105);
      // 后腿收在体侧，只露出大腿轮廓和小脚
      P(sphere({
        c: V(side * 0.3 * wid, bodyY - 0.02, rumpZ + 0.1),
        r: 0.19, s: [0.72, 0.92, 1.24], k: 0.13, tag: 'leg',
      }));
      addPaw(V(side * 0.27 * wid, 0.078, rumpZ + 0.3), 0.1);
    }
    addDogTail({
      root: V(0, bodyY + 0.06, rumpZ - 0.26 * wid),
      back: V(0, 0, -1),
      curlAmount: Math.min(curl, 0.75),
      lean: rng.range(0.25, 0.75) * (rng.chance(0.5) ? 1 : -1),
      floor: 0.05,
    });
    spinePoints = [
      V(0, bodyY + 0.09 * wid, chestZ + 0.2),
      V(0, bodyY + 0.1 * wid, 0),
      V(0, bodyY + 0.09 * wid, rumpZ - 0.2),
    ];
    chestHint = V(0, bodyY - 0.02, chestZ + 0.16 * wid);
    gradLow = 0.06;
    gradHigh = bodyY + 0.5;
  } else if (pose === 'playBow') {
    // 邀玩趴：前身压低贴地、屁股高高撅起、尾巴举起来——狗独有的“来玩呀”
    const rearLen = 0.3 + 0.42 * legF;
    const rumpY = rearLen + 0.24 * wid;
    const chestY = 0.18 * wid + 0.1;
    const rumpZ = -0.42 * tor;
    const chestZ = 0.36 * tor;
    P(sphere({ c: V(0, rumpY, rumpZ), r: 0.34 * wid, s: [1, 1.04, 0.96], k: 0.16, tag: 'body' }));
    P(roundCone({
      a: V(0, rumpY - 0.02, rumpZ + 0.1), b: V(0, chestY + 0.06, chestZ),
      r1: 0.3 * wid, r2: 0.27 * wid, k: 0.18, tag: 'body',
    }));
    P(sphere({ c: V(0, chestY + 0.06, chestZ), r: 0.26 * wid, s: [1.02, 1, 0.98], k: 0.15, tag: 'body' }));
    addHead(
      V(0, chestY + 0.2 + hr * 0.5, chestZ + 0.16 + hr * 0.22),
      V(0, 0.3, 1),
      V(0, chestY + 0.1, chestZ + 0.06),
      0.23 * wid
    );
    for (const side of [-1, 1]) {
      addLimb(
        [
          V(side * 0.17 * wid, chestY, chestZ - 0.02),
          V(side * 0.17 * wid, 0.1, chestZ + 0.26),
          V(side * 0.17 * wid, 0.08, chestZ + 0.46),
        ],
        [0.136 * wid, 0.105, 0.089]
      );
      addPaw(V(side * 0.17 * wid, 0.076, chestZ + 0.55), 0.104);
      addHindLeg(side, V(side * 0.19 * wid, rumpY - 0.06, rumpZ + 0.02), rumpZ + 0.04, rearLen);
    }
    addDogTail({
      root: V(0, rumpY + 0.2 * wid, rumpZ - 0.24 * wid),
      back: V(0, 0, -1),
      curlAmount: Math.max(curl, 0.45),
      lean: rng.range(-0.45, 0.45),
    });
    spinePoints = [
      V(0, chestY + 0.11, chestZ + 0.18),
      V(0, (chestY + rumpY) * 0.5 + 0.06, 0),
      V(0, rumpY + 0.07, rumpZ - 0.2),
    ];
    chestHint = V(0, chestY, chestZ + 0.16 * wid);
    gradLow = 0.06;
    gradHigh = rumpY + 0.4;
  } else if (pose === 'beg') {
    // 作揖。参考真实的狗作揖：整个上半身几乎是竖直的，两只前爪并在一起、
    // 顶到下巴底下（不是垂在胸口），头还会往一侧歪。
    const rumpY = 0.24 * wid;
    const rumpZ = -0.26 * tor;
    const chestY = rumpY + 0.46 + 0.28 * legF;
    P(sphere({ c: V(0, rumpY + 0.1, rumpZ), r: 0.36 * wid, s: [1.02, 1.04, 0.98], k: 0.16, tag: 'body' }));
    // 躯干立起来：胸口基本压在胯正上方，而不是往前探
    P(roundCone({
      a: V(0, rumpY + 0.16, rumpZ + 0.1), b: V(0, chestY, -0.01 * tor),
      r1: 0.33 * wid, r2: 0.23 * wid, k: 0.18, tag: 'body',
    }));
    P(sphere({ c: V(0, chestY + 0.03, 0.01 * tor), r: 0.23 * wid, s: [1.0, 1.06, 0.94], k: 0.15, tag: 'body' }));
    const headRoll = rng.range(0.1, 0.22) * (rng.chance(0.5) ? 1 : -1);
    addHead(
      V(0, chestY + 0.24 + hr * 0.6, 0.04 * tor + hr * 0.06),
      V(0, 0.06, 1),
      V(0, chestY + 0.06, 0.01 * tor),
      0.21 * wid,
      headRoll
    );
    // 合掌点顶到下巴底下。之前放在胸口高度，读出来只是"抱着手站着"。
    const clasp = V(0, chestY + 0.2 + hr * 0.06, 0.2 * wid + 0.16);
    for (const side of [-1, 1]) {
      // 肩 → 肘垂到体侧下方 → 小臂折上来向中线收 → 两只爪子在 clasp 并拢。
      // 肘朝下、小臂朝上，这个折法才是"作揖"，肘平举出去就成了投降。
      const shoulder = V(side * 0.17 * wid, chestY - 0.02, 0.06 * tor);
      const elbow = V(side * 0.24 * wid, chestY - 0.24, 0.16 * wid + 0.06);
      const wrist = V(side * 0.16 * wid, chestY + 0.02, 0.22 * wid + 0.14);
      const paw = clasp.clone().addScaledVector(V(1, 0, 0), side * 0.042 * wid);
      addLimb([shoulder, elbow, wrist, paw], [0.1 * wid, 0.082, 0.07, 0.064], 0.016);
      P(sphere({ c: paw, r: 0.082, s: [0.9, 1.08, 1.04], k: 0.02, tag: 'leg' }));
      // 折叠的后腿仍然撑在地面上
      addLimb(
        [
          V(side * 0.21 * wid, rumpY + 0.14, rumpZ + 0.02),
          V(side * 0.28 * wid, rumpY * 0.6 + 0.1, rumpZ + 0.32),
          V(side * 0.25 * wid, 0.13, rumpZ + 0.18),
          V(side * 0.24 * wid, 0.1, rumpZ + 0.4),
        ],
        [0.186 * wid, 0.135, 0.096, 0.086]
      );
      addPaw(V(side * 0.24 * wid, 0.082, rumpZ + 0.46), 0.104);
    }
    // 合十处补一小团，让两只爪子读起来是"贴在一起"而不是"挨得很近"
    P(sphere({ c: clasp, r: 0.072 * wid, s: [1.24, 1.1, 1.0], k: 0.045, tag: 'leg' }));
    addDogTail({
      root: V(0, rumpY + 0.14, rumpZ - 0.26 * wid),
      back: V(0, 0, -1),
      lean: rng.range(-0.3, 0.3),
    });
    spinePoints = [
      V(0, chestY + 0.18, -0.04 * tor),
      V(0, (chestY + rumpY) * 0.5 + 0.1, (rumpZ - 0.02 * tor) * 0.5),
      V(0, rumpY + 0.17, rumpZ - 0.18),
    ];
    chestHint = V(0, chestY - 0.1, 0.2 * wid);
    gradLow = 0.08;
    gradHigh = chestY + 0.4;
  } else {
    // standing：四条腿站直的默认站姿
    const legLen = 0.22 + 0.42 * legF;
    const bodyY = legLen + 0.28 * wid;
    const half = 0.42 * tor;
    P(sphere({
      c: V(0, bodyY + 0.03 * wid, -0.02 * tor), r: 0.3,
      s: [0.86 * wid, 0.82, 1.5 * tor], k: 0.16, tag: 'body',
    }));
    // 深胸：狗的前胸比腰粗，这一块决定了侧影的方向感
    P(sphere({ c: V(0, bodyY - 0.01, half * 0.66), r: 0.31 * wid, s: [1, 1.1, 0.94], k: 0.16, tag: 'body' }));
    P(sphere({ c: V(0, bodyY + 0.05, -half * 0.78), r: 0.3 * wid, s: [1.02, 1, 0.96], k: 0.16, tag: 'body' }));
    // 腹下那块只铺到胸腔后缘为止。深胸 + 收腹是狗侧影的招牌，
    // 而不是从前到后一整条等粗的圆桶。
    P(sphere({
      c: V(0, bodyY - 0.06 * wid, half * 0.38), r: 0.27 * wid,
      s: [0.96, 1.0, 1.05], k: 0.18, tag: 'body',
    }));
    const withers = V(0, bodyY + 0.2 * wid, half * 0.62);
    addHead(
      V(0, bodyY + 0.3 * wid + 0.16 + hr * 0.54, half * 0.66 + 0.18 + hr * 0.3),
      V(0, -0.05, 1),
      withers,
      0.25 * wid
    );
    for (const side of [-1, 1]) {
      addForeLeg(side, V(side * 0.17 * wid, bodyY - 0.02, half * 0.6), half * 0.62, legLen);
      addHindLeg(side, V(side * 0.19 * wid, bodyY + 0.02, -half * 0.74), -half * 0.7, legLen);
    }
    addDogTail({
      root: V(0, bodyY + 0.22 * wid, -half - 0.1 * wid),
      back: V(0, 0, -1),
      lean: rng.range(-0.28, 0.28),
    });
    spinePoints = [
      V(0, bodyY + 0.06 * wid, half * 1.02),
      V(0, bodyY + 0.08 * wid, 0),
      V(0, bodyY + 0.1 * wid, -half * 1.06),
    ];
    chestHint = V(0, bodyY - 0.06, half * 0.66 + 0.2 * wid);
    gradLow = legLen * 0.45;
    gradHigh = bodyY + 0.34;
  }

  addEars(options.earType, options.earTip);

  // ---- 网格化 -------------------------------------------------------------
  let boundsVolume = DOG_MESH_REFERENCE_VOLUME;
  {
    const min = [1e9, 1e9, 1e9];
    const max = [-1e9, -1e9, -1e9];
    for (const primitive of prims) {
      min[0] = Math.min(min[0], primitive.bx - primitive.br);
      max[0] = Math.max(max[0], primitive.bx + primitive.br);
      min[1] = Math.min(min[1], primitive.by - primitive.br);
      max[1] = Math.max(max[1], primitive.by + primitive.br);
      min[2] = Math.min(min[2], primitive.bz - primitive.br);
      max[2] = Math.max(max[2], primitive.bz + primitive.br);
    }
    boundsVolume = (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);
  }
  const cell = resolveDogMeshCellSize(quality, boundsVolume);
  const geometry = meshFromSDF(prims, cell);
  const meshCompletedAt = performance.now();
  geometry.userData.meshCellSize = cell;
  geometry.userData.meshQuality = quality;

  // ---- 花色 ---------------------------------------------------------------
  const cSaddle = new THREE.Color(options.saddleColor ?? coat.saddle);
  const cUnder = new THREE.Color(options.underColor ?? coat.under);
  const cAccent = new THREE.Color(coat.accent);
  const cWhite = new THREE.Color('#f8f4ea');
  const kind = coat.kind;
  const sampleSpine = makeSpineSampler(spinePoints, spineUp);

  // wrap 是背鞍从脊柱往下包的角度：1.35rad ≈ 77°，正好盖住体侧的上三分之二，
  // 肚子和胸口留给底色。blanket 包到接近体侧最下沿。
  const saddleWrap = coat.saddleWrap ?? (kind === 'blanket' ? 1.95 : 1.35);
  const saddleStart = coat.saddleStart ?? (kind === 'blanket' ? -0.06 : 0.04);
  const saddleEnd = coat.saddleEnd ?? (kind === 'blanket' ? 1.06 : 0.99);

  // 随机但可复现的斑块 / 斑点：偏向背侧分布，这样白底狗看起来仍然是
  // “背上有花”，而不是随机泼了一身颜料。
  const patchBlobs = [];
  const patchCount = 3 + Math.floor(rng.next() * 3);
  for (let i = 0; i < patchCount; i++) {
    patchBlobs.push({
      t: rng.range(0.05, 0.95),
      around: rng.range(0, 1.05),
      side: rng.chance(0.5) ? 1 : -1,
      r: rng.range(0.26, 0.46),
    });
  }
  const brindlePhase = rng.range(0, Math.PI * 2);
  const brindleFreq = rng.range(11, 16);

  const position = geometry.getAttribute('position');

  const colors = new Float32Array(position.count * 3);
  const rigPart = new Float32Array(position.count);
  const idleRegion = new Float32Array(position.count * 3);
  const idleTailU = new Float32Array(position.count);
  const point = new THREE.Vector3();
  const out = new THREE.Color();

  const headC = headFrame.c;
  const { fwd: headFwd, up: headUp, right: headRight, snoutDir } = headFrame;
  const muzzleDistance = (p) => {
    const local = p.clone().sub(muzzleTip);
    const along = local.dot(snoutDir);
    const lateral = local.clone().addScaledVector(snoutDir, -along).length();
    return Math.hypot(Math.max(0, -along) * 0.62, lateral);
  };

  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    const primitive = nearestPrim(prims, point.x, point.y, point.z);
    const tag = primitive?.tag ?? 'body';
    const u = primitive?.uAt ? primitive.uAt(point.x, point.y, point.z) : (primitive?.u ?? 0);
    const isHead = tag === 'head' || tag === 'muzzle' || tag === 'ear';
    rigPart[i] = isHead ? 1 : tag === 'leg' ? 2 : tag === 'tail' ? 3 : 0;

    if (tag === 'tail') {
      idleRegion[i * 3] = 1;
      idleTailU[i] = THREE.MathUtils.clamp(u, 0, 1);
    } else if (tag === 'ear') {
      const earWeight = sstep(0.04, 0.36, THREE.MathUtils.clamp(u, 0, 1));
      if (primitive?.idleEarSide < 0) idleRegion[i * 3 + 1] = earWeight;
      else if (primitive?.idleEarSide > 0) idleRegion[i * 3 + 2] = earWeight;
    }

    const spine = sampleSpine(point);
    const grain = paintNoise(point);
    const edge = grain * 0.11;
    const heightGrade = sstep(gradLow, gradLow + (gradHigh - gradLow) * 0.3, point.y);

    // 背鞍：绕脊柱角度 + 沿脊柱位置的双向柔边，边界用噪声撕出毛感
    let saddle = sstep(saddleWrap + 0.2, saddleWrap - 0.14, spine.around + edge)
      * sstep(saddleStart - 0.06, saddleStart + 0.09, spine.t + edge * 0.09)
      * sstep(saddleEnd + 0.06, saddleEnd - 0.09, spine.t + edge * 0.09);
    // 头和四肢从来不属于背鞍
    if (isHead || tag === 'leg') saddle = 0;

    const nearMuzzle = muzzleDistance(point);
    const belowSnout = tag === 'muzzle' || tag === 'head'
      ? sstep(hr * 0.16, -hr * 0.1, point.clone().sub(muzzleTip).dot(headUp))
      : 0;
    const underChin = (tag === 'muzzle' || tag === 'head')
      ? sstep(hr * 0.9, hr * 0.44, nearMuzzle) * belowSnout
      : 0;

    if (kind === 'solid') {
      out.copy(cSaddle);
      out.lerp(cUnder, (1 - heightGrade) * 0.72);
    } else if (kind === 'tanPoints') {
      // 铁包金 / 四眼：主体深色，眉点、脸颊、胸口、四肢下段是 accent
      out.copy(cSaddle);
      // 四眼狗的浅色只出现在几个固定位置：四肢下段、脸颊两侧、胸口，
      // 其余部分保持深色。用整体高度渐变会把大半只狗染成浅色。
      let tan = sstep(2.3, 2.9, spine.around) * 0.55;
      if (tag === 'leg') tan = Math.max(tan, sstep(0.6, 0.26, point.y));
      if (tag === 'muzzle' || tag === 'head') {
        tan = Math.max(tan, sstep(hr * 0.82, hr * 0.44, nearMuzzle) * 0.8);
      }
      out.lerp(cAccent, THREE.MathUtils.clamp(tan + grain * 0.04, 0, 1));
    } else if (kind === 'patched') {
      out.copy(cUnder);
      let patch = 0;
      for (const blob of patchBlobs) {
        const distance = Math.hypot(
          (spine.t - blob.t) * 1.25,
          (spine.around - blob.around) * 0.34
        ) + grain * 0.03;
        patch = Math.max(patch, sstep(blob.r, blob.r * 0.62, distance));
      }
      if (isHead) {
        // 头上的斑：偏一侧的“单眼罩”，这是花斑田园犬最可爱的地方
        const faceSide = (point.x - headC.x) * patchBlobs[0].side;
        patch = Math.max(
          patch,
          sstep(-hr * 0.1, hr * 0.36, faceSide + grain * hr * 0.12)
            * sstep(hr * 0.05, hr * 0.55, point.y - headC.y + hr * 0.4)
            * (tag === 'muzzle' ? 0.15 : 1)
        );
      }
      out.lerp(cSaddle, patch);
    } else if (kind === 'brindle') {
      out.copy(cUnder).lerp(cSaddle, 0.62 + 0.38 * heightGrade);
      // 虎斑是竖向的：沿脊柱方向排线，向腹部逐渐消失
      const stripe = Math.sin(spine.t * brindleFreq * Math.PI + brindlePhase + grain * 0.55);
      out.lerp(cAccent, sstep(0.42, 0.72, stripe) * sstep(2.5, 1.2, spine.around) * 0.85);
    } else {
      // saddle / blanket
      out.copy(cUnder);
      out.lerp(cSaddle, saddle);
      if (kind === 'blanket') {
        // 头盖：罩住颅顶和耳朵，眼睛以下留白，形成哈士奇式的面罩
        const cap = isHead
          ? sstep(-hr * 0.06, hr * 0.16, (point.clone().sub(headC).dot(headUp)) + grain * hr * 0.14)
            * (1 - sstep(hr * 0.5, hr * 0.2, nearMuzzle))
          : 0;
        out.lerp(cSaddle, cap);
      }
    }

    // ---- 通用标记：口吻下方、白袜、胸花、尾尖 ----
    // 口吻和下巴天生比背毛浅，但只往底色靠，不往纯白靠——
    // 直接刷白会把铁包金、灰狼犬这种深色狗的脸整块洗掉。
    out.lerp(cUnder, underChin * 0.62);
    if (tag === 'leg') {
      const sock = sstep(0.42, 0.16, point.y) * coat.socks;
      out.lerp(cWhite, sock * (0.75 + grain * 0.12));
    }
    if (tag === 'tail') {
      out.lerp(cWhite, sstep(0.68, 0.94, u) * coat.tailTip);
    }
    if (chestHint) {
      const chest = sstep(0.3 * wid, 0.08, point.distanceTo(chestHint) + grain * 0.04);
      out.lerp(cWhite, chest * coat.blaze * 0.8);
    }
    if (isHead && coat.blaze > 0.5) {
      // 额中白线：从鼻梁一路顶到脑门，是最容易读出来的“花脸”
      const lateral = Math.abs(point.clone().sub(headC).dot(headRight)) + grain * hr * 0.1;
      const forward = point.clone().sub(headC).dot(headFwd);
      out.lerp(
        cWhite,
        sstep(hr * 0.26, hr * 0.08, lateral) * sstep(hr * 0.1, hr * 0.45, forward) * coat.blaze * 0.9
      );
    }
    // 眉点：深色狗的两颗浅色眉毛，卡通表情的来源
    if (options.eyebrowDots && (tag === 'head' || tag === 'muzzle')) {
      const local = point.clone().sub(headC);
      const lateral = Math.abs(local.dot(headRight));
      const vertical = local.dot(headUp);
      const forward = local.dot(headFwd);
      const brow = sstep(hr * 0.28, hr * 0.1, Math.abs(lateral - hr * 0.42))
        * sstep(hr * 0.22, hr * 0.06, Math.abs(vertical - hr * 0.36))
        * sstep(hr * 0.2, hr * 0.5, forward);
      out.lerp(cAccent, brow * 0.85);
    }

    colors[i * 3] = out.r;
    colors[i * 3 + 1] = out.g;
    colors[i * 3 + 2] = out.b;
  }
  const vertexDataCompletedAt = performance.now();

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('rigPart', new THREE.BufferAttribute(rigPart, 1));
  geometry.setAttribute('idleRegion', new THREE.BufferAttribute(idleRegion, 3));
  geometry.setAttribute('idleTailU', new THREE.BufferAttribute(idleTailU, 1));

  // 炸毛必须赶在生成描边之前：反壳描边是从这份几何拷出去的，
  // 晚一步的话轮廓线还是贴着光滑的旧表面，毛就"炸"在描边里面了。
  // 三个系数分别是：毛刺长度、脸部保护罩大小、噪声频率。
  // 保护罩要开得足够大，把整张脸连同眼睛、鼻子、嘴一起罩进去——
  // 五官都是贴在原始曲面上的独立贴片，底下一旦被顶起来就会露馅。
  applyFluffGeometry(
    geometry,
    options.fluffy ? (options.furFluff ?? 0.9) : 0,
    options.seed ?? 1,
    headFrame.c,
    hr,
    1,
    1.9,
    1
  );

  const leftEar = earDef.find((ear) => ear.side < 0);
  const rightEar = earDef.find((ear) => ear.side > 0);
  const idleState = createDogIdleState({
    tailPivot: tailRootC ?? V(0, 0.55, -0.6),
    earLeftPivot: leftEar?.a ?? headC,
    earRightPivot: rightEar?.a ?? headC,
  });

  const furMaterial = injectDogIdle(
    injectPoke(injectBodyHatch(new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: toonGradientMap(),
    }))),
    idleState
  );
  furMaterial.customProgramCacheKey = () => 'dog-poke-bodyhatch-idle-v1';
  furMaterial.shadowSide = THREE.FrontSide;
  const furMesh = new THREE.Mesh(geometry, furMaterial);
  furMesh.castShadow = true;
  furMesh.receiveShadow = false;
  furMesh.name = 'fur';

  const dog = new THREE.Group();
  dog.name = 'ProceduralDog';
  const furOutline = makeOutline(
    geometry,
    // 缩放前的厚度：乘上 DOG_WORLD_SCALE 之后落在 0.011 这个手绘线宽上
    0.011 / DOG_WORLD_SCALE,
    '#463228',
    options.outlineJitter ?? 0,
    (material) => injectDogIdle(material, idleState)
  );
  dog.add(furMesh, furOutline);
  dog.userData.idleState = idleState;
  dog.userData.updateIdle = (time, delta, enabled = true) => (
    updateDogIdle(idleState, time, delta, enabled)
  );

  // ---- 五官 ---------------------------------------------------------------
  const face = new THREE.Group();
  face.name = 'face';
  dog.add(face);

  // 眼睛：横向的杏仁形眼裂 + 圆瞳，长在止部上方、偏向两侧。
  // 贴片本身也得是扁的（宽 : 高 ≈ 3.1 : 2.1），否则杏仁会被挤回圆形。
  const eyeR = hr * 0.185 * options.eyeSize;
  const irisRatio = THREE.MathUtils.clamp(0.88 * (options.irisScale ?? 0.62), 0.14, 0.98);
  const eyeAnimators = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const centerDir = headFwd.clone().multiplyScalar(0.84)
      .addScaledVector(headRight, side * 0.44)
      .addScaledVector(headUp, 0.24)
      .normalize();
    const eye = makeEyeDecal(prims, headC, centerDir, eyeR, options.eyeColor, irisRatio, 0, -side, {
      painter: createDogEyeTexture,
      widthScale: 3.1,
      heightScale: 2.1,
      // 两只眼睛共用头的 up，左右才是严格镜像；头歪的时候眼睛跟着一起歪
      upHint: headUp,
    });
    eyeAnimators.push(eye.userData.eyeAnimator);
    face.add(eye);
  }
  dog.userData.updateEyeAnimation = (time, gazeX = 0, gazeY = 0) => {
    for (const animate of eyeAnimators) animate(time, gazeX, gazeY);
  };
  dog.userData.updateTongue = (time, energy = 1) => {
    tongueMesh?.userData.updateTongue(time, energy);
  };

  // 鼻子：狗的鼻头又大又黑，是整张脸的重心。压扁的球 + 一点高光。
  const noseMaterial = new THREE.MeshToonMaterial({
    color: '#2f2823',
    gradientMap: toonGradientMap(),
  });
  const noseGeometry = new THREE.SphereGeometry(hr * 0.165, 18, 14);
  noseGeometry.scale(1.3, 0.94, 0.92);
  const nose = new THREE.Mesh(noseGeometry, noseMaterial);
  nose.position.copy(
    muzzleTip.clone()
      .addScaledVector(snoutDir, hr * 0.14)
      .addScaledVector(headUp, hr * 0.08)
  );
  nose.quaternion.setFromUnitVectors(V(0, 0, 1), snoutDir);
  face.add(nose);
  const noseHighlight = new THREE.Mesh(
    new THREE.SphereGeometry(hr * 0.036, 10, 8),
    new THREE.MeshBasicMaterial({ color: '#fff8ec' })
  );
  noseHighlight.position.copy(
    nose.position.clone()
      .addScaledVector(snoutDir, hr * 0.1)
      .addScaledVector(headUp, hr * 0.06)
      .addScaledVector(headRight, -hr * 0.05)
  );
  face.add(noseHighlight);

  // 嘴：鼻子下一条短竖线 + 左右两道向上翘的弧，合起来是狗的招牌笑脸
  const inkMaterial = new THREE.MeshBasicMaterial({ color: '#463228' });
  const mouthTop = nose.position.clone().addScaledVector(headUp, -hr * 0.11);
  // 管状线条的几何顶点已经是模型坐标，自身 position 恒为原点。
  // 戳捏同步要按线条真实所在的位置取形变量，所以显式记下参考点。
  const addInkPart = (mesh, reference) => {
    mesh.userData.refPos = reference.clone();
    face.add(mesh);
  };
  addInkPart(
    new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.LineCurve3(mouthTop, mouthCenter.clone().addScaledVector(headUp, hr * 0.02)),
        4, hr * 0.022, 5
      ),
      inkMaterial
    ),
    mouthTop
  );
  for (const side of [-1, 1]) {
    const start = mouthCenter.clone().addScaledVector(headUp, hr * 0.02);
    const mid = mouthCenter.clone()
      .addScaledVector(headRight, side * hr * 0.2)
      .addScaledVector(headUp, -hr * 0.09);
    const end = mouthCenter.clone()
      .addScaledVector(headRight, side * hr * 0.4)
      .addScaledVector(headUp, hr * 0.03)
      .addScaledVector(headFwd, -hr * 0.06);
    addInkPart(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, mid, end), 14, hr * 0.022, 5),
        inkMaterial
      ),
      mid
    );
  }

  let tongueMesh = null;
  if (options.tongueOut) {
    // 嘴洞：舌头后面的一小片深色。没有它，舌头是"贴"在下巴上的，
    // 有了它才是从嘴里"伸"出来的。
    const mouthOpen = mouthCenter.clone().addScaledVector(headUp, -hr * 0.03);
    const mouthGap = new THREE.Mesh(
      new THREE.SphereGeometry(hr * 0.115, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#7c3a40' })
    );
    mouthGap.geometry.scale(1.3, 0.66, 0.5);
    mouthGap.position.copy(mouthOpen.clone().addScaledVector(headUp, -hr * 0.01));
    mouthGap.quaternion.setFromUnitVectors(V(0, 0, 1), snoutDir);
    addInkPart(mouthGap, mouthOpen);

    // 舌头本体：多边形软舌，每帧按中轴线重排顶点
    const lollSide = rng.chance(0.5) ? 1 : -1;
    tongueMesh = createDogTongue(hr);
    const tongueDown = snoutDir.clone().multiplyScalar(0.3)
      .addScaledVector(headUp, -1)
      .addScaledVector(headRight, lollSide * 0.22)
      .normalize();
    const tongueUp = tongueDown.clone().negate();
    const tongueFront = snoutDir.clone().addScaledVector(headUp, 0.28).normalize();
    const tongueSide = new THREE.Vector3().crossVectors(tongueUp, tongueFront).normalize();
    tongueFront.crossVectors(tongueSide, tongueUp).normalize();
    tongueMesh.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(tongueSide, tongueUp, tongueFront)
    );
    tongueMesh.position.copy(mouthOpen);
    tongueMesh.userData.refPos = mouthOpen.clone();
    face.add(tongueMesh);
  }

  // 触须点：吻部两侧几颗明显的黑色须根点。画成长胡须会很奇怪，
  // 这几个点才是狗脸上对的细节。
  const whiskerDotMaterial = new THREE.MeshBasicMaterial({ color: '#3a2b24' });
  for (const side of [-1, 1]) {
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 2; column++) {
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(hr * 0.014, 8, 6),
          whiskerDotMaterial
        );
        const position = muzzleTip.clone()
          .addScaledVector(snoutDir, -hr * (0.1 + column * 0.11))
          .addScaledVector(headRight, side * hr * (0.13 + column * 0.03))
          .addScaledVector(headUp, hr * (0.02 - row * 0.05));
        dot.position.copy(position);
        dot.userData.refPos = position.clone();
        face.add(dot);
      }
    }
  }

  // 耳内：贴到真实曲面上的 decal，不是会穿模的平面零件
  const surfaceDetails = new THREE.Group();
  surfaceDetails.name = 'surfaceDetails';
  for (const ear of earDef) {
    const texture = makeDecalTexture((ctx) => {
      ctx.clearRect(0, 0, 256, 256);
      const wash = ctx.createLinearGradient(128, 30, 128, 226);
      wash.addColorStop(0, 'rgba(246, 200, 196, 0.6)');
      wash.addColorStop(1, 'rgba(222, 148, 152, 0.34)');
      ctx.save();
      ctx.filter = 'blur(16px)';
      ctx.fillStyle = wash;
      ctx.beginPath();
      ctx.ellipse(128, 132, 74, 96, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    const inner = ear.a.clone().addScaledVector(ear.dir, ear.len * 0.42);
    const outward = ear.type === 'floppy'
      ? headFrame.right.clone().multiplyScalar(ear.side)
      : headFrame.fwd.clone();
    const geometryPatch = makeSurfacePatch(
      prims,
      inner.clone().addScaledVector(outward, -ear.r1 * 0.6),
      outward,
      ear.r1 * 1.5,
      ear.len * 0.78,
      ear.r1 * 1.4,
      12,
      ear.dir.clone().negate()
    );
    const idle = new Float32Array(geometryPatch.getAttribute('position').count * 3);
    const idleU = new Float32Array(geometryPatch.getAttribute('position').count);
    const uv = geometryPatch.getAttribute('uv');
    const component = ear.side < 0 ? 1 : 2;
    for (let index = 0; index < uv.count; index++) {
      const v = uv.getY(index);
      idle[index * 3 + component] = v * v * (3 - 2 * v);
    }
    geometryPatch.setAttribute('idleRegion', new THREE.BufferAttribute(idle, 3));
    geometryPatch.setAttribute('idleTailU', new THREE.BufferAttribute(idleU, 1));
    const decal = makeSurfaceDecal(
      geometryPatch,
      texture,
      ear.side < 0 ? 'innerEarDecalLeft' : 'innerEarDecalRight',
      3,
      0.004
    );
    decal.material = injectDogIdle(decal.material, idleState);
    surfaceDetails.add(decal);
  }
  dog.add(surfaceDetails);

  for (const child of face.children) {
    if (child.userData.skipPokeSync) continue;
    child.userData.basePos = child.position.clone();
    if (!child.userData.refPos) child.userData.refPos = child.position.clone();
  }

  dog.scale.setScalar(DOG_WORLD_SCALE);

  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  dog.userData.headC = headC.clone();
  dog.userData.hr = hr;
  dog.userData.muzzle = muzzleTip.clone();
  dog.userData.pose = pose;
  dog.userData.worldScale = DOG_WORLD_SCALE;
  // bounds 和碰撞球是给镜头取景和玩具物理用的，两者都工作在世界单位里，
  // 所以在这里就换算好，调用方不需要知道内部用的是放大过的解剖坐标。
  dog.userData.bounds = {
    min: bbox.min.toArray().map((value) => value * DOG_WORLD_SCALE),
    max: bbox.max.toArray().map((value) => value * DOG_WORLD_SCALE),
  };
  // 玩具物理只需要一组粗略的球：躯干、头、尾根
  dog.userData.colliders = [
    {
      c: V(0, bbox.max.y * 0.42, (bbox.min.z + bbox.max.z) * 0.5),
      r: Math.min(bbox.max.x - bbox.min.x, bbox.max.y) * 0.44,
    },
    { c: headC.clone(), r: hr * 1.06 },
  ];
  if (tailRootC) dog.userData.colliders.push({ c: tailRootC.clone(), r: 0.16 * wid });
  for (const collider of dog.userData.colliders) {
    collider.c.multiplyScalar(DOG_WORLD_SCALE);
    collider.r *= DOG_WORLD_SCALE;
  }
  dog.userData.buildTimings = {
    meshMs: meshCompletedAt - buildStartedAt,
    vertexDataMs: vertexDataCompletedAt - meshCompletedAt,
    detailsMs: performance.now() - vertexDataCompletedAt,
    totalMs: performance.now() - buildStartedAt,
  };

  return dog;
}
