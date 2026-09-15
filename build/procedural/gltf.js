'use strict';

/**
 * gltf.js —— glTF 2.0 Binary（.glb）写出器 + 解析器（零依赖）
 *
 * 为什么手搓而不是调库：见 geom.js 头注。这里只补一句 —— glb 的容器格式简单到
 * 「一个头 + 两个 chunk」，为它引一个 npm 依赖不划算；而 4 字节对齐、min/max 必填
 * 这些坑，自己写一遍反而更容易在 QA 里被自检抓住。
 *
 * 坐标：glTF 本身就是 +Y up / -Z forward，与 CONVENTIONS §1 完全一致 ——
 * **所以这里不做任何轴转换**。轴转换是集成层按引擎做的事（UE/Unity 的左手系），
 * 精修层只产出引擎无关的标准 glb。
 *
 * 输出形态：非索引（non-indexed），每个 submesh 一个 primitive、一个材质。
 */

const GEN_VERSION = 'gbe-procedural/1.0.0';
const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

/** sRGB(0–1) → 线性（glTF 的 baseColorFactor 是线性空间） */
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToLinearRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

function pad4(n) {
  return (4 - (n % 4)) % 4;
}

/**
 * 组装 .glb
 * @param {object} o
 * @param {string} o.name            网格名
 * @param {number[]} o.positions     扁平 xyz
 * @param {number[]} o.normals       扁平 xyz（与 positions 等长）
 * @param {{slot:string,start:number,count:number}[]} o.submeshes
 * @param {{slot:string,name:string,colorHex:string,metallic?:number,roughness?:number}[]} o.materials
 * @returns {Buffer}
 */
function buildGlb(o) {
  const positions = o.positions;
  const normals = o.normals;
  if (positions.length !== normals.length) {
    throw new Error(`positions(${positions.length}) 与 normals(${normals.length}) 长度不一致`);
  }
  const vertexCount = positions.length / 3;
  if (!Number.isInteger(vertexCount)) throw new Error('positions 长度必须是 3 的倍数');

  // ── 二进制缓冲：POSITION 块 + NORMAL 块
  const posBytes = positions.length * 4;
  const nrmBytes = normals.length * 4;
  const bin = Buffer.alloc(posBytes + nrmBytes);
  for (let i = 0; i < positions.length; i++) bin.writeFloatLE(positions[i], i * 4);
  for (let i = 0; i < normals.length; i++) bin.writeFloatLE(normals[i], posBytes + i * 4);

  // ── 材质表：slot -> 材质索引
  const matList = o.materials || [];
  const matIndexBySlot = new Map();
  matList.forEach((m, i) => matIndexBySlot.set(m.slot, i));

  const accessors = [];
  const primitives = [];
  for (const sm of o.submeshes) {
    const count = sm.count;
    if (count === 0) continue;
    // POSITION 的 min/max 是 glTF 规范硬性要求，不是可选优化
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let v = 0; v < count; v++) {
      const p = (sm.start + v) * 3;
      const x = positions[p];
      const y = positions[p + 1];
      const z = positions[p + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    const posAcc = accessors.length;
    accessors.push({
      bufferView: 0,
      byteOffset: sm.start * 12,
      componentType: 5126, // FLOAT
      count,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });
    const nrmAcc = accessors.length;
    accessors.push({
      bufferView: 1,
      byteOffset: sm.start * 12,
      componentType: 5126,
      count,
      type: 'VEC3',
    });

    const prim = { attributes: { POSITION: posAcc, NORMAL: nrmAcc }, mode: 4 };
    if (matIndexBySlot.has(sm.slot)) prim.material = matIndexBySlot.get(sm.slot);
    primitives.push(prim);
  }

  const materials = matList.map((m) => ({
    name: m.name || m.slot,
    pbrMetallicRoughness: {
      baseColorFactor: m.colorLinear
        ? [...m.colorLinear, 1]
        : [...hexToLinearRgb(m.colorHex || '#b0b0b0'), 1],
      metallicFactor: m.metallic === undefined ? 0 : m.metallic,
      roughnessFactor: m.roughness === undefined ? 0.9 : m.roughness,
    },
    doubleSided: m.doubleSided === true,
  }));

  const gltf = {
    asset: { version: '2.0', generator: GEN_VERSION },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: o.name || 'mesh' }],
    meshes: [{ name: o.name || 'mesh', primitives }],
    materials,
    accessors,
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 }, // ARRAY_BUFFER
      { buffer: 0, byteOffset: posBytes, byteLength: nrmBytes, target: 34962 },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  // ── 容器组装
  const jsonRaw = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = pad4(jsonRaw.length);
  const jsonChunk = Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]); // JSON 用空格补齐
  const binPad = pad4(bin.length);
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0x00)]); // BIN 用 0 补齐

  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(total);
  let o0 = 0;
  out.writeUInt32LE(GLB_MAGIC, o0); o0 += 4;
  out.writeUInt32LE(2, o0); o0 += 4;
  out.writeUInt32LE(total, o0); o0 += 4;

  out.writeUInt32LE(jsonChunk.length, o0); o0 += 4;
  out.writeUInt32LE(CHUNK_JSON, o0); o0 += 4;
  jsonChunk.copy(out, o0); o0 += jsonChunk.length;

  out.writeUInt32LE(binChunk.length, o0); o0 += 4;
  out.writeUInt32LE(CHUNK_BIN, o0); o0 += 4;
  binChunk.copy(out, o0); o0 += binChunk.length;

  return out;
}

/**
 * 解析 .glb（自检用：写出后立刻读回来，确认容器与访问器自洽）。
 * @returns {{ok:boolean, error?:string, json?:object, binLength?:number, stats?:object}}
 */
function parseGlb(buf) {
  try {
    if (buf.length < 20) return { ok: false, error: '文件太短' };
    if (buf.readUInt32LE(0) !== GLB_MAGIC) return { ok: false, error: 'magic 不是 glTF' };
    const version = buf.readUInt32LE(4);
    if (version !== 2) return { ok: false, error: `version=${version}，期望 2` };
    const declared = buf.readUInt32LE(8);
    if (declared !== buf.length) return { ok: false, error: `header.length=${declared} 与实际 ${buf.length} 不符` };

    let p = 12;
    let json = null;
    let binLength = 0;
    while (p + 8 <= buf.length) {
      const cl = buf.readUInt32LE(p);
      const ct = buf.readUInt32LE(p + 4);
      const body = p + 8;
      if (body + cl > buf.length) return { ok: false, error: `chunk 越界（len=${cl}）` };
      if (ct === CHUNK_JSON) json = JSON.parse(buf.slice(body, body + cl).toString('utf8'));
      else if (ct === CHUNK_BIN) binLength = cl;
      p = body + cl;
    }
    if (!json) return { ok: false, error: '没有 JSON chunk' };

    const mesh = json.meshes && json.meshes[0];
    if (!mesh) return { ok: false, error: '没有 mesh' };
    let tris = 0;
    let verts = 0;
    for (const pr of mesh.primitives) {
      const pa = json.accessors[pr.attributes.POSITION];
      if (!pa) return { ok: false, error: 'primitive 缺 POSITION 访问器' };
      if (!pa.min || !pa.max) return { ok: false, error: 'POSITION 访问器缺 min/max（规范硬性要求）' };
      if (!pr.attributes.NORMAL) return { ok: false, error: 'primitive 缺 NORMAL' };
      if (pr.material !== undefined && !json.materials[pr.material]) {
        return { ok: false, error: `primitive 引用了不存在的材质 ${pr.material}` };
      }
      verts += pa.count;
      tris += pa.count / 3;
    }
    if (Number.isInteger(json.buffers[0].byteLength) && json.buffers[0].byteLength > binLength) {
      return { ok: false, error: `buffer 声明 ${json.buffers[0].byteLength} 字节，BIN chunk 只有 ${binLength}` };
    }
    return {
      ok: true,
      json,
      binLength,
      stats: {
        primitives: mesh.primitives.length,
        vertices: verts,
        triangles: tris,
        materials: (json.materials || []).length,
      },
    };
  } catch (e) {
    return { ok: false, error: `解析异常：${e.message}` };
  }
}

module.exports = { buildGlb, parseGlb, hexToLinearRgb, srgbToLinear, GEN_VERSION };
