'use strict';
// Blockout: roof + columns + tree on a simple house body.
// Flat-color software render (geometry/scale/pivot check); textures are not shown.
// Roof defaults to the 50k high-poly; pass GBE_ROOF=...lod/yingshan-single-a-lod0-29k-attr.glb
// and GBE_COLUMN=...lod/yanzhu-round-a-lod0-0.4k.glb to gate the LOD 0 pair.
// 20k roof LODs failed this blockout (collapsed eaves/ridge) and are archived.
const fs = require('fs');
const path = require('path');
const { renderPreview } = require('../../build/procedural/render.js');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'pipeline/out/pilot-2026-10-22/preview');
const TAG = process.env.GBE_TAG || 'full';
const ROOF = process.env.GBE_ROOF ? path.resolve(process.env.GBE_ROOF) : path.join(ROOT, 'pipeline/out/pilot-2026-10-22/normalized/yingshan-single-a-normalized.glb');
const COLUMN = process.env.GBE_COLUMN ? path.resolve(process.env.GBE_COLUMN) : path.join(ROOT, 'pipeline/out/pilot-2026-10-22/normalized/yanzhu-round-a-normalized.glb');
const TREE = process.env.GBE_TREE ? path.resolve(process.env.GBE_TREE) : path.join(ROOT, 'pipeline/out/pilot-2026-10-22/normalized/old-locust-a-normalized.glb');

function readGlb(file) {
  const buf = fs.readFileSync(file);
  let p = 12, json = null, bin = null;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32LE(p);
    const type = buf.readUInt32LE(p + 4);
    const body = p + 8;
    if (type === 0x4e4f534a) json = JSON.parse(buf.slice(body, body + len).toString('utf8'));
    if (type === 0x004e4942) bin = buf.subarray(body, body + len);
    p = body + len;
  }
  return { json, bin };
}

function readVec3(json, bin, index) {
  const a = json.accessors[index];
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || 12;
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const o = base + i * stride;
    out.push([bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]);
  }
  return out;
}

function readIndices(json, bin, index) {
  const a = json.accessors[index];
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = [];
  for (let i = 0; i < a.count; i++) {
    out.push(a.componentType === 5125 ? bin.readUInt32LE(base + i * 4) : bin.readUInt16LE(base + i * 2));
  }
  return out;
}

const positions = [];
const normals = [];
const submeshes = [];
const colors = new Map();

function addBox(w, h, d, cx, cy, cz, slot, color) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  const z0 = cz - d / 2, z1 = cz + d / 2;
  const faces = [
    { n: [0, 0, 1], v: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
    { n: [0, 0, -1], v: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]] },
    { n: [1, 0, 0], v: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]] },
    { n: [-1, 0, 0], v: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
    { n: [0, 1, 0], v: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]] },
    { n: [0, -1, 0], v: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
  ];
  const start = positions.length / 3;
  for (const f of faces) {
    for (const tri of [[0, 1, 2], [0, 2, 3]]) {
      for (const i of tri) {
        const p = f.v[i];
        positions.push(p[0], p[1], p[2]);
        normals.push(f.n[0], f.n[1], f.n[2]);
      }
    }
  }
  submeshes.push({ slot, start, count: positions.length / 3 - start });
  colors.set(slot, color);
}

function addGlb(file, tx, ty, tz, slot, color) {
  const { json, bin } = readGlb(file);
  const prim = json.meshes[0].primitives[0];
  const pos = readVec3(json, bin, prim.attributes.POSITION);
  const nrm = readVec3(json, bin, prim.attributes.NORMAL);
  const idx = readIndices(json, bin, prim.indices);
  const start = positions.length / 3;
  for (const i of idx) {
    const p = pos[i], n = nrm[i];
    positions.push(p[0] + tx, p[1] + ty, p[2] + tz);
    normals.push(process.env.GBE_FLAT ? 0 : n[0], process.env.GBE_FLAT ? 1 : n[1], process.env.GBE_FLAT ? 0 : n[2]);
  }
  submeshes.push({ slot, start, count: idx.length });
  colors.set(slot, color);
}

function house(withTree) {
  positions.length = 0;
  normals.length = 0;
  submeshes.length = 0;
  colors.clear();

  // 台基 10.4 x 0.4 x 7.4；墙身 9.6 x 3.0 x 6.4；屋面 10 x 2 x 7 坐在 3.4 m
  addBox(10.4, 0.4, 7.4, 0, 0.2, 0, 'base', [150, 145, 135]);
  addBox(9.6, 3.0, 6.4, 0, 1.9, 0, 'wall', [205, 195, 175]);
  for (const x of [-4.4, -2.2, 0, 2.2, 4.4]) {
    addGlb(COLUMN, x, 0.4, -3.3, 'column', [110, 80, 55]);
  }
  if (!process.env.GBE_NO_ROOF) addGlb(ROOF, 0, 3.4, 0, 'roof', [150, 150, 150]);
  if (withTree) addGlb(TREE, 8.5, 0, 0, 'tree', [95, 110, 75]);
}

function render(name, withTree, yaw, pitch) {
  house(withTree);
  const png = renderPreview({
    width: 960,
    height: 720,
    ss: 1,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    submeshes,
    slotColors: colors,
    yawDeg: yaw,
    pitchDeg: pitch,
    focalMm: 50,
  });
  const out = path.join(OUT, name);
  fs.writeFileSync(out, png);
  console.log(out, `tris=${positions.length / 9}`);
}

render(`building-${TAG}-three-quarter.png`, false, 35, 20);
render(`building-${TAG}-front.png`, false, 0, 8);
render(`building-${TAG}-side.png`, false, 90, 8);
render(`building-${TAG}-with-tree-three-quarter.png`, true, 30, 18);
