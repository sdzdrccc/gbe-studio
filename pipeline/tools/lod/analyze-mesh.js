#!/usr/bin/env node
'use strict';

/**
 * 网格拓扑体检：连通分量、边界、开/闭、高度分布。
 * 用于判断 LOD 能不能锁边界（三角形汤不能）。
 *
 *   node pipeline/tools/lod/analyze-mesh.js <file.glb>
 */

const path = require('path');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');

function readFloat(prim, semantic, size) {
  const attr = prim.getAttribute(semantic);
  if (!attr) return null;
  const n = attr.getCount();
  const out = new Float32Array(n * size);
  const tmp = [];
  for (let i = 0; i < n; i++) {
    attr.getElement(i, tmp);
    for (let k = 0; k < size; k++) out[i * size + k] = tmp[k];
  }
  return out;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node analyze-mesh.js <file.glb>');
    process.exit(2);
  }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path.resolve(file));
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos = readFloat(prim, 'POSITION', 3);
  const idxAttr = prim.getIndices();
  const idx = idxAttr ? new Uint32Array(idxAttr.getArray()) : new Uint32Array(pos.length / 3);
  const n = pos.length / 3;

  // union-find
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let t = 0; t < idx.length; t += 3) {
    union(idx[t], idx[t + 1]);
    union(idx[t + 1], idx[t + 2]);
    union(idx[t + 2], idx[t]);
  }
  const compVerts = new Map();
  const compTris = new Map();
  for (let v = 0; v < n; v++) {
    const r = find(v);
    compVerts.set(r, (compVerts.get(r) || 0) + 1);
  }
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(idx[t]);
    compTris.set(r, (compTris.get(r) || 0) + 1);
  }
  const comps = [...compVerts.entries()]
    .map(([root, verts]) => ({ verts, tris: compTris.get(root) || 0 }))
    .sort((a, b) => b.tris - a.tris);

  const buckets = [
    [1, 3], [4, 7], [8, 15], [16, 31], [32, 63], [64, 127], [128, 255], [256, 511], [512, Infinity],
  ].map(([lo, hi]) => {
    const sel = comps.filter((c) => c.tris >= lo && c.tris <= hi);
    return {
      range: `${lo}-${hi === Infinity ? 'inf' : hi}`,
      components: sel.length,
      tris: sel.reduce((s, c) => s + c.tris, 0),
      verts: sel.reduce((s, c) => s + c.verts, 0),
    };
  });
  const cumulative = [0, 3, 7, 15, 31, 63, 127, 255, 511].map((minTris) => {
    const sel = comps.filter((c) => c.tris >= minTris);
    return {
      minTris,
      components: sel.length,
      tris: sel.reduce((s, c) => s + c.tris, 0),
    };
  });

  const edge = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      if (lo === hi) continue;
      const key = lo * n + hi;
      edge.set(key, (edge.get(key) || 0) + 1);
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0;
  const boundaryVerts = new Set();
  for (const [key, count] of edge) {
    if (count === 1) {
      boundaryEdges++;
      const lo = Math.floor(key / n);
      const hi = key - lo * n;
      boundaryVerts.add(lo);
      boundaryVerts.add(hi);
    } else if (count > 2) nonManifoldEdges++;
  }

  const yHist = new Map();
  const zHist = new Map();
  for (let v = 0; v < n; v++) {
    const y = pos[v * 3 + 1];
    const z = pos[v * 3 + 2];
    const yk = (Math.floor(y * 10) / 10).toFixed(1);
    const zk = (Math.floor(z * 4) / 4).toFixed(2);
    yHist.set(yk, (yHist.get(yk) || 0) + 1);
    zHist.set(zk, (zHist.get(zk) || 0) + 1);
  }

  console.log(JSON.stringify({
    file,
    verts: n,
    tris: idx.length / 3,
    edges: edge.size,
    boundaryEdges,
    boundaryVerts: boundaryVerts.size,
    nonManifoldEdges,
    components: comps.length,
    largestComponents: comps.slice(0, 12),
    tinyComponents: comps.filter((c) => c.tris < 10).length,
    componentBuckets: buckets,
    cumulativeComponents: cumulative,
    yHistogram: [...yHist.entries()].sort((a, b) => Number(a[0]) - Number(b[0])),
    zHistogram: [...zHist.entries()].sort((a, b) => Number(a[0]) - Number(b[0])),
  }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
