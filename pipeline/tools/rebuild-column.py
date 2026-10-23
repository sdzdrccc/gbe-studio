#!/usr/bin/env python3
"""Track A: rebuild the eave column as a clean low-poly cylinder.

- 48 radial segments
- collar 0..0.5 m, outer radius 0.24
- body 0.5..3.0 m, radius 0.20 -> 0.19
- flat top / closed bottom
- cylindrical UV, baseColor baked from the high-poly AI atlas

Usage:
  py pipeline/tools/rebuild-column.py <basecolor-cyl.png> <out.glb>
"""
import io
import json
import math
import os
import struct
import sys
from array import array

from PIL import Image

MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
FLOAT = 5126
USHORT = 5123
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963

N = 48
H = 3.0
COLLAR_H = 0.5
COLLAR_R = 0.24
BODY_R0 = 0.20
BODY_R1 = 0.19


def ring(r, y, v, uv_mode="side"):
    """N+1 vertices, u=0..1, seam duplicated."""
    out = []
    for i in range(N + 1):
        a = 2.0 * math.pi * i / N
        x = r * math.cos(a)
        z = r * math.sin(a)
        out.append((x, y, z, i / N, v, a))
    return out


def main():
    tex_path, out_path = sys.argv[1], sys.argv[2]

    # Clean the jagged top/bottom edge of the baked atlas.
    tex = Image.open(tex_path).convert("RGB")
    tw, th = tex.size
    px = tex.load()
    top = px[tw // 2, min(th - 1, 20)]
    bottom = px[tw // 2, max(0, th - 21)]
    for y in range(0, 16):
        for x in range(tw):
            px[x, y] = top
    for y in range(th - 16, th):
        for x in range(tw):
            px[x, y] = bottom

    positions = []
    normals = []
    uvs = []
    indices = []

    def add_vertex(p, n, uv):
        positions.append(p)
        normals.append(n)
        uvs.append(uv)
        return len(positions) - 1

    def ring_indices(ring_verts, normal_fn, uv_v=None):
        base = len(positions)
        for (x, y, z, u, v, a) in ring_verts:
            add_vertex((x, y, z), normal_fn(a), (u, v))
        return list(range(base, base + len(ring_verts)))

    # Rings
    cb = ring(COLLAR_R, 0.0, 0.0)                 # collar bottom
    ct = ring(COLLAR_R, COLLAR_H, COLLAR_H / H)   # collar top (outer)
    bb = ring(BODY_R0, COLLAR_H, COLLAR_H / H)    # body bottom (inner)
    bt = ring(BODY_R1, H, 1.0)                    # body top
    so = ring(COLLAR_R, COLLAR_H, COLLAR_H / H)   # step outer
    si = ring(BODY_R0, COLLAR_H, COLLAR_H / H)    # step inner

    # Collar side
    cb_i = ring_indices(cb, lambda a: (math.cos(a), 0.0, math.sin(a)))
    ct_i = ring_indices(ct, lambda a: (math.cos(a), 0.0, math.sin(a)))
    for i in range(N):
        indices += [cb_i[i], ct_i[i], ct_i[i + 1]]
        indices += [cb_i[i], ct_i[i + 1], cb_i[i + 1]]

    # Step annulus (+Y)
    so_i = ring_indices(so, lambda a: (0.0, 1.0, 0.0))
    si_i = ring_indices(si, lambda a: (0.0, 1.0, 0.0))
    for i in range(N):
        indices += [si_i[i], so_i[i + 1], so_i[i]]
        indices += [si_i[i], si_i[i + 1], so_i[i + 1]]

    # Body side (slight taper: normal gets a small +Y)
    slope = (BODY_R0 - BODY_R1) / (H - COLLAR_H)
    def body_normal(a):
        n = (math.cos(a), slope, math.sin(a))
        l = math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2])
        return (n[0] / l, n[1] / l, n[2] / l)
    bb_i = ring_indices(bb, body_normal)
    bt_i = ring_indices(bt, body_normal)
    for i in range(N):
        indices += [bb_i[i], bt_i[i], bt_i[i + 1]]
        indices += [bb_i[i], bt_i[i + 1], bb_i[i + 1]]

    # Top disk (+Y), wood UV from the body
    top_base = len(positions)
    top_center = add_vertex((0.0, H, 0.0), (0.0, 1.0, 0.0), (0.5, 0.9))
    top_ring = []
    for i in range(N + 1):
        a = 2.0 * math.pi * i / N
        top_ring.append(add_vertex((BODY_R1 * math.cos(a), H, BODY_R1 * math.sin(a)), (0.0, 1.0, 0.0), (0.5, 0.9)))
    for i in range(N):
        indices += [top_center, top_ring[i + 1], top_ring[i]]

    # Bottom disk (-Y), collar UV
    bot_center = add_vertex((0.0, 0.0, 0.0), (0.0, -1.0, 0.0), (0.5, 0.05))
    bot_ring = []
    for i in range(N + 1):
        a = 2.0 * math.pi * i / N
        bot_ring.append(add_vertex((COLLAR_R * math.cos(a), 0.0, COLLAR_R * math.sin(a)), (0.0, -1.0, 0.0), (0.5, 0.05)))
    for i in range(N):
        indices += [bot_center, bot_ring[i], bot_ring[i + 1]]

    # Texture bytes
    base_buf = io.BytesIO()
    tex.save(base_buf, format="PNG", optimize=True)
    base_bytes = base_buf.getvalue()

    orm = Image.new("RGB", (512, 512), (255, 220, 20))
    orm_buf = io.BytesIO()
    orm.save(orm_buf, format="PNG")
    orm_bytes = orm_buf.getvalue()

    # BIN / bufferViews / accessors
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

    pos_view = add_view(floats_bytes(positions), ARRAY_BUFFER)
    nrm_view = add_view(floats_bytes(normals), ARRAY_BUFFER)
    uv_view = add_view(floats_bytes(uvs), ARRAY_BUFFER)
    idx_view = add_view(array("H", indices).tobytes(), ELEMENT_ARRAY_BUFFER)
    base_view = add_view(base_bytes)
    orm_view = add_view(orm_bytes)

    xs = [p[0] for p in positions]
    ys = [p[1] for p in positions]
    zs = [p[2] for p in positions]
    accessors = [
        {"bufferView": pos_view, "componentType": FLOAT, "count": len(positions), "type": "VEC3",
         "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]},
        {"bufferView": nrm_view, "componentType": FLOAT, "count": len(positions), "type": "VEC3"},
        {"bufferView": uv_view, "componentType": FLOAT, "count": len(positions), "type": "VEC2"},
        {"bufferView": idx_view, "componentType": USHORT, "count": len(indices), "type": "SCALAR"},
    ]

    out = {
        "asset": {"version": "2.0", "generator": "gbe-studio rebuild-column"},
        "scene": 0,
        "scenes": [{"name": "yanzhu-round-a", "nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "yanzhu-round-a"}],
        "meshes": [{
            "name": "yanzhu-round-a",
            "primitives": [{
                "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
                "indices": 3,
                "material": 0,
            }],
        }],
        "materials": [{
            "name": "timber/ben-se",
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 0},
                "metallicRoughnessTexture": {"index": 1},
                "metallicFactor": 1.0,
                "roughnessFactor": 1.0,
            },
        }],
        "textures": [{"sampler": 0, "source": 0}, {"sampler": 0, "source": 1}],
        "images": [
            {"bufferView": base_view, "mimeType": "image/png", "name": "yanzhu-round-a_basecolor"},
            {"bufferView": orm_view, "mimeType": "image/png", "name": "yanzhu-round-a_orm"},
        ],
        "samplers": [{"magFilter": 9729, "minFilter": 9987}],
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": 0}],
        "extras": {
            "source": "track-A rebuild",
            "source_highpoly": "yanzhu-round-a-normalized.glb",
            "normalized_dims_m": [0.48, 3.0, 0.48],
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
    json_bytes = json.dumps(out, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    header = struct.pack("<III", MAGIC, 2, total)
    json_chunk = struct.pack("<II", len(json_bytes), JSON_CHUNK) + json_bytes
    bin_chunk = struct.pack("<II", len(bin_bytes), BIN_CHUNK) + bin_bytes
    with open(out_path, "wb") as f:
        f.write(header + json_chunk + bin_chunk)
    print("wrote", out_path, "tris", len(indices) // 3, "verts", len(positions), "MB", round(os.path.getsize(out_path) / 1048576, 2))


if __name__ == "__main__":
    main()
