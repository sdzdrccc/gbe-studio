'use strict';

/**
 * geom.js —— 参数化几何内核（零依赖）
 *
 * 为什么自己写：程序化构件是「0 成本」的那 18 件，必须能在**没有 Blender、没有网络**的环境里
 * 确定性地重建。引入 three.js / gltf-pipeline 就等于给这条最省的路径加上外部依赖，
 * 与 CONVENTIONS「语法单源、零依赖」的取向不符。
 *
 * 全局约定（与 CONVENTIONS §1 一致，此处不重新定义、只遵从）：
 *   · 单位 m，1u = 1m
 *   · +Y up，-Z forward
 *   · 轴心由生成器统一归位为 bottom-center（本内核只管局部几何，不掺和轴心）
 *   · 尺寸轴序 [x 宽, y 高, z 深]
 *
 * 局部坐标约定（**每个原语都从自己的局部原点长出来，再靠 at/rot 摆到位**）：
 *   · box      —— at = 盒**中心**
 *   · cylinder —— at = **底面中心**，沿局部 +Y 生长
 *   · dome     —— at = **底面中心**，沿局部 +Y 起拱
 *   · extrude  —— at = **剖面原点**，沿局部 +Z 挤出（剖面画在 XY 平面）
 *   这样规定是为了让调用方一眼看出「从哪儿长、朝哪儿长」，不用去猜。
 *
 * 旋转：euler [rx, ry, rz]（弧度），顺序 = **先绕 X、再绕 Y、最后绕 Z**（v' = Rz·Ry·Rx·v）。
 *
 * 法线策略：box / extrude 用**面法线**（硬边，建筑构件该有棱有角）；
 *          cylinder / dome 用**径向法线**（平滑，圆柱面不该有假棱）。
 *
 * 输出：**非索引三角形汤**（每个三角自带 3 个顶点）。顶点不跨图元共享 ——
 * 换来的是完全不用处理「共享顶点法线怎么平均」这个坑，而 primitive 档的构件量级
 * （几十~几百面）根本不在乎那点顶点冗余。
 */

const PI = Math.PI;
const TAU = PI * 2;
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// 向量 / 旋转
// ---------------------------------------------------------------------------

function rotXYZ(v, rot) {
  let x = v[0];
  let y = v[1];
  let z = v[2];
  if (!rot) return [x, y, z];
  const rx = rot[0] || 0;
  const ry = rot[1] || 0;
  const rz = rot[2] || 0;
  if (rx) {
    const c = Math.cos(rx);
    const s = Math.sin(rx);
    const ny = y * c - z * s;
    const nz = y * s + z * c;
    y = ny;
    z = nz;
  }
  if (ry) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const nx = x * c + z * s;
    const nz = -x * s + z * c;
    x = nx;
    z = nz;
  }
  if (rz) {
    const c = Math.cos(rz);
    const s = Math.sin(rz);
    const nx = x * c - y * s;
    const ny = x * s + y * c;
    x = nx;
    y = ny;
  }
  return [x, y, z];
}

/** 先按 rot 旋转，再平移 at */
function place(p, at, rot) {
  const r = rotXYZ(p, rot);
  return [r[0] + (at ? at[0] : 0), r[1] + (at ? at[1] : 0), r[2] + (at ? at[2] : 0)];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function len3(a) {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

function norm3(a) {
  const l = len3(a);
  if (l < EPS) return [0, 1, 0];
  return [a[0] / l, a[1] / l, a[2] / l];
}

function faceNormal(p0, p1, p2) {
  return norm3(cross(sub(p1, p0), sub(p2, p0)));
}

// ---------------------------------------------------------------------------
// 网格容器
// ---------------------------------------------------------------------------

class Mesh {
  constructor() {
    /** @type {Map<string, {pos:number[], nrm:number[]}>} slot -> 顶点流 */
    this.subs = new Map();
  }

  _sub(slot) {
    let s = this.subs.get(slot);
    if (!s) {
      s = { pos: [], nrm: [] };
      this.subs.set(slot, s);
    }
    return s;
  }

  /** 逐顶点法线的三角（曲面平滑用） */
  triN(slot, p0, n0, p1, n1, p2, n2) {
    const s = this._sub(slot);
    s.pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
    s.nrm.push(n0[0], n0[1], n0[2], n1[0], n1[1], n1[2], n2[0], n2[1], n2[2]);
  }

  /** 统一法线的三角（硬边） */
  tri(slot, p0, p1, p2, n) {
    const nn = n || faceNormal(p0, p1, p2);
    this.triN(slot, p0, nn, p1, nn, p2, nn);
  }

  /** 四边形 = 两个三角（顶点按 CCW 给出） */
  quad(slot, p0, p1, p2, p3, n) {
    this.tri(slot, p0, p1, p2, n);
    this.tri(slot, p0, p2, p3, n);
  }

  quadN(slot, p0, n0, p1, n1, p2, n2, p3, n3) {
    this.triN(slot, p0, n0, p1, n1, p2, n2);
    this.triN(slot, p0, n0, p2, n2, p3, n3);
  }

  /** 轴对齐包围盒（局部姿态） */
  bounds() {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const s of this.subs.values()) {
      for (let i = 0; i < s.pos.length; i += 3) {
        for (let a = 0; a < 3; a++) {
          const v = s.pos[i + a];
          if (v < lo[a]) lo[a] = v;
          if (v > hi[a]) hi[a] = v;
        }
      }
    }
    if (!isFinite(lo[0])) return { lo: [0, 0, 0], hi: [0, 0, 0], size: [0, 0, 0] };
    return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
  }

  /** 三角面数 */
  polycount() {
    let n = 0;
    for (const s of this.subs.values()) n += s.pos.length / 9;
    return n;
  }

  /**
   * 合并成「数组 + 子网格区间」形态，供 glTF 直接消费。
   * @returns {{positions:number[], normals:number[], submeshes:{slot:string,start:number,count:number}[]}}
   *   start / count 以**顶点**为单位（非索引模式）。
   */
  toArrays() {
    const positions = [];
    const normals = [];
    const submeshes = [];
    for (const [slot, s] of this.subs.entries()) {
      const start = positions.length / 3;
      for (let i = 0; i < s.pos.length; i++) positions.push(s.pos[i]);
      for (let i = 0; i < s.nrm.length; i++) normals.push(s.nrm[i]);
      submeshes.push({ slot, start, count: positions.length / 3 - start });
    }
    return { positions, normals, submeshes };
  }

  /**
   * 归位到 bottom-center 轴心：几何底面贴合 y=0，水平方向按 bbox 中心居中。
   * 生成器统一调它，构件定义里只需按「底面在 0」直觉摆件。
   * @returns {{offset:[number,number,number], before:object, after:object}}
   */
  recenterBottom() {
    const b = this.bounds();
    const off = [-(b.lo[0] + b.hi[0]) / 2, -b.lo[1], -(b.lo[2] + b.hi[2]) / 2];
    if (Math.abs(off[0]) < EPS && Math.abs(off[1]) < EPS && Math.abs(off[2]) < EPS) {
      return { offset: off, before: b, after: b };
    }
    for (const s of this.subs.values()) {
      for (let i = 0; i < s.pos.length; i += 3) {
        s.pos[i] += off[0];
        s.pos[i + 1] += off[1];
        s.pos[i + 2] += off[2];
      }
    }
    return { offset: off, before: b, after: this.bounds() };
  }
}

// ---------------------------------------------------------------------------
// 原语 1：长方体（at = 中心）
// ---------------------------------------------------------------------------

function addBox(M, spec) {
  const [w, h, d] = spec.size;
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  const at = spec.at || [0, 0, 0];
  const rot = spec.rot || null;
  const slot = spec.slot;
  const P = (x, y, z) => place([x, y, z], at, rot);
  const N = (n) => (rot ? norm3(rotXYZ(n, rot)) : n);

  // 六个面，全部按「从外面看 CCW」给顶点
  M.quad(slot, P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), N([0, 0, 1]));
  M.quad(slot, P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), N([0, 0, -1]));
  M.quad(slot, P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), N([1, 0, 0]));
  M.quad(slot, P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), N([-1, 0, 0]));
  M.quad(slot, P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), N([0, 1, 0]));
  M.quad(slot, P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), N([0, -1, 0]));
}

// ---------------------------------------------------------------------------
// 原语 2：圆柱 / 圆台 / 圆锥（at = 底面中心，沿局部 +Y 生长）
// ---------------------------------------------------------------------------

function addCylinder(M, spec) {
  const r1 = spec.r1;
  const r2 = spec.r2 === undefined ? spec.r1 : spec.r2;
  const h = spec.h;
  const seg = Math.max(3, spec.seg || 16);
  const at = spec.at || [0, 0, 0];
  const rot = spec.rot || null;
  const slot = spec.slot;
  const capBottom = spec.capBottom !== false;
  const capTop = spec.capTop !== false;

  const P = (x, y, z) => place([x, y, z], at, rot);
  const N = (n) => norm3(rotXYZ(n, rot));
  const slope = h > EPS ? (r1 - r2) / h : 0;

  const ang = (i) => (i % seg) * (TAU / seg);
  const bottom = (i) => P(Math.cos(ang(i)) * r1, 0, Math.sin(ang(i)) * r1);
  const top = (i) => P(Math.cos(ang(i)) * r2, h, Math.sin(ang(i)) * r2);
  const nBottom = (i) => N([Math.cos(ang(i)), slope, Math.sin(ang(i))]);
  const nTop = (i) => N([Math.cos(ang(i)), slope, Math.sin(ang(i))]);

  const apex = r2 < EPS;
  for (let i = 0; i < seg; i++) {
    const b0 = bottom(i);
    const b1 = bottom(i + 1);
    if (apex) {
      const a = P(0, h, 0);
      M.tri(slot, b0, a, b1); // 面法线自动算（锥顶法线无定义，硬边才对）
    } else {
      const t0 = top(i);
      const t1 = top(i + 1);
      M.quadN(slot, b0, nBottom(i), t0, nTop(i), t1, nTop(i + 1), b1, nBottom(i + 1));
    }
  }

  if (capBottom && r1 > EPS) {
    const c = P(0, 0, 0);
    const n = N([0, -1, 0]);
    for (let i = 0; i < seg; i++) M.tri(slot, c, bottom(i), bottom(i + 1), n);
  }
  if (capTop && r2 > EPS) {
    const c = P(0, h, 0);
    const n = N([0, 1, 0]);
    for (let i = 0; i < seg; i++) M.tri(slot, c, top(i + 1), top(i), n);
  }
}

// ---------------------------------------------------------------------------
// 原语 3：穹顶（at = 底面中心；底面半径 r，起拱高度 h）
// ---------------------------------------------------------------------------

function addDome(M, spec) {
  const r = spec.r;
  const h = spec.h;
  const seg = Math.max(3, spec.seg || 16);
  const rings = Math.max(1, spec.rings || 4);
  const at = spec.at || [0, 0, 0];
  const rot = spec.rot || null;
  const slot = spec.slot;

  const P = (x, y, z) => place([x, y, z], at, rot);
  const N = (n) => norm3(rotXYZ(n, rot));

  // theta: 0 = 底圈（半径 r，y=0），pi/2 = 顶（半径 0，y=h）
  const rad = (j) => Math.cos((j / rings) * (PI / 2)) * r;
  const yy = (j) => Math.sin((j / rings) * (PI / 2)) * h;
  const ang = (i) => (i % seg) * (TAU / seg);
  const pt = (i, j) => P(Math.cos(ang(i)) * rad(j), yy(j), Math.sin(ang(i)) * rad(j));
  const nrm = (i, j) => {
    const th = (j / rings) * (PI / 2);
    return N([Math.cos(ang(i)) * Math.cos(th) / r, Math.sin(th) / h, Math.sin(ang(i)) * Math.cos(th) / r]);
  };

  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      if (j === rings - 1) {
        // 顶部收成三角
        const a = pt(0, j + 1);
        M.tri(slot, pt(i, j), pt(i + 1, j), a);
      } else {
        M.quadN(
          slot,
          pt(i, j), nrm(i, j),
          pt(i + 1, j), nrm(i + 1, j),
          pt(i + 1, j + 1), nrm(i + 1, j + 1),
          pt(i, j + 1), nrm(i, j + 1)
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 原语 4：剖面挤出（at = 剖面原点，沿局部 +Z 挤出 length）
// ---------------------------------------------------------------------------

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function ensureCCW(poly) {
  return signedArea(poly) < 0 ? poly.slice().reverse() : poly;
}

function pointInTri(p, a, b, c) {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  const neg = (d1 < -EPS) || (d2 < -EPS) || (d3 < -EPS);
  const pos = (d1 > EPS) || (d2 > EPS) || (d3 > EPS);
  return !(neg && pos);
}

/** 耳切三角化（简单多边形，输入需 CCW）。失败则降级为扇形。 */
function earClip(poly) {
  const n = poly.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const out = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n + 64) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = poly[i0];
      const b = poly[i1];
      const c = poly[i2];
      const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cr <= EPS) continue; // 凹点或退化
      let ok = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTri(poly[j], a, b, c)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      out.push([i0, i1, i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  else if (out.length === 0) for (let i = 1; i < n - 1; i++) out.push([0, i, i + 1]);
  return out;
}

function addExtrude(M, spec) {
  const poly = ensureCCW(spec.profile);
  const L = spec.length;
  const at = spec.at || [0, 0, 0];
  const rot = spec.rot || null;
  const slot = spec.slot;
  const capStart = spec.capStart !== false;
  const capEnd = spec.capEnd !== false;
  const P = (u, v, z) => place([u, v, z], at, rot);
  const N = (n) => norm3(rotXYZ(n, rot));

  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const d = [q[0] - p[0], q[1] - p[1]];
    // CCW 多边形：边 (dx,dy) 的外法线 = (dy,-dx)
    const nrm = N([d[1], -d[0], 0]);
    M.quad(slot, P(p[0], p[1], 0), P(q[0], q[1], 0), P(q[0], q[1], L), P(p[0], p[1], L), nrm);
  }

  const tris = earClip(poly);
  const nz = N([0, 0, 1]);
  const nzNeg = N([0, 0, -1]);
  for (const [i, j, k] of tris) {
    if (capEnd) {
      M.tri(slot, P(poly[i][0], poly[i][1], L), P(poly[j][0], poly[j][1], L), P(poly[k][0], poly[k][1], L), nz);
    }
    if (capStart) {
      M.tri(slot, P(poly[k][0], poly[k][1], 0), P(poly[j][0], poly[j][1], 0), P(poly[i][0], poly[i][1], 0), nzNeg);
    }
  }
}

// ---------------------------------------------------------------------------
// 原语 5：带起拱的梁（at = 梁底面的端部基准；沿局部 +Z 生长，两端落 0、中间起拱）
// ---------------------------------------------------------------------------

/**
 * 中式梁（梁栿）都有「起拱」——两端落在柱头，中间微微上凸。
 * 用一串绕 X 微转的短盒逼近，8 段肉眼已看不出折线。
 * 关键：**两端底面 y = 0**（落在柱头上），中间底面沿 camber·sin(πt) 抬升。
 *
 * ⚠️ 这里有个不显眼的坑：段间留 2% 重叠是为了消裂缝，但**倾斜后的短盒在 Z 上的
 * 半跨度会大于弦长的一半**（多出 (h/2)·sinθ）。若照搬"中心对弦中点"，首尾段就会探出
 * ±L/2 之外 —— 梁长从 8.0 变成 8.03，尺寸不再落模数网格。
 * 所以首段与末段改成"**外沿贴弦端点**"定位，而非"中心对弦中点"。
 *
 * 刻意不接受 rot：局部倾角与整体旋转要复合，是四元数级的活；程序化件的梁都沿世界 Z
 * 生长，用不上 —— 与其留个会撒谎的参数，不如不给。
 */
function addSweptBeam(M, spec) {
  const w = spec.w;
  const h = spec.h;
  const L = spec.len;
  const seg = Math.max(2, spec.seg || 8);
  const camber = spec.camber || 0;
  const at = spec.at || [0, 0, 0];
  const slot = spec.slot;

  const chord = L / seg;
  const boxLen = chord * 1.02;
  const yAt = (t) => camber * Math.sin(PI * t);

  for (let j = 0; j < seg; j++) {
    const t0 = j / seg;
    const t1 = (j + 1) / seg;
    const za = -L / 2 + t0 * L;
    const zb = -L / 2 + t1 * L;
    const y0 = yAt(t0);
    const y1 = yAt(t1);
    const th = Math.atan2(y1 - y0, zb - za);
    const halfZ = (boxLen / 2) * Math.cos(th) + (h / 2) * Math.abs(Math.sin(th));
    const halfY = (h / 2) * Math.cos(th) + (boxLen / 2) * Math.abs(Math.sin(th));

    let cz;
    if (j === 0) cz = za + halfZ;
    else if (j === seg - 1) cz = zb - halfZ;
    else cz = (za + zb) / 2;

    // 底面贴合起拱曲线（取该段较低的一端），梁两端底面因此精确落在 y = 0
    const yb = Math.min(y0, y1);
    addBox(M, {
      size: [w, h, boxLen],
      at: [at[0], at[1] + yb + halfY, at[2] + cz],
      rot: [-th, 0, 0],
      slot,
    });
  }
}

// ---------------------------------------------------------------------------
// 便捷：滑槽 / 曲线剖面生成器
// ---------------------------------------------------------------------------

/** 生成一段「凹槽瓦」剖面（板瓦）：中间低、两沿高，带厚度 */
function troughProfile(width, rise, thickness, samples) {
  const n = Math.max(2, samples || 5);
  const outer = [];
  const inner = [];
  for (let i = 0; i < n; i++) {
    const u = -width / 2 + (width * i) / (n - 1);
    const t = (2 * u) / width;
    const v = rise * t * t; // 最低 0（瓦心）、两沿 rise（瓦沿翘起）
    outer.push([u, v + thickness]);
    inner.push([u, v]);
  }
  return ensureCCW(outer.concat(inner.slice().reverse()));
}

module.exports = {
  PI,
  TAU,
  EPS,
  rotXYZ,
  place,
  sub,
  cross,
  len3,
  norm3,
  faceNormal,
  Mesh,
  addBox,
  addCylinder,
  addDome,
  addExtrude,
  addSweptBeam,
  earClip,
  ensureCCW,
  signedArea,
  pointInTri,
  troughProfile,
};
