#!/usr/bin/env node
'use strict';

/**
 * 带锁的属性感知减面（轨 B）。
 *
 * 与 glTF-Transform 自带 simplify 的差别：
 *   1. 属性参与误差评估（UV + 法线），不是纯几何 QEM；
 *   2. 可显式锁边界 / UV 缝 / 大角度折边 / 屋脊与山墙带；
 *   3. 只复用原顶点（纹理、法线、切线原样保留），不重采样、不改 UV；
 *   4. 支持多 primitive，按各自面数比例分配目标。
 *
 * 用法：
 *   node pipeline/tools/lod/simplify-attr.js <in.glb> <out.glb> \
 *     --tris 20000 --error 0.01 --uv-weight 0.25 --normal-weight 1 \
 *     --per-component --min-tris 8 \
 *     --lock-boundary 0 --lock-seam 0 --lock-angle 0 --lock-ridge 0.03 --lock-gable 0.03 \
 *     --flags PreserveFolds,ErrorClamped
 *
 *   --per-component：按连通分量分别减，小件（≤ min-tris）原样保留。
 *     高模屋面是 ~2700 个独立瓦件，全局减会把小瓦件压没；分件减才能保形。
 *   不加 --per-component 则整张网格一起减（适合单一连通体）。
 *
 *   只统计不写文件：--stats-only
 *   写 JSON 报告：--report report.json
 *
 * 依赖：@gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer
 * 安装：在仓库根跑 `npm install`（devDependencies）
 */

const fs = require('fs');
const path = require('path');
const { NodeIO, VertexLayout } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { prune } = require('@gltf-transform/functions');
const { MeshoptSimplifier } = require('meshoptimizer');

function parseArgs(argv) {
  const out = { _: [] };
  const booleanFlags = new Set(['stats-only', 'per-component', 'help']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    if (booleanFlags.has(key)) {
      out[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function num(v, d) {
  if (v === undefined) return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`);
  return n;
}

function attrToFloat(prim, semantic, size) {
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
  const idx = prim.getIndices();
  if (!idx) {
    const a = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) a[i] = i;
    return a;
  }
  const src = idx.getArray();
  return src instanceof Uint32Array ? new Uint32Array(src) : new Uint32Array(src);
}

function faceNormal(p, ia, ib, ic, out) {
  const ax = p[ia * 3], ay = p[ia * 3 + 1], az = p[ia * 3 + 2];
  const bx = p[ib * 3], by = p[ib * 3 + 1], bz = p[ib * 3 + 2];
  const cx = p[ic * 3], cy = p[ic * 3 + 1], cz = p[ic * 3 + 2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / len;
  out[1] = ny / len;
  out[2] = nz / len;
  return out;
}

function buildLock(opts, positions, indices, uvs, bbox) {
  const vertexCount = positions.length / 3;
  const lock = new Uint8Array(vertexCount);
  const stats = { boundaryVerts: 0, seamVerts: 0, foldVerts: 0, ridgeVerts: 0, gableVerts: 0 };

  const edgeCount = new Map();
  const faceNormals = new Float32Array(indices.length / 3 * 3);
  const fn = [0, 0, 0];

  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t], ib = indices[t + 1], ic = indices[t + 2];
    faceNormal(positions, ia, ib, ic, fn);
    const f = t / 3;
    faceNormals[f * 3] = fn[0];
    faceNormals[f * 3 + 1] = fn[1];
    faceNormals[f * 3 + 2] = fn[2];
    for (const [a, b] of [[ia, ib], [ib, ic], [ic, ia]]) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (lo === hi) continue;
      const key = lo * vertexCount + hi;
      const rec = edgeCount.get(key);
      if (rec === undefined) {
        edgeCount.set(key, 1);
      } else {
        edgeCount.set(key, rec + 1);
      }
    }
  }

  // 边界：只被一个三角形使用的边
  if (opts.lockBoundary) {
    for (const [key, count] of edgeCount) {
      if (count !== 1) continue;
      const lo = Math.floor(key / vertexCount);
      const hi = key - lo * vertexCount;
      lock[lo] = Math.max(lock[lo], 1);
      lock[hi] = Math.max(lock[hi], 1);
    }
    for (let i = 0; i < vertexCount; i++) if (lock[i] === 1) stats.boundaryVerts++;
  }

  // UV 缝：同一位置出现多组 UV
  if (opts.lockSeam && uvs) {
    const groups = new Map();
    for (let v = 0; v < vertexCount; v++) {
      const key = `${Math.round(positions[v * 3] * 1e4)},${Math.round(positions[v * 3 + 1] * 1e4)},${Math.round(positions[v * 3 + 2] * 1e4)}`;
      const uvKey = `${Math.round(uvs[v * 2] * 1e4)},${Math.round(uvs[v * 2 + 1] * 1e4)}`;
      let g = groups.get(key);
      if (!g) {
        g = new Set();
        groups.set(key, g);
      }
      g.add(uvKey);
    }
    const seamValue = opts.lockSeam === 2 ? 2 : 1;
    for (let v = 0; v < vertexCount; v++) {
      const key = `${Math.round(positions[v * 3] * 1e4)},${Math.round(positions[v * 3 + 1] * 1e4)},${Math.round(positions[v * 3 + 2] * 1e4)}`;
      if (groups.get(key).size > 1) {
        if (lock[v] === 0) stats.seamVerts++;
        lock[v] = Math.max(lock[v], seamValue);
      }
    }
  }

  // 大角度折边（屋檐 / 正脊 / 山墙转角）
  if (opts.lockAngle > 0) {
    const cosLimit = Math.cos((opts.lockAngle * Math.PI) / 180);
    // 逐三角形收集边 -> 面索引，用于二面角
    const byEdge = new Map();
    for (let t = 0; t < indices.length; t += 3) {
      const ia = indices[t], ib = indices[t + 1], ic = indices[t + 2];
      const f = t / 3;
      for (const [a, b] of [[ia, ib], [ib, ic], [ic, ia]]) {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        if (lo === hi) continue;
        const key = lo * vertexCount + hi;
        let list = byEdge.get(key);
        if (!list) {
          list = [];
          byEdge.set(key, list);
        }
        if (list.length < 2) list.push(f);
      }
    }
    for (const [key, faces] of byEdge) {
      if (faces.length !== 2) continue;
      const f0 = faces[0], f1 = faces[1];
      const dot =
        faceNormals[f0 * 3] * faceNormals[f1 * 3] +
        faceNormals[f0 * 3 + 1] * faceNormals[f1 * 3 + 1] +
        faceNormals[f0 * 3 + 2] * faceNormals[f1 * 3 + 2];
      if (dot > cosLimit) continue;
      const lo = Math.floor(key / vertexCount);
      const hi = key - lo * vertexCount;
      if (lock[lo] === 0) stats.foldVerts++;
      if (lock[hi] === 0) stats.foldVerts++;
      lock[lo] = Math.max(lock[lo], 1);
      lock[hi] = Math.max(lock[hi], 1);
    }
  }

  // 正脊带：最高处往下 lockRidge 米
  if (opts.lockRidge > 0) {
    const yMin = bbox.max[1] - opts.lockRidge;
    for (let v = 0; v < vertexCount; v++) {
      if (positions[v * 3 + 1] >= yMin) {
        if (lock[v] === 0) stats.ridgeVerts++;
        lock[v] = Math.max(lock[v], 1);
      }
    }
  }

  // 山墙带：|x| 接近包围盒两端 lockGable 米
  if (opts.lockGable > 0) {
    const xMax = bbox.max[0] - opts.lockGable;
    for (let v = 0; v < vertexCount; v++) {
      if (Math.abs(positions[v * 3]) >= xMax) {
        if (lock[v] === 0) stats.gableVerts++;
        lock[v] = Math.max(lock[v], 1);
      }
    }
  }

  let locked = 0;
  for (let i = 0; i < vertexCount; i++) if (lock[i]) locked++;
  stats.lockedVerts = locked;
  stats.totalVerts = vertexCount;
  return { lock, stats };
}

function computeBbox(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < positions.length / 3; v++) {
    for (let k = 0; k < 3; k++) {
      const x = positions[v * 3 + k];
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
    }
  }
  return { min, max };
}

function compact(indices, attributes) {
  const map = new Map();
  const order = [];
  for (let i = 0; i < indices.length; i++) {
    const old = indices[i];
    if (!map.has(old)) {
      map.set(old, order.length);
      order.push(old);
    }
    indices[i] = map.get(old);
  }
  const out = {};
  for (const [name, { size, data }] of Object.entries(attributes)) {
    const arr = new Float32Array(order.length * size);
    for (let n = 0; n < order.length; n++) {
      const old = order[n];
      for (let k = 0; k < size; k++) arr[n * size + k] = data[old * size + k];
    }
    out[name] = arr;
  }
  return { indices, attributes: out, count: order.length };
}

function splitComponents(indices, vertexCount) {
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
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
  for (let t = 0; t < indices.length; t += 3) {
    union(indices[t], indices[t + 1]);
    union(indices[t + 1], indices[t + 2]);
    union(indices[t + 2], indices[t]);
  }
  const map = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const root = find(indices[t]);
    let list = map.get(root);
    if (!list) {
      list = [];
      map.set(root, list);
    }
    list.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  return [...map.values()].map((a) => Uint32Array.from(a));
}

/**
 * 分件预算：小件原样保留（minTris 以下），大件按统一比例减，但有每件下限。
 * 用二分找满足总目标的 ratio。
 */
function planComponentTargets(components, targetTotal, minTris) {
  const small = components.filter((c) => c.length / 3 <= minTris);
  const large = components.filter((c) => c.length / 3 > minTris);
  const smallTris = small.reduce((s, c) => s + c.length / 3, 0);
  const totalAt = (ratio) => {
    let sum = smallTris;
    for (const c of large) {
      const tris = c.length / 3;
      sum += Math.min(tris, Math.max(minTris, Math.round(tris * ratio)));
    }
    return sum;
  };
  const minFeasible = totalAt(0);
  if (targetTotal < minFeasible) {
    return { feasible: false, minFeasible, small, large, targets: null, ratio: 0 };
  }
  if (targetTotal >= totalAt(1)) {
    return { feasible: true, minFeasible, small, large, ratio: 1, targets: large.map((c) => c.length / 3) };
  }
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (totalAt(mid) > targetTotal) hi = mid;
    else lo = mid;
  }
  const ratio = lo;
  const targets = large.map((c) => Math.min(c.length / 3, Math.max(minTris, Math.round((c.length / 3) * ratio))));
  return { feasible: true, minFeasible, small, large, ratio, targets };
}

function buildAttributeBuffer(vertexCount, uvs, normals, opts) {
  const parts = [];
  const weights = [];
  if (uvs) {
    parts.push(uvs);
    weights.push(opts.uvWeight, opts.uvWeight);
  }
  if (normals) {
    parts.push(normals);
    weights.push(opts.normalWeight, opts.normalWeight, opts.normalWeight);
  }
  if (!parts.length) return { attributes: new Float32Array(0), weights };
  const stride = weights.length;
  const attributes = new Float32Array(vertexCount * stride);
  let off = 0;
  for (const part of parts) {
    const comps = part.length / vertexCount;
    for (let v = 0; v < vertexCount; v++) {
      for (let k = 0; k < comps; k++) attributes[v * stride + off + k] = part[v * comps + k];
    }
    off += comps;
  }
  return { attributes, weights };
}

async function simplifyDocument(doc, opts) {
  const meshes = doc.getRoot().listMeshes();
  const results = [];
  let totalTrisBefore = 0;
  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      const posAttr = prim.getAttribute('POSITION');
      if (!posAttr) continue;
      const vertexCount = posAttr.getCount();
      const indices = readIndices(prim, vertexCount);
      totalTrisBefore += indices.length / 3;
    }
  }
  if (totalTrisBefore === 0) throw new Error('no triangles');

  const targetTotal = opts.tris > 0 ? opts.tris : Math.round(totalTrisBefore * opts.ratio);
  if (targetTotal >= totalTrisBefore) throw new Error(`target ${targetTotal} >= current ${totalTrisBefore}`);
  let allocated = 0;

  for (const mesh of meshes) {
    const prims = mesh.listPrimitives();
    for (let p = 0; p < prims.length; p++) {
      const prim = prims[p];
      const posAttr = prim.getAttribute('POSITION');
      if (!posAttr) continue;
      const vertexCount = posAttr.getCount();
      const indices = readIndices(prim, vertexCount);
      const trisBefore = indices.length / 3;
      const positions = attrToFloat(prim, 'POSITION', 3);
      const normals = attrToFloat(prim, 'NORMAL', 3);
      const uvs = attrToFloat(prim, 'TEXCOORD_0', 2);
      const bbox = computeBbox(positions);

      const targetTris = p === prims.length - 1
        ? targetTotal - allocated
        : Math.round((targetTotal * trisBefore) / totalTrisBefore);
      allocated += targetTris;

      const { lock, stats } = buildLock(opts, positions, indices, uvs, bbox);

      const { attributes, weights } = buildAttributeBuffer(vertexCount, uvs, normals, opts);

      let newIndices;
      let error;
      let compInfo = null;
      if (opts.perComponent) {
        const components = splitComponents(indices, vertexCount);
        const plan = planComponentTargets(components, targetTris, opts.minTris);
        if (!plan.feasible) {
          throw new Error(
            `target ${targetTris} is below per-component floor ${plan.minFeasible} (min-tris ${opts.minTris}); ` +
            `raise --tris or lower --min-tris`
          );
        }
        const out = [];
        error = 0;
        for (const c of plan.small) for (let i = 0; i < c.length; i++) out.push(c[i]);
        for (let i = 0; i < plan.large.length; i++) {
          const c = plan.large[i];
          const target = plan.targets[i];
          if (target >= c.length / 3) {
            for (let j = 0; j < c.length; j++) out.push(c[j]);
            continue;
          }
          const [ri, e] = MeshoptSimplifier.simplifyWithAttributes(
            c, positions, 3, attributes, weights.length, weights, lock, target * 3, opts.error, opts.flags
          );
          error = Math.max(error, e);
          for (let j = 0; j < ri.length; j++) out.push(ri[j]);
        }
        newIndices = Uint32Array.from(out);
        compInfo = {
          components: components.length,
          smallKept: plan.small.length,
          simplifiable: plan.large.length,
          ratio: plan.ratio,
        };
      } else {
        [newIndices, error] = MeshoptSimplifier.simplifyWithAttributes(
          indices,
          positions,
          3,
          attributes,
          weights.length,
          weights,
          lock,
          targetTris * 3,
          opts.error,
          opts.flags
        );
      }

      const keep = {};
      if (uvs) keep.TEXCOORD_0 = { size: 2, data: uvs };
      if (normals) keep.NORMAL = { size: 3, data: normals };
      keep.POSITION = { size: 3, data: positions };
      const packed = compact(newIndices, keep);

      const buffer = posAttr.getBuffer();
      prim.setAttribute(
        'POSITION',
        doc.createAccessor('POSITION').setType('VEC3').setArray(packed.attributes.POSITION).setBuffer(buffer)
      );
      if (normals) {
        prim.setAttribute(
          'NORMAL',
          doc.createAccessor('NORMAL').setType('VEC3').setArray(packed.attributes.NORMAL).setBuffer(buffer)
        );
      }
      if (uvs) {
        prim.setAttribute(
          'TEXCOORD_0',
          doc.createAccessor('TEXCOORD_0').setType('VEC2').setArray(packed.attributes.TEXCOORD_0).setBuffer(buffer)
        );
      }
      // 顶点重排后原 TANGENT 已不适用，删除让运行时按 UV 重算（或由下游补）
      if (prim.getAttribute('TANGENT')) prim.setAttribute('TANGENT', null);
      const indexArray = packed.count < 65536 ? Uint16Array.from(packed.indices) : packed.indices;
      prim.setIndices(doc.createAccessor('indices').setType('SCALAR').setArray(indexArray).setBuffer(buffer));

      results.push({
        mesh: mesh.getName() || '(unnamed)',
        primitive: p,
        trisBefore,
        trisAfter: packed.indices.length / 3,
        vertsBefore: vertexCount,
        vertsAfter: packed.count,
        targetTris,
        error,
        locks: stats,
        components: compInfo,
      });
    }
  }

  return { results, totalTrisBefore, targetTotal };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];
  const output = args._[1];
  if (!input || (!output && !args['stats-only'])) {
    console.error('usage: node simplify-attr.js <in.glb> <out.glb> --tris N [options]');
    process.exit(2);
  }

  const perComponent = !!args['per-component'];
  const opts = {
    tris: num(args.tris, 0),
    ratio: num(args.ratio, 0),
    error: num(args.error, 0.01),
    uvWeight: num(args['uv-weight'], 0.25),
    normalWeight: num(args['normal-weight'], 1),
    perComponent,
    minTris: num(args['min-tris'], 8),
    lockBoundary: num(args['lock-boundary'], perComponent ? 0 : 1) !== 0,
    lockSeam: num(args['lock-seam'], 0),
    lockAngle: num(args['lock-angle'], perComponent ? 0 : 60),
    lockRidge: num(args['lock-ridge'], 0.03),
    lockGable: num(args['lock-gable'], 0.03),
    flags: String(
      args.flags || (perComponent ? 'PreserveFolds,ErrorClamped' : 'LockBorder,PreserveFolds,ErrorClamped')
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
  if (!opts.tris && !opts.ratio) throw new Error('need --tris or --ratio');

  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE);
  const doc = await io.read(path.resolve(input));

  if (args['stats-only']) {
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const vertexCount = prim.getAttribute('POSITION').getCount();
        const indices = readIndices(prim, vertexCount);
        const positions = attrToFloat(prim, 'POSITION', 3);
        const uvs = attrToFloat(prim, 'TEXCOORD_0', 2);
        const bbox = computeBbox(positions);
        const { stats } = buildLock(opts, positions, indices, uvs, bbox);
        console.log(JSON.stringify({ mesh: mesh.getName(), tris: indices.length / 3, bbox, ...stats }, null, 2));
      }
    }
    return;
  }

  const { results, totalTrisBefore, targetTotal } = await simplifyDocument(doc, opts);
  // 清掉被替换下来的旧 accessor / TANGENT，否则 GLB 会白白多背一份旧顶点缓冲
  await doc.transform(prune());
  await io.write(path.resolve(output), doc);
  const report = { input, output, targetTotal, totalTrisBefore, options: opts, results };
  console.log(JSON.stringify(report, null, 2));
  if (args.report) fs.writeFileSync(path.resolve(args.report), JSON.stringify(report, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
