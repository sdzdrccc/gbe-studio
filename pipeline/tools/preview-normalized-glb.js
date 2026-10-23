'use strict';
const fs = require('fs');
const path = require('path');
const { renderPreview } = require('../../build/procedural/render.js');

const glbPath = process.argv[2];
const outDir = process.argv[3] || path.dirname(glbPath);
const base = path.basename(glbPath, '.glb');
const buf = fs.readFileSync(glbPath);
let p = 12, json = null, bin = null;
while (p < buf.length) {
  const cl = buf.readUInt32LE(p);
  const ct = buf.readUInt32LE(p + 4);
  const body = buf.subarray(p + 8, p + 8 + cl);
  if (ct === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
  else if (ct === 0x004e4942) bin = body;
  p += 8 + cl;
}
const prim = json.meshes[0].primitives[0];
function readAcc(i) {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const stride = bv.byteStride || comps * 4;
  const out = [];
  for (let k = 0; k < a.count; k++) {
    const v = [];
    for (let c = 0; c < comps; c++) v.push(bin.readFloatLE(base + k * stride + c * 4));
    out.push(v);
  }
  return out;
}
const pos = readAcc(prim.attributes.POSITION);
const nrm = readAcc(prim.attributes.NORMAL);
const idxAcc = json.accessors[prim.indices];
const bv = json.bufferViews[idxAcc.bufferView];
const ibase = (bv.byteOffset || 0) + (idxAcc.byteOffset || 0);
const idx = [];
for (let k = 0; k < idxAcc.count; k++) {
  idx.push(idxAcc.componentType === 5125 ? bin.readUInt32LE(ibase + k * 4) : bin.readUInt16LE(ibase + k * 2));
}
const positions = new Float32Array(idx.length * 3);
const normals = new Float32Array(idx.length * 3);
for (let k = 0; k < idx.length; k++) {
  const v = idx[k];
  positions[k * 3] = pos[v][0]; positions[k * 3 + 1] = pos[v][1]; positions[k * 3 + 2] = pos[v][2];
  normals[k * 3] = nrm[v][0]; normals[k * 3 + 1] = nrm[v][1]; normals[k * 3 + 2] = nrm[v][2];
}
const views = [
  ['three-quarter', 45, 30],
  ['front', 0, 0],
  ['top', 0, 89],
];
for (const [name, yaw, pitch] of views) {
  const png = renderPreview({
    width: 768, height: 768, ss: 2,
    positions, normals,
    submeshes: [{ slot: 'roof', start: 0, count: idx.length }],
    slotColors: new Map([['roof', [150, 150, 150]]]),
    yawDeg: yaw, pitchDeg: pitch, focalMm: 50,
  });
  const out = path.join(outDir, `${base}-${name}.png`);
  fs.writeFileSync(out, png);
  console.log(out);
}
