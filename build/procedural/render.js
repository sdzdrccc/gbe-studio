'use strict';

/**
 * render.js —— 零依赖软件光栅化预览渲染器
 *
 * 为什么不用 headless 浏览器 / Blender：见 geom.js 头注。预览图是**入库门禁的必需件**
 * （512×512 白底 3/4 视角），如果渲染它需要 Blender，那 18 件"0 成本构件"就又绑上了
 * 一条昂贵依赖。软件光栅化 200 行能解决的事，不该拖一台 DCC 进来。
 *
 * 视角参数来自 `gbe-assets/catalog.config.json` 的 preview 段（yaw 45 / pitch 30 / 50mm 等效），
 * 保证程序化件与将来 AI 生成件、人工精修件的预览**同视角可比**。
 *
 * 渲染管线：世界 → 相机（z-buffer 近裁剪）→ 透视投影 → 三角光栅化 → 2× 超采样降采样 → PNG
 */

const zlib = require('zlib');

// ---------------------------------------------------------------------------
// PNG 编码（truecolor 8bit，无滤波）
// ---------------------------------------------------------------------------

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  CRC_TABLE = t;
  return t;
}

function crc32(buf) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Buffer|Uint8Array} rgb  长度 = w*h*3
 * @returns {Buffer} PNG 字节流
 */
function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    Buffer.from(rgb.buffer || rgb, rgb.byteOffset || 0, rgb.length).copy(
      raw,
      y * (stride + 1) + 1,
      y * stride,
      y * stride + stride
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

function v3sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function v3cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function v3dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function v3norm(a) {
  const l = Math.sqrt(v3dot(a, a)) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function v3scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function v3add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function v3sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * @param {object} o
 * @param {number[]} o.positions
 * @param {number[]} o.normals
 * @param {{slot:string,start:number,count:number}[]} o.submeshes
 * @param {Map<string,[number,number,number]>} o.slotColors  slot -> sRGB 0–255
 * @param {number} [o.width=512]
 * @param {number} [o.height=512]
 * @param {number} [o.yawDeg=45]
 * @param {number} [o.pitchDeg=30]
 * @param {number} [o.focalMm=50]
 * @param {number} [o.ss=2]  超采样倍率
 * @returns {Buffer} PNG
 */
function renderPreview(o) {
  const W = o.width || 512;
  const H = o.height || 512;
  const SS = o.ss || 2;
  const RW = W * SS;
  const RH = H * SS;
  const yaw = ((o.yawDeg === undefined ? 45 : o.yawDeg) * Math.PI) / 180;
  const pitch = ((o.pitchDeg === undefined ? 30 : o.pitchDeg) * Math.PI) / 180;
  const focalMm = o.focalMm || 50;

  const pos = o.positions;
  const nrm = o.normals;
  const submeshes = o.submeshes.filter((s) => s.count > 0).map((s) => {
    const c = (o.slotColors && o.slotColors.get(s.slot)) || [180, 180, 180];
    return { start: s.start, count: s.count, color: c };
  });

  // ── bbox
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = pos[i + a];
      if (v < lo[a]) lo[a] = v;
      if (v > hi[a]) hi[a] = v;
    }
  }
  if (!isFinite(lo[0])) {
    lo = [0, 0, 0];
    hi = [0, 0, 0];
  }
  const center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const diag = Math.sqrt(
    (hi[0] - lo[0]) ** 2 + (hi[1] - lo[1]) ** 2 + (hi[2] - lo[2]) ** 2
  ) || 1;

  // ── 相机基（yaw=0 时位于 -Z 正前方，与模型的 front = -Z 对齐）
  const camDir = [
    Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    -Math.cos(pitch) * Math.cos(yaw),
  ];
  const zAxis = v3norm(camDir);
  let xAxis = v3cross([0, 1, 0], zAxis);
  if (Math.sqrt(v3dot(xAxis, xAxis)) < 1e-6) xAxis = [1, 0, 0];
  xAxis = v3norm(xAxis);
  const yAxis = v3cross(zAxis, xAxis);

  const f = (focalMm / 36) * RW;
  const fit = 0.86 * Math.min(RW, RH) * 0.5;

  // 自适应距离：迭代 4 次让包围盒投影落进画面 86%
  let dist = diag * 1.6;
  for (let iter = 0; iter < 4; iter++) {
    const camPos = v3add(center, v3scale(camDir, dist));
    let maxR = 1e-6;
    for (let i = 0; i < pos.length; i += 3) {
      const rel = v3sub([pos[i], pos[i + 1], pos[i + 2]], camPos);
      const d = -v3dot(rel, zAxis); // 前向深度（正值在相机前方）
      if (d <= 1e-4) continue;
      const sx = f * v3dot(rel, xAxis) / d;
      const sy = f * v3dot(rel, yAxis) / d;
      const r = Math.max(Math.abs(sx), Math.abs(sy));
      if (r > maxR) maxR = r;
    }
    const k = fit / maxR;
    dist = dist / k;
    if (Math.abs(k - 1) < 0.005) break;
  }

  const camPos = v3add(center, v3scale(camDir, dist));
  const near = Math.max(0.01, dist * 0.02);

  // ── 空间：白底
  const color = new Uint8Array(RW * RH * 3).fill(255);
  const zbuf = new Float32Array(RW * RH).fill(Infinity);

  // ── 光照：跟随相机的三点布光
  //    固定世界光会让"被相机看到的面"恰好背光 —— 预览图的可读性比物理正确更重要。
  //    主光取相机方向 + 高位 + 画面偏左；补光取相机方向 + 画面偏右略低；再加 0.30 环境。
  const UP = [0, 1, 0];
  const L1 = v3norm(v3add(v3add(camDir, v3scale(UP, 0.9)), v3scale(xAxis, 0.35)));
  const L2 = v3norm(v3add(v3sub(camDir, v3scale(xAxis, 0.8)), v3scale(UP, 0.1)));

  // ── Pass 0：地面投影（轻阴影，让构件"落在地上"而不是飘着）
  const footW = Math.max(hi[0] - lo[0], 1e-3) * 0.62;
  const footD = Math.max(hi[2] - lo[2], 1e-3) * 0.62;
  const gy = lo[1] - diag * 0.002;
  const SEG = 28;
  const rim = [];
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const wp = [center[0] + Math.cos(a) * footW, gy, center[2] + Math.sin(a) * footD];
    const rel = v3sub(wp, camPos);
    const d = -v3dot(rel, zAxis);
    if (d <= 1e-4) {
      rim.push(null);
      continue;
    }
    rim.push({
      sx: RW / 2 + (f * v3dot(rel, xAxis)) / d,
      sy: RH / 2 - (f * v3dot(rel, yAxis)) / d,
      d,
    });
  }
  const cRel = v3sub([center[0], gy, center[2]], camPos);
  const cD = -v3dot(cRel, zAxis);
  const cS = cD > 1e-4
    ? { sx: RW / 2 + (f * v3dot(cRel, xAxis)) / cD, sy: RH / 2 - (f * v3dot(cRel, yAxis)) / cD, d: cD }
    : null;
  if (cS) {
    for (let i = 0; i < SEG; i++) {
      const a = rim[i];
      const b = rim[(i + 1) % SEG];
      if (!a || !b) continue;
      fillTriangleBlend(color, RW, RH, cS, a, b, 0.10);
    }
  }

  // ── Pass 1：模型（z-buffer）
  const V = (i) => {
    const rel = v3sub([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], camPos);
    return {
      cx: v3dot(rel, xAxis),
      cy: v3dot(rel, yAxis),
      cz: v3dot(rel, zAxis),
      nx: nrm[i * 3],
      ny: nrm[i * 3 + 1],
      nz: nrm[i * 3 + 2],
    };
  };

  for (const sm of submeshes) {
    const [cr, cg, cb] = sm.color;
    for (let t = 0; t < sm.count; t += 3) {
      const i0 = sm.start + t;
      const tri = clipNear([V(i0), V(i0 + 1), V(i0 + 2)], near);
      if (tri.length < 3) continue;
      for (let k = 1; k < tri.length - 1; k++) {
        drawTri(color, zbuf, RW, RH, f, tri[0], tri[k], tri[k + 1], cr, cg, cb, L1, L2);
      }
    }
  }

  // ── 降采样（盒式滤波）
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const p = ((y * SS + dy) * RW + (x * SS + dx)) * 3;
          r += color[p];
          g += color[p + 1];
          b += color[p + 2];
        }
      }
      const n = SS * SS;
      const q = (y * W + x) * 3;
      out[q] = Math.round(r / n);
      out[q + 1] = Math.round(g / n);
      out[q + 2] = Math.round(b / n);
    }
  }
  return encodePng(W, H, out);
}

/** 近平面裁剪（Sutherland–Hodgman，对单三角形） */
function clipNear(tri, near) {
  const inside = (v) => -v.cz >= near;
  if (tri.every(inside)) return tri;
  if (!tri.some(inside)) return [];
  const out = [];
  for (let i = 0; i < tri.length; i++) {
    const a = tri[i];
    const b = tri[(i + 1) % tri.length];
    const ain = inside(a);
    const bin = inside(b);
    if (ain) out.push(a);
    if (ain !== bin) {
      const ta = -a.cz - near;
      const tb = -b.cz - near;
      const s = ta / (ta - tb);
      out.push({
        cx: a.cx + (b.cx - a.cx) * s,
        cy: a.cy + (b.cy - a.cy) * s,
        cz: a.cz + (b.cz - a.cz) * s,
        nx: a.nx + (b.nx - a.nx) * s,
        ny: a.ny + (b.ny - a.ny) * s,
        nz: a.nz + (b.nz - a.nz) * s,
      });
    }
  }
  return out;
}

function screenPt(v, f, RW, RH) {
  const d = -v.cz;
  return { x: RW / 2 + (f * v.cx) / d, y: RH / 2 - (f * v.cy) / d, z: d };
}

function edge(ax, ay, bx, by, px, py) {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

function drawTri(color, zbuf, RW, RH, f, a, b, c, cr, cg, cb, L1, L2) {
  const A = screenPt(a, f, RW, RH);
  const B = screenPt(b, f, RW, RH);
  const C = screenPt(c, f, RW, RH);
  const area = edge(A.x, A.y, B.x, B.y, C.x, C.y);
  if (Math.abs(area) < 1e-9) return;

  // 面法线（跨三角形平均顶点法线）→ 光照
  let nx = (a.nx + b.nx + c.nx) / 3;
  let ny = (a.ny + b.ny + c.ny) / 3;
  let nz = (a.nz + b.nz + c.nz) / 3;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  const d1 = Math.max(0, nx * L1[0] + ny * L1[1] + nz * L1[2]);
  const d2 = Math.max(0, nx * L2[0] + ny * L2[1] + nz * L2[2]);
  let sh = 0.3 + 0.5 * d1 + 0.2 * d2;
  if (sh > 1) sh = 1;
  const rr = Math.round(cr * sh);
  const gg = Math.round(cg * sh);
  const bb = Math.round(cb * sh);

  let minX = Math.floor(Math.min(A.x, B.x, C.x));
  let maxX = Math.ceil(Math.max(A.x, B.x, C.x));
  let minY = Math.floor(Math.min(A.y, B.y, C.y));
  let maxY = Math.ceil(Math.max(A.y, B.y, C.y));
  if (minX < 0) minX = 0;
  if (minY < 0) minY = 0;
  if (maxX > RW - 1) maxX = RW - 1;
  if (maxY > RH - 1) maxY = RH - 1;
  if (minX > maxX || minY > maxY) return;

  const inv = 1 / area;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = edge(B.x, B.y, C.x, C.y, px, py);
      const w1 = edge(C.x, C.y, A.x, A.y, px, py);
      const w2 = edge(A.x, A.y, B.x, B.y, px, py);
      const l0 = w0 * inv;
      const l1 = w1 * inv;
      const l2 = w2 * inv;
      if (l0 < 0 || l1 < 0 || l2 < 0) continue;
      const z = l0 * A.z + l1 * B.z + l2 * C.z;
      const idx = y * RW + x;
      if (z >= zbuf[idx]) continue;
      zbuf[idx] = z;
      const p = idx * 3;
      color[p] = rr;
      color[p + 1] = gg;
      color[p + 2] = bb;
    }
  }
}

/** 不写 z-buffer 的半透明填充（地面投影用） */
function fillTriangleBlend(color, RW, RH, a, b, c, alpha) {
  const area = edge(a.sx, a.sy, b.sx, b.sy, c.sx, c.sy);
  if (Math.abs(area) < 1e-9) return;
  let minX = Math.floor(Math.min(a.sx, b.sx, c.sx));
  let maxX = Math.ceil(Math.max(a.sx, b.sx, c.sx));
  let minY = Math.floor(Math.min(a.sy, b.sy, c.sy));
  let maxY = Math.ceil(Math.max(a.sy, b.sy, c.sy));
  if (minX < 0) minX = 0;
  if (minY < 0) minY = 0;
  if (maxX > RW - 1) maxX = RW - 1;
  if (maxY > RH - 1) maxY = RH - 1;
  const inv = 1 / area;
  const k = 1 - alpha;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const l0 = edge(b.sx, b.sy, c.sx, c.sy, px, py) * inv;
      const l1 = edge(c.sx, c.sy, a.sx, a.sy, px, py) * inv;
      const l2 = edge(a.sx, a.sy, b.sx, b.sy, px, py) * inv;
      if (l0 < 0 || l1 < 0 || l2 < 0) continue;
      const p = (y * RW + x) * 3;
      color[p] = Math.round(color[p] * k + 40 * alpha);
      color[p + 1] = Math.round(color[p + 1] * k + 40 * alpha);
      color[p + 2] = Math.round(color[p + 2] * k + 44 * alpha);
    }
  }
}

module.exports = { renderPreview, encodePng, crc32 };
