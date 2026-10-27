'use strict';

/**
 * fixture.js —— 产线工具测试用**最小 GLB 夹具**（不依赖真实资产 / Blender）。
 *
 * 生成一张 `n×n` 的平面网格（默认 4×4 = 32 三角形）：
 *   - POSITION / NORMAL / TEXCOORD_0 / indices
 *   - 开放边界（不是水密体）—— 对 simplify 模式足够，对 retopo 模式**不冒充通过**
 *
 * 用法（供测试 require；也可单独运行生成一个）：
 *   const { writeGridGlb } = require('./fixture');
 *   await writeGridGlb('/tmp/grid.glb', 4);
 */

const { Document, NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');

async function writeGridGlb(file, n = 4) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions = [];
  const normals = [];
  const uvs = [];
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      positions.push(x / n, y / n, 0);
      normals.push(0, 0, 1);
      uvs.push(x / n, y / n);
    }
  }
  const indices = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * (n + 1) + x;
      indices.push(i, i + 1, i + n + 1, i + 1, i + n + 2, i + n + 1);
    }
  }

  const pos = doc.createAccessor('POSITION').setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer);
  const nrm = doc.createAccessor('NORMAL').setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer);
  const uv = doc.createAccessor('TEXCOORD_0').setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer);
  const idx = doc.createAccessor('indices').setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', pos)
    .setAttribute('NORMAL', nrm)
    .setAttribute('TEXCOORD_0', uv)
    .setIndices(idx);
  const mesh = doc.createMesh('grid').addPrimitive(prim);
  const node = doc.createNode('grid').setMesh(mesh);
  doc.createScene('scene').addChild(node);

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  await io.write(file, doc);
  return { triangles: indices.length / 3, vertices: positions.length / 3 };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('用法：node pipeline/tools/test/fixture.js <out.glb> [n]');
    process.exit(2);
  }
  writeGridGlb(file, Number(process.argv[3] || 4))
    .then((r) => console.log(`wrote ${file} · tris=${r.triangles} verts=${r.vertices}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { writeGridGlb };
