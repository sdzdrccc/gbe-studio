#!/usr/bin/env node
'use strict';

/**
 * 打印 GLB 的节点 / 网格 / primitive / 属性 / 材质 / 贴图与三角面统计。
 * 只读，不改文件。
 *
 *   node pipeline/tools/lod/inspect-glb.js <file.glb>
 */

const path = require('path');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');

function fmt(n, d = 3) {
  return Number.isFinite(n) ? n.toFixed(d) : String(n);
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node inspect-glb.js <file.glb>');
    process.exit(2);
  }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path.resolve(file));
  const root = doc.getRoot();

  console.log(`file     : ${file}`);
  console.log(`scenes   : ${root.listScenes().length}  nodes: ${root.listNodes().length}  meshes: ${root.listMeshes().length}`);
  console.log(`materials: ${root.listMaterials().length}  textures: ${root.listTextures().length}  skins: ${root.listSkins().length}  animations: ${root.listAnimations().length}`);

  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh && !node.getTranslation().some((v) => v !== 0) && !node.getRotation().some((v, i) => (i === 3 ? v !== 1 : v !== 0))) continue;
    console.log(`\nnode "${node.getName() || '(unnamed)'}"  T=[${node.getTranslation().map((v) => fmt(v)).join(', ')}]  R=[${node.getRotation().map((v) => fmt(v)).join(', ')}]  S=[${node.getScale().map((v) => fmt(v)).join(', ')}]`);
    if (!mesh) continue;
    console.log(`  mesh "${mesh.getName() || '(unnamed)'}"  primitives: ${mesh.listPrimitives().length}`);
    mesh.listPrimitives().forEach((prim, i) => {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const tris = idx ? idx.getCount() / 3 : (pos ? pos.getCount() / 3 : 0);
      const attrs = prim.listSemantics().join(' ');
      const mat = prim.getMaterial();
      console.log(`  [${i}] tris=${tris}  verts=${pos ? pos.getCount() : 0}  attrs={${attrs}}  material=${mat ? mat.getName() : 'none'}  mode=${prim.getMode()}`);
      if (i === 0 && pos) {
        const mn = [Infinity, Infinity, Infinity];
        const mx = [-Infinity, -Infinity, -Infinity];
        for (let v = 0; v < pos.getCount(); v++) {
          const p = pos.getElement(v, []);
          for (let k = 0; k < 3; k++) {
            mn[k] = Math.min(mn[k], p[k]);
            mx[k] = Math.max(mx[k], p[k]);
          }
        }
        console.log(`      bbox min=[${mn.map((v) => fmt(v)).join(', ')}] max=[${mx.map((v) => fmt(v)).join(', ')}] size=[${mx.map((v, k) => fmt(v - mn[k])).join(', ')}]`);
      }
    });
  }

  for (const mat of root.listMaterials()) {
    const base = mat.getBaseColorTexture();
    const mr = mat.getMetallicRoughnessTexture();
    const normal = mat.getNormalTexture();
    const emissive = mat.getEmissiveTexture();
    console.log(`\nmaterial "${mat.getName()}"  baseColor=${mat.getBaseColorFactor().map((v) => fmt(v)).join(',')}  metal=${fmt(mat.getMetallicFactor(), 2)} rough=${fmt(mat.getRoughnessFactor(), 2)}`);
    for (const [label, tex] of [['baseColor', base], ['metallicRoughness', mr], ['normal', normal], ['emissive', emissive]]) {
      if (!tex) continue;
      const img = tex.getImage();
      console.log(`  ${label}: ${img ? `${img.byteLength} bytes mime=${tex.getMimeType()}` : 'no image'}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
