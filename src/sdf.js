// SDF 建模内核：基本体 + smooth min 融合 + surface nets 网格化
// 参考：Inigo Quilez distfunctions / smin；Spore 的 metaball 皮肤思路

import * as THREE from 'three';

// 三次 smooth minimum（IQ），k 为融合半径（距离单位）
export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * h * k * (1 / 6);
}

// ---- 基本体 ---------------------------------------------------------------
// 每个 prim: { dist(x,y,z), bx,by,bz,br（包围球）, k（融合半径）, tag, u }

export function sphere({ c, r, k = 0.1, tag = 'body', u = 0, s = null }) {
  if (s) {
    // 近似椭球（IQ bound）：p 按 s 缩放
    const inv = [1 / s[0], 1 / s[1], 1 / s[2]];
    const m = Math.min(s[0], s[1], s[2]);
    return {
      k, tag, u,
      bx: c.x, by: c.y, bz: c.z, br: r * Math.max(s[0], s[1], s[2]) + k,
      dist(x, y, z) {
        const px = (x - c.x) * inv[0], py = (y - c.y) * inv[1], pz = (z - c.z) * inv[2];
        return (Math.sqrt(px * px + py * py + pz * pz) - r) * m;
      },
    };
  }
  return {
    k, tag, u,
    bx: c.x, by: c.y, bz: c.z, br: r + k,
    dist(x, y, z) {
      const px = x - c.x, py = y - c.y, pz = z - c.z;
      return Math.sqrt(px * px + py * py + pz * pz) - r;
    },
  };
}

// 圆角盒：主要用于容器里的实验性软体，让身体能贴合方形开口，
// 同时保留足够圆润的轮廓，不会变成生硬的立方体。
export function roundedBox({
  c,
  half,
  r = 0.12,
  k = 0.1,
  tag = 'body',
  u = 0,
}) {
  const hx = Math.max(0.001, half[0]);
  const hy = Math.max(0.001, half[1]);
  const hz = Math.max(0.001, half[2]);
  const radius = Math.max(0.001, Math.min(r, hx, hy, hz));
  return {
    k, tag, u,
    bx: c.x, by: c.y, bz: c.z,
    br: Math.sqrt(hx * hx + hy * hy + hz * hz) + k,
    dist(x, y, z) {
      const qx = Math.abs(x - c.x) - hx + radius;
      const qy = Math.abs(y - c.y) - hy + radius;
      const qz = Math.abs(z - c.z) - hz + radius;
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const oz = Math.max(qz, 0);
      return Math.sqrt(ox * ox + oy * oy + oz * oz)
        + Math.min(Math.max(qx, Math.max(qy, qz)), 0)
        - radius;
    },
  };
}

// 圆头锥（两端半径不同的胶囊）——四肢 / 尾巴 / 耳朵的主力（IQ sdRoundCone）
export function roundCone({ a, b, r1, r2, k = 0.08, tag = 'body', u = 0, u0 = null, u1 = null }) {
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const srr = Math.sign(rr) * rr * rr;
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, cz = (a.z + b.z) / 2;
  return {
    k, tag, u,
    bx: cx, by: cy, bz: cz,
    br: Math.sqrt(l2) / 2 + Math.max(r1, r2) + k,
    // 沿轴的平滑参数（尾巴渐变 / 环纹用）
    uAt: u0 === null ? null : (x, y, z) => {
      const t = Math.max(0, Math.min(1, ((x - a.x) * bax + (y - a.y) * bay + (z - a.z) * baz) * il2));
      return u0 + (u1 - u0) * t;
    },
    dist(x, y, z) {
      const pax = x - a.x, pay = y - a.y, paz = z - a.z;
      const yd = pax * bax + pay * bay + paz * baz;
      const zd = yd - l2;
      const fx = pax * l2 - bax * yd, fy = pay * l2 - bay * yd, fz = paz * l2 - baz * yd;
      const x2 = fx * fx + fy * fy + fz * fz;
      const y2 = yd * yd * l2;
      const z2 = zd * zd * l2;
      const kq = srr * x2; // 注意：依赖采样点（IQ 原式 k = sign(rr)*rr*rr*x2）
      if (Math.sign(zd) * a2 * z2 > kq) return Math.sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(yd) * a2 * y2 < kq) return Math.sqrt(x2 + y2) * il2 - r1;
      return (Math.sqrt(x2 * a2 * il2) + yd * rr) * il2 - r1;
    },
  };
}

// ---- 场求值 ---------------------------------------------------------------

export function evalField(prims, x, y, z) {
  let d = 1e9;
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i];
    const dx = x - p.bx, dy = y - p.by, dz = z - p.bz;
    // 包围球下界剪枝：超出融合影响范围就跳过
    const lb = Math.sqrt(dx * dx + dy * dy + dz * dz) - p.br;
    if (lb > d + p.k) continue;
    d = smin(d, p.dist(x, y, z), p.k);
  }
  return d;
}

export function nearestPrim(prims, x, y, z) {
  let best = null;
  let bd = 1e9;
  for (let i = 0; i < prims.length; i++) {
    const d = prims[i].dist(x, y, z);
    if (d < bd) {
      bd = d;
      best = prims[i];
    }
  }
  return best;
}

// ---- Surface Nets 网格化 ---------------------------------------------------
// 均匀网格采样 SDF → 每个跨越表面的 cell 放一个顶点（棱交点平均），
// 每条符号翻转的棱连接周围 4 个 cell 出一个 quad。法线取 SDF 梯度，天然光滑。

export function meshFromSDF(prims, cellSize, floorY = 0.004) {
  // 与地面求交：贴地处截出干净的平底（手办感），避免相切薄片
  // 包围盒
  let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
  for (const p of prims) {
    minX = Math.min(minX, p.bx - p.br); maxX = Math.max(maxX, p.bx + p.br);
    minY = Math.min(minY, p.by - p.br); maxY = Math.max(maxY, p.by + p.br);
    minZ = Math.min(minZ, p.bz - p.br); maxZ = Math.max(maxZ, p.bz + p.br);
  }
  const pad = cellSize * 2;
  minX -= pad; minY -= pad; minZ -= pad; maxX += pad; maxY += pad; maxZ += pad;

  const nx = Math.ceil((maxX - minX) / cellSize);
  const ny = Math.ceil((maxY - minY) / cellSize);
  const nz = Math.ceil((maxZ - minZ) / cellSize);
  const sx = nx + 1, sy = ny + 1, sz = nz + 1;

  // 采样
  // Extreme proportions can make the global AABB mostly empty. Sample only
  // the grid points near a primitive so static poses keep their requested
  // surface resolution without paying for that empty volume.
  const field = new Float32Array(sx * sy * sz);
  field.fill(1e6);
  const FI = (i, j, kk) => i + sx * (j + sy * kk);
  const clampIndex = (value, max) => Math.max(0, Math.min(max, value));
  // Bucket nearby primitives by small grid blocks. A long segmented tail can
  // contain dozens of SDF primitives; evaluating every segment at every head
  // or paw sample was the remaining extreme-pose bottleneck.
  const blockSize = 8;
  const blocksX = Math.ceil(sx / blockSize);
  const blocksY = Math.ceil(sy / blockSize);
  const blocksZ = Math.ceil(sz / blockSize);
  const buckets = new Array(blocksX * blocksY * blocksZ);
  const BI = (i, j, kk) => i + blocksX * (j + blocksY * kk);
  for (const primitive of prims) {
    const margin = pad + Math.max(primitive.k ?? 0, cellSize * 2);
    const radius = primitive.br + margin;
    const i0 = clampIndex(Math.floor((primitive.bx - radius - minX) / cellSize), sx - 1);
    const i1 = clampIndex(Math.ceil((primitive.bx + radius - minX) / cellSize), sx - 1);
    const j0 = clampIndex(Math.floor((primitive.by - radius - minY) / cellSize), sy - 1);
    const j1 = clampIndex(Math.ceil((primitive.by + radius - minY) / cellSize), sy - 1);
    const k0 = clampIndex(Math.floor((primitive.bz - radius - minZ) / cellSize), sz - 1);
    const k1 = clampIndex(Math.ceil((primitive.bz + radius - minZ) / cellSize), sz - 1);
    const blockI0 = Math.floor(i0 / blockSize);
    const blockI1 = Math.floor(i1 / blockSize);
    const blockJ0 = Math.floor(j0 / blockSize);
    const blockJ1 = Math.floor(j1 / blockSize);
    const blockK0 = Math.floor(k0 / blockSize);
    const blockK1 = Math.floor(k1 / blockSize);
    for (let bk = blockK0; bk <= blockK1; bk++) {
      for (let bj = blockJ0; bj <= blockJ1; bj++) {
        for (let bi = blockI0; bi <= blockI1; bi++) {
          const bucketIndex = BI(bi, bj, bk);
          (buckets[bucketIndex] ??= []).push(primitive);
        }
      }
    }
  }
  for (let kk = 0; kk < sz; kk++) {
    const z = minZ + kk * cellSize;
    for (let j = 0; j < sy; j++) {
      const y = minY + j * cellSize;
      let idx = FI(0, j, kk);
      for (let i = 0; i < sx; i++, idx++) {
        const bucket = buckets[BI(
          Math.floor(i / blockSize),
          Math.floor(j / blockSize),
          Math.floor(kk / blockSize)
        )];
        if (bucket) {
          field[idx] = Math.max(
            evalField(bucket, minX + i * cellSize, y, z),
            floorY - y
          );
        }
      }
    }
  }

  // cell 顶点
  const cellIndex = new Int32Array(nx * ny * nz).fill(-1);
  const CI = (i, j, kk) => i + nx * (j + ny * kk);
  const positions = [];
  const cornerOfs = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cv = new Float32Array(8);
  for (let kk = 0; kk < nz; kk++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const o = cornerOfs[c];
          cv[c] = field[FI(i + o[0], j + o[1], kk + o[2])];
          if (cv[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 0xff) continue;
        // 棱交点平均
        let px = 0, py = 0, pz = 0, cnt = 0;
        for (const [e0, e1] of edges) {
          const v0 = cv[e0], v1 = cv[e1];
          if ((v0 < 0) === (v1 < 0)) continue;
          const t = v0 / (v0 - v1);
          const o0 = cornerOfs[e0], o1 = cornerOfs[e1];
          px += o0[0] + (o1[0] - o0[0]) * t;
          py += o0[1] + (o1[1] - o0[1]) * t;
          pz += o0[2] + (o1[2] - o0[2]) * t;
          cnt++;
        }
        cellIndex[CI(i, j, kk)] = positions.length / 3;
        positions.push(
          minX + (i + px / cnt) * cellSize,
          minY + (j + py / cnt) * cellSize,
          minZ + (kk + pz / cnt) * cellSize
        );
      }
    }
  }

  // 面：三个方向的棱
  const indices = [];
  const quad = (c0, c1, c2, c3, flip) => {
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) return;
    if (flip) indices.push(c0, c1, c2, c0, c2, c3);
    else indices.push(c0, c2, c1, c0, c3, c2);
  };
  for (let kk = 1; kk < nz; kk++) {
    for (let j = 1; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const v = field[FI(i, j, kk)];
        const inside = v < 0;
        // x 方向棱 (i..i+1, j, kk)
        if (i < nx && ((field[FI(i + 1, j, kk)] < 0) !== inside)) {
          quad(
            cellIndex[CI(i, j - 1, kk - 1)], cellIndex[CI(i, j, kk - 1)],
            cellIndex[CI(i, j, kk)], cellIndex[CI(i, j - 1, kk)],
            inside
          );
        }
        // y 方向棱
        if (j < ny && ((field[FI(i, j + 1, kk)] < 0) !== inside)) {
          quad(
            cellIndex[CI(i - 1, j, kk - 1)], cellIndex[CI(i - 1, j, kk)],
            cellIndex[CI(i, j, kk)], cellIndex[CI(i, j, kk - 1)],
            inside
          );
        }
        // z 方向棱
        if (kk < nz && ((field[FI(i, j, kk + 1)] < 0) !== inside)) {
          quad(
            cellIndex[CI(i - 1, j - 1, kk)], cellIndex[CI(i, j - 1, kk)],
            cellIndex[CI(i, j, kk)], cellIndex[CI(i - 1, j, kk)],
            inside
          );
        }
      }
    }
  }

  // 法线 = 已采样 SDF 网格的中央差分
  const normals = new Float32Array(positions.length);
  for (let vi = 0; vi < positions.length; vi += 3) {
    const x = positions[vi], y = positions[vi + 1], z = positions[vi + 2];
    const i = clampIndex(Math.round((x - minX) / cellSize), sx - 1);
    const j = clampIndex(Math.round((y - minY) / cellSize), sy - 1);
    const kk = clampIndex(Math.round((z - minZ) / cellSize), sz - 1);
    const im = Math.max(0, i - 1), ip = Math.min(sx - 1, i + 1);
    const jm = Math.max(0, j - 1), jp = Math.min(sy - 1, j + 1);
    const km = Math.max(0, kk - 1), kp = Math.min(sz - 1, kk + 1);
    let gx = field[FI(ip, j, kk)] - field[FI(im, j, kk)];
    let gy = field[FI(i, jp, kk)] - field[FI(i, jm, kk)];
    let gz = field[FI(i, j, kp)] - field[FI(i, j, km)];
    const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    normals[vi] = gx / len;
    normals[vi + 1] = gy / len;
    normals[vi + 2] = gz / len;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(indices);

  // 绕序一致性检查：与梯度法线不符则翻转
  if (indices.length >= 3) {
    let agree = 0;
    const p = positions;
    for (let t = 0; t < Math.min(30, indices.length / 3); t++) {
      const i0 = indices[t * 3] * 3, i1 = indices[t * 3 + 1] * 3, i2 = indices[t * 3 + 2] * 3;
      const ax = p[i1] - p[i0], ay = p[i1 + 1] - p[i0 + 1], az = p[i1 + 2] - p[i0 + 2];
      const bx = p[i2] - p[i0], by = p[i2 + 1] - p[i0 + 1], bz = p[i2 + 2] - p[i0 + 2];
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      agree += cx * normals[i0] + cy * normals[i0 + 1] + cz * normals[i0 + 2] > 0 ? 1 : -1;
    }
    if (agree < 0) {
      for (let t = 0; t < indices.length; t += 3) {
        const tmp = indices[t + 1];
        indices[t + 1] = indices[t + 2];
        indices[t + 2] = tmp;
      }
      geo.setIndex(indices);
    }
  }
  return geo;
}
