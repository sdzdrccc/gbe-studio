#!/usr/bin/env node
'use strict';

/**
 * LOD 门禁（几何层）：对比源 GLB 与 LOD GLB。
 *
 *   node pipeline/tools/lod/validate-lod.js <source.glb> <lod.glb> [--mode simplify|retopo] [--weld 1e-5] [--json out.json]
 *
 *   --mode simplify（默认）：要求边界边保留率 ≥99.9%（保檐口/脊线）。
 *   --mode retopo：要求水密（边界边 = 0），UV 拆点用 --weld 1e-5 焊回位置再数边。
 *
 * 只核第一个 mesh 的第一个 primitive（本批屋面 / 檐柱都是单 primitive）。
 *
 * 判据：
 *   - bbox 一致（1e-4 m）           —— 尺寸 / 轴心没跑
 *   - 边界边保留率 ≥ 99.9%          —— 没削掉檐口/脊线（`--mode retopo` 改为要求水密边界 0）
 *   - 反向面积 ≤ max(0.2%, 源×2)    —— 绕序没被减面翻掉（单三角三顶点法线全反向才算）
 *   - 退化三角形 < 0.5%             —— 没压成零面积
 *   - 无 NaN / 无越界索引 / UV 存在
 *
 * 退出码：0 通过，1 不通过，2 用法错误。
 */

const path = require('path');
const fs = require('fs');
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

function readIndices(prim, vertexCount) {
  const attr = prim.getIndices();
  if (!attr) {
    const out = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) out[i] = i;
    return out;
  }
  return new Uint32Array(attr.getArray());
}

function buildWeldRemap(pos, vertexCount, tol) {
  if (!tol) return { remap: null, count: vertexCount };
  const inv = 1 / tol;
  const map = new Map();
  const remap = new Uint32Array(vertexCount);
  let next = 0;
  for (let v = 0; v < vertexCount; v++) {
    const key = `${Math.round(pos[v * 3] * inv)},${Math.round(pos[v * 3 + 1] * inv)},${Math.round(pos[v * 3 + 2] * inv)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = next++;
      map.set(key, id);
    }
    remap[v] = id;
  }
  return { remap, count: next };
}

function stats(prim, weldTol = 0) {
  const pos = readFloat(prim, 'POSITION', 3);
  const nrm = readFloat(prim, 'NORMAL', 3);
  const uv = readFloat(prim, 'TEXCOORD_0', 2);
  const idx = readIndices(prim, pos.length / 3);
  const vertexCount = pos.length / 3;
  const weld = buildWeldRemap(pos, vertexCount, weldTol);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let nan = 0;
  for (let v = 0; v < vertexCount; v++) {
    for (let k = 0; k < 3; k++) {
      const x = pos[v * 3 + k];
      if (!Number.isFinite(x)) nan++;
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
    }
  }

  const edges = new Map();
  let inverted = 0;
  let degenerate = 0;
  let badIndex = 0;
  let totalArea2 = 0;
  let invertedArea2 = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t], ib = idx[t + 1], ic = idx[t + 2];
    if (ia >= vertexCount || ib >= vertexCount || ic >= vertexCount) {
      badIndex++;
      continue;
    }
    const ax = pos[ia * 3], ay = pos[ia * 3 + 1], az = pos[ia * 3 + 2];
    const bx = pos[ib * 3], by = pos[ib * 3 + 1], bz = pos[ib * 3 + 2];
    const cx = pos[ic * 3], cy = pos[ic * 3 + 1], cz = pos[ic * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const area2 = Math.hypot(nx, ny, nz);
    totalArea2 += area2;
    if (area2 < 1e-10) {
      degenerate++;
    } else if (nrm) {
      const d0 = nx * nrm[ia * 3] + ny * nrm[ia * 3 + 1] + nz * nrm[ia * 3 + 2];
      const d1 = nx * nrm[ib * 3] + ny * nrm[ib * 3 + 1] + nz * nrm[ib * 3 + 2];
      const d2 = nx * nrm[ic * 3] + ny * nrm[ic * 3 + 1] + nz * nrm[ic * 3 + 2];
      // 只有三个顶点法线都反向，才算绕序翻掉；混合符号常见于硬边/薄壳，不算
      if (d0 < 0 && d1 < 0 && d2 < 0) {
        inverted++;
        invertedArea2 += area2;
      }
    }
    for (const [a, b] of [[ia, ib], [ib, ic], [ic, ia]]) {
      const ea = weld.remap ? weld.remap[a] : a;
      const eb = weld.remap ? weld.remap[b] : b;
      const lo = Math.min(ea, eb), hi = Math.max(ea, eb);
      if (lo === hi) continue;
      const key = lo * weld.count + hi;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }

  let boundaryEdges = 0;
  let nonManifold = 0;
  for (const count of edges.values()) {
    if (count === 1) boundaryEdges++;
    else if (count > 2) nonManifold++;
  }

  let uvMin = [Infinity, Infinity];
  let uvMax = [-Infinity, -Infinity];
  if (uv) {
    for (let v = 0; v < vertexCount; v++) {
      for (let k = 0; k < 2; k++) {
        const x = uv[v * 2 + k];
        if (x < uvMin[k]) uvMin[k] = x;
        if (x > uvMax[k]) uvMax[k] = x;
      }
    }
  }

  return {
    tris: idx.length / 3,
    verts: vertexCount,
    weldedVerts: weld.count,
    bbox: { min, max },
    boundaryEdges,
    nonManifold,
    inverted,
    invertedAreaRatio: totalArea2 > 0 ? invertedArea2 / totalArea2 : 0,
    degenerate,
    badIndex,
    nan,
    uv: uv ? { min: uvMin, max: uvMax, present: true } : { present: false },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const files = [];
  let jsonOut = null;
  let mode = 'simplify';
  let weldTol = 0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') jsonOut = args[++i];
    else if (a === '--mode') mode = args[++i];
    else if (a === '--weld') weldTol = Number(args[++i]);
    else if (a.startsWith('--')) {
      console.error(`unknown option: ${a}`);
      process.exit(2);
    } else files.push(a);
  }
  if (files.length < 2 || !['simplify', 'retopo'].includes(mode)) {
    console.error('usage: node validate-lod.js <source.glb> <lod.glb> [--mode simplify|retopo] [--weld 1e-5] [--json out.json]');
    process.exit(2);
  }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const srcDoc = await io.read(path.resolve(files[0]));
  const lodDoc = await io.read(path.resolve(files[1]));
  const srcPrim = srcDoc.getRoot().listMeshes()[0].listPrimitives()[0];
  const lodPrim = lodDoc.getRoot().listMeshes()[0].listPrimitives()[0];

  const src = stats(srcPrim, weldTol);
  const lod = stats(lodPrim, weldTol);
  const checks = [];
  const bboxMaxDiff = Math.max(
    ...src.bbox.min.map((v, k) => Math.abs(v - lod.bbox.min[k])),
    ...src.bbox.max.map((v, k) => Math.abs(v - lod.bbox.max[k]))
  );
  checks.push({ name: 'bbox', pass: bboxMaxDiff <= 1e-4, detail: `maxDiff=${bboxMaxDiff.toExponential(2)}` });
  if (mode === 'retopo') {
    checks.push({
      name: 'watertight',
      pass: lod.boundaryEdges === 0,
      detail: `boundaryEdges=${lod.boundaryEdges} (source ${src.boundaryEdges}; weld=${weldTol})`,
    });
  } else {
    checks.push({
      name: 'boundary-retention',
      pass: lod.boundaryEdges >= src.boundaryEdges * 0.999,
      detail: `${src.boundaryEdges} -> ${lod.boundaryEdges} (${((lod.boundaryEdges / src.boundaryEdges) * 100).toFixed(2)}%)`,
    });
  }
  checks.push({
    name: 'winding',
    pass: lod.invertedAreaRatio <= Math.max(0.002, src.invertedAreaRatio * 2),
    detail: `inverted=${lod.inverted} area=${(lod.invertedAreaRatio * 100).toFixed(3)}% (source ${(src.invertedAreaRatio * 100).toFixed(3)}%)`,
  });
  checks.push({
    name: 'degenerate',
    pass: lod.degenerate / Math.max(1, lod.tris) < 0.005,
    detail: `${lod.degenerate} (${((lod.degenerate / Math.max(1, lod.tris)) * 100).toFixed(3)}%)`,
  });
  checks.push({ name: 'indices', pass: lod.badIndex === 0, detail: `bad=${lod.badIndex}` });
  checks.push({ name: 'nan', pass: lod.nan === 0, detail: `nan=${lod.nan}` });
  checks.push({ name: 'uv', pass: lod.uv.present && Number.isFinite(lod.uv.min[0]), detail: JSON.stringify(lod.uv) });

  const pass = checks.every((c) => c.pass);
  const report = { source: files[0], lod: files[1], mode, weld: weldTol, pass, checks, sourceStats: src, lodStats: lod };
  console.log(JSON.stringify(report, null, 2));
  if (jsonOut) fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(report, null, 2) + '\n');
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
