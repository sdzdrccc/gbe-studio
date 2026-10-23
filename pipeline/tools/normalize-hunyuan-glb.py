#!/usr/bin/env python3
"""Normalize a Hunyuan3D GLB for GBE.

- bake the node rotation (+90 deg X from Blender export)
- scale to exact dimensions (default 10 x 2 x 7 m)
- put pivot at bottom-center
- recompute normals for the non-uniform scale
- add TANGENT (vec4) for normal mapping
- resize embedded textures (default 2048)
- rebuild a clean GLB with material name roof-tile/qingwa

Usage:
  py pipeline/tools/normalize-hunyuan-glb.py <in.glb> <out.glb> [--dims 10,2,7] [--tex 2048]
"""
import argparse
import io
import json
import math
import os
import struct
from array import array

from PIL import Image

MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
FLOAT = 5126
USHORT = 5123
UINT = 5125
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963


def parse_glb(path):
    data = open(path, "rb").read()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != MAGIC or version != 2:
        raise ValueError("not a glTF 2.0 GLB: %s" % path)
    offset = 12
    gltf = None
    binc = None
    while offset < length:
        chunk_len, chunk_type = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8: offset + 8 + chunk_len]
        if chunk_type == JSON_CHUNK:
            gltf = json.loads(chunk)
        elif chunk_type == BIN_CHUNK:
            binc = chunk
        offset += 8 + chunk_len
    if gltf is None or binc is None:
        raise ValueError("GLB missing JSON or BIN chunk")
    return gltf, binc


def read_accessor(gltf, binc, index):
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    fmt = {FLOAT: "f", USHORT: "H", UINT: "I", 5121: "B"}[acc["componentType"]]
    size = struct.calcsize(fmt)
    stride = view.get("byteStride", size * comps)
    out = []
    for i in range(acc["count"]):
        out.append(struct.unpack_from("<" + fmt * comps, binc, base + i * stride))
    return out


def quat_matrix(q):
    x, y, z, w = q
    return (
        (1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
        (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
        (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)),
    )


def mat_vec(m, v):
    return (
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    )


def norm(v):
    l = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if l < 1e-12:
        return (0.0, 1.0, 0.0)
    return (v[0] / l, v[1] / l, v[2] / l)


def compute_tangents(positions, normals, uvs, indices):
    n_verts = len(positions)
    tan1 = [[0.0, 0.0, 0.0] for _ in range(n_verts)]
    tan2 = [[0.0, 0.0, 0.0] for _ in range(n_verts)]
    tri_count = len(indices) // 3
    for t in range(tri_count):
        i0 = indices[t * 3]
        i1 = indices[t * 3 + 1]
        i2 = indices[t * 3 + 2]
        p0, p1, p2 = positions[i0], positions[i1], positions[i2]
        uv0, uv1, uv2 = uvs[i0], uvs[i1], uvs[i2]
        e1 = (p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
        e2 = (p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2])
        d1 = (uv1[0] - uv0[0], uv1[1] - uv0[1])
        d2 = (uv2[0] - uv0[0], uv2[1] - uv0[1])
        det = d1[0] * d2[1] - d2[0] * d1[1]
        if abs(det) < 1e-12:
            continue
        r = 1.0 / det
        tx = (e1[0] * d2[1] - e2[0] * d1[1]) * r
        ty = (e1[1] * d2[1] - e2[1] * d1[1]) * r
        tz = (e1[2] * d2[1] - e2[2] * d1[1]) * r
        bx = (e2[0] * d1[0] - e1[0] * d2[0]) * r
        by = (e2[1] * d1[0] - e1[1] * d2[0]) * r
        bz = (e2[2] * d1[0] - e1[2] * d2[0]) * r
        for i in (i0, i1, i2):
            tan1[i][0] += tx
            tan1[i][1] += ty
            tan1[i][2] += tz
            tan2[i][0] += bx
            tan2[i][1] += by
            tan2[i][2] += bz
    tangents = []
    for i in range(n_verts):
        n = normals[i]
        v = tan1[i]
        d = n[0] * v[0] + n[1] * v[1] + n[2] * v[2]
        t = (v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d)
        if math.sqrt(t[0] * t[0] + t[1] * t[1] + t[2] * t[2]) < 1e-8:
            if abs(n[0]) < 0.9:
                t = (0.0, n[2], -n[1])
            else:
                t = (-n[2], 0.0, n[0])
        t = norm(t)
        b = tan2[i]
        cx = n[1] * t[2] - n[2] * t[1]
        cy = n[2] * t[0] - n[0] * t[2]
        cz = n[0] * t[1] - n[1] * t[0]
        w = 1.0 if (cx * b[0] + cy * b[1] + cz * b[2]) >= 0 else -1.0
        tangents.append((t[0], t[1], t[2], w))
    return tangents


def compute_normals(positions, indices):
    normals = [[0.0, 0.0, 0.0] for _ in positions]
    for t in range(0, len(indices), 3):
        i0 = indices[t]
        i1 = indices[t + 1]
        i2 = indices[t + 2]
        p0, p1, p2 = positions[i0], positions[i1], positions[i2]
        e1 = (p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
        e2 = (p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2])
        cx = e1[1] * e2[2] - e1[2] * e2[1]
        cy = e1[2] * e2[0] - e1[0] * e2[2]
        cz = e1[0] * e2[1] - e1[1] * e2[0]
        for i in (i0, i1, i2):
            normals[i][0] += cx
            normals[i][1] += cy
            normals[i][2] += cz
    return [norm(n) for n in normals]


def apply_column_profile(positions, total_h=3.0):
    """Straighten a Hunyuan column: collar 0.48 m, body 0.40 m, flat top.

    - y > 2.8: the AI often adds a mushroom cap; shrink it uniformly to body radius.
    - y <= 0.5: collar, outer radius 0.24.
    - y > 0.5: body, radius 0.20 -> 0.19 (5% taper over 2.5 m).
    Only the outer shell is remapped; inner/disk vertices keep their relative layout.
    """
    bins = {}
    for x, y, z in positions:
        r = math.hypot(x, z)
        b = int(y / 0.05)
        if r > bins.get(b, 0.0):
            bins[b] = r
    cap_max = max((math.hypot(x, z) for x, y, z in positions if y > 2.8), default=0.0)
    cap_factor = (0.19 / cap_max) if cap_max > 0 else 1.0
    out = []
    for x, y, z in positions:
        r = math.hypot(x, z)
        if y > 2.8:
            f = cap_factor
        elif y <= 0.5:
            b = int(y / 0.05)
            max_r = bins.get(b, 0.0)
            f = (0.24 / r) if (r > 0.7 * max_r and r > 0.05) else 1.0
        else:
            b = int(y / 0.05)
            max_r = bins.get(b, 0.0)
            if r > 0.7 * max_r and r > 0.05:
                target = 0.20 - 0.01 * (y - 0.5) / (total_h - 0.5)
                f = target / r
            else:
                f = 1.0
        out.append((x * f, y, z * f))
    return out


def resize_png(raw, size, resample):
    im = Image.open(io.BytesIO(raw))
    if im.mode != "RGB":
        im = im.convert("RGB")
    im = im.resize((size, size), resample)
    out = io.BytesIO()
    im.save(out, format="PNG", optimize=True)
    return out.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--dims", default="10,2,7")
    ap.add_argument("--tex", type=int, default=2048)
    ap.add_argument("--name", default=None, help="asset name (default: output basename without -normalized)")
    ap.add_argument("--material", default="roof-tile/qingwa")
    ap.add_argument("--column-profile", action="store_true")
    ap.add_argument("--column-cut-cap", action="store_true")
    args = ap.parse_args()

    tw, th, td = [float(x) for x in args.dims.split(",")]
    name = args.name
    if not name:
        name = os.path.basename(args.dst)
        if name.endswith(".glb"):
            name = name[:-4]
        if name.endswith("-normalized"):
            name = name[:-11]
    gltf, binc = parse_glb(args.src)

    prim = gltf["meshes"][0]["primitives"][0]
    attrs = prim["attributes"]
    positions = read_accessor(gltf, binc, attrs["POSITION"])
    normals = read_accessor(gltf, binc, attrs["NORMAL"])
    uvs = read_accessor(gltf, binc, attrs["TEXCOORD_0"])
    indices = [i[0] for i in read_accessor(gltf, binc, prim["indices"])]
    n_verts = len(positions)
    tri_count = len(indices) // 3
    print("src: %d verts, %d tris" % (n_verts, tri_count))

    node = gltf["nodes"][0]
    rot = quat_matrix(node.get("rotation", [0, 0, 0, 1]))
    world = [mat_vec(rot, p) for p in positions]
    xmin = min(p[0] for p in world)
    xmax = max(p[0] for p in world)
    ymin = min(p[1] for p in world)
    ymax = max(p[1] for p in world)
    zmin = min(p[2] for p in world)
    zmax = max(p[2] for p in world)
    print("world bbox: %.6f %.6f %.6f -> %.6f %.6f %.6f" % (xmin, ymin, zmin, xmax, ymax, zmax))

    sx = tw / (xmax - xmin)
    sy = th / (ymax - ymin)
    sz = td / (zmax - zmin)
    tx = -(xmin + xmax) * 0.5 * sx
    ty = -ymin * sy
    tz = -(zmin + zmax) * 0.5 * sz
    print("scale: %.6f %.6f %.6f" % (sx, sy, sz))

    out_pos = []
    out_nrm = []
    for p, n in zip(world, normals):
        out_pos.append((p[0] * sx + tx, p[1] * sy + ty, p[2] * sz + tz))
        wn = mat_vec(rot, n)
        out_nrm.append(norm((wn[0] / sx, wn[1] / sy, wn[2] / sz)))

    if args.column_profile:
        out_pos = apply_column_profile(out_pos, th)
        out_nrm = compute_normals(out_pos, indices)
        print("column profile: collar 0.24, body 0.20->0.19, flat top")
    if args.column_cut_cap:
        # Drop the mushroom cap, stretch the body to full height, add a flat top disk.
        cut_y = 2.8
        kept = []
        for t in range(0, len(indices), 3):
            i0, i1, i2 = indices[t], indices[t + 1], indices[t + 2]
            cy = (out_pos[i0][1] + out_pos[i1][1] + out_pos[i2][1]) / 3.0
            if cy <= cut_y:
                kept.extend((i0, i1, i2))
        removed = (len(indices) - len(kept)) // 3
        indices = kept
        scale_y = (th - 0.5) / (cut_y - 0.5)
        out_pos = [
            (x, min(th, 0.5 + (y - 0.5) * scale_y) if y > 0.5 else y, z)
            for x, y, z in out_pos
        ]
        out_nrm = compute_normals(out_pos, indices)
        rim = [
            uvs[i] for i in range(len(out_pos))
            if out_pos[i][1] > th - 0.02 and math.hypot(out_pos[i][0], out_pos[i][2]) > 0.15
        ]
        u0, v0 = rim[0] if rim else (0.5, 0.5)
        center_idx = len(out_pos)
        out_pos.append((0.0, th, 0.0))
        out_nrm.append((0.0, 1.0, 0.0))
        uvs.append((u0, v0))
        ring = []
        top_r = 0.195
        segs = 64
        for i in range(segs):
            a = 2.0 * math.pi * i / segs
            vi = len(out_pos)
            out_pos.append((top_r * math.cos(a), th, top_r * math.sin(a)))
            out_nrm.append((0.0, 1.0, 0.0))
            uvs.append((u0, v0))
            ring.append(vi)
        for i in range(segs):
            indices.extend((center_idx, ring[(i + 1) % segs], ring[i]))
        # Compact away cap vertices that are no longer referenced.
        used = sorted(set(indices))
        remap = {old: i for i, old in enumerate(used)}
        out_pos = [out_pos[i] for i in used]
        out_nrm = [out_nrm[i] for i in used]
        uvs = [uvs[i] for i in used]
        indices = [remap[i] for i in indices]
        n_verts = len(out_pos)
        print("cap cut: removed %d tris, added flat disk, verts now %d, tris now %d" % (removed, n_verts, len(indices) // 3))
    tangents = compute_tangents(out_pos, out_nrm, uvs, indices)
    print("tangents: %d" % len(tangents))

    # Verify final bbox and attribute ranges.
    xs = [p[0] for p in out_pos]
    ys = [p[1] for p in out_pos]
    zs = [p[2] for p in out_pos]
    print("normalized bbox: %.6f %.6f %.6f -> %.6f %.6f %.6f" % (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)))

    # Texture extraction (normal=0, baseColor=1, orm=2 as in source material).
    images = []
    for img in gltf.get("images", []):
        view = gltf["bufferViews"][img["bufferView"]]
        start = view.get("byteOffset", 0)
        raw = binc[start:start + view["byteLength"]]
        images.append(raw)
    if len(images) != 3:
        raise ValueError("expected 3 images, got %d" % len(images))
    tex = [
        resize_png(images[0], args.tex, Image.BICUBIC),  # normal
        resize_png(images[1], args.tex, Image.LANCZOS),  # baseColor
        resize_png(images[2], args.tex, Image.BICUBIC),  # metallic-roughness
    ]

    # BIN / bufferViews / accessors.
    bin_parts = []
    buffer_views = []

    def add_view(data, target=None):
        off = sum(len(x) for x in bin_parts)
        pad = (-off) % 4
        if pad:
            bin_parts.append(b"\0" * pad)
            off += pad
        view = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target is not None:
            view["target"] = target
        buffer_views.append(view)
        bin_parts.append(data)
        return len(buffer_views) - 1

    def floats_bytes(seq):
        arr = array("f")
        for v in seq:
            arr.extend(v)
        return arr.tobytes()

    pos_view = add_view(floats_bytes(out_pos), ARRAY_BUFFER)
    nrm_view = add_view(floats_bytes(out_nrm), ARRAY_BUFFER)
    tan_view = add_view(floats_bytes(tangents), ARRAY_BUFFER)
    uv_view = add_view(floats_bytes(uvs), ARRAY_BUFFER)
    idx_view = add_view(array("H", indices).tobytes(), ELEMENT_ARRAY_BUFFER)
    img_views = [add_view(t) for t in tex]

    accessors = [
        {
            "bufferView": pos_view,
            "componentType": FLOAT,
            "count": n_verts,
            "type": "VEC3",
            "min": [min(xs), min(ys), min(zs)],
            "max": [max(xs), max(ys), max(zs)],
        },
        {"bufferView": nrm_view, "componentType": FLOAT, "count": n_verts, "type": "VEC3"},
        {"bufferView": tan_view, "componentType": FLOAT, "count": n_verts, "type": "VEC4"},
        {"bufferView": uv_view, "componentType": FLOAT, "count": n_verts, "type": "VEC2"},
        {"bufferView": idx_view, "componentType": USHORT, "count": len(indices), "type": "SCALAR"},
    ]

    out = {
        "asset": {
            "version": "2.0",
            "generator": "gbe-studio normalize-hunyuan-glb",
        },
        "scene": 0,
        "scenes": [{"name": name, "nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [
            {
                "name": name,
                "primitives": [
                    {
                        "attributes": {
                            "POSITION": 0,
                            "NORMAL": 1,
                            "TANGENT": 2,
                            "TEXCOORD_0": 3,
                        },
                        "indices": 4,
                        "material": 0,
                    }
                ],
            }
        ],
        "materials": [
            {
                "name": args.material,
                "doubleSided": True,
                "normalTexture": {"index": 0},
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 1},
                    "metallicRoughnessTexture": {"index": 2},
                    "metallicFactor": 1.0,
                    "roughnessFactor": 1.0,
                },
            }
        ],
        "textures": [
            {"sampler": 0, "source": 0},
            {"sampler": 0, "source": 1},
            {"sampler": 0, "source": 2},
        ],
        "images": [
            {"bufferView": img_views[0], "mimeType": "image/png", "name": name + "_normal"},
            {"bufferView": img_views[1], "mimeType": "image/png", "name": name + "_basecolor"},
            {"bufferView": img_views[2], "mimeType": "image/png", "name": name + "_orm"},
        ],
        "samplers": [{"magFilter": 9729, "minFilter": 9987}],
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": 0}],
        "extras": {
            "source": "hunyuan3d",
            "source_file": os.path.basename(args.src),
            "name": name,
            "normalized_dims_m": [tw, th, td],
            "pivot": "bottom-center",
            "up": "+Y",
            "forward": "-Z",
        },
    }

    json_bytes = json.dumps(out, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    bin_bytes = b"".join(bin_parts)
    bin_bytes += b"\0" * ((-len(bin_bytes)) % 4)
    out["buffers"][0]["byteLength"] = len(bin_bytes)
    # Re-encode JSON now that buffer length is final.
    json_bytes = json.dumps(out, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)

    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    header = struct.pack("<III", MAGIC, 2, total)
    json_chunk = struct.pack("<II", len(json_bytes), JSON_CHUNK) + json_bytes
    bin_chunk = struct.pack("<II", len(bin_bytes), BIN_CHUNK) + bin_bytes
    with open(args.dst, "wb") as f:
        f.write(header + json_chunk + bin_chunk)
    print("wrote %s (%.2f MB)" % (args.dst, os.path.getsize(args.dst) / 1048576.0))


if __name__ == "__main__":
    main()
