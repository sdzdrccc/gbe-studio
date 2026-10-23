#!/usr/bin/env python3
"""Bake the AI column's baseColor atlas into a cylindrical UV texture.

The high-poly column is already normalized: X/Z centered, Y 0..3, 0.4 m body.
Output: U = angle/2pi, V = y/3. Outer surface wins over inner surfaces.
"""
import io
import json
import math
import struct
import sys

from PIL import Image

MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def parse_glb(path):
    data = open(path, "rb").read()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != MAGIC or version != 2:
        raise ValueError("not a GLB 2.0")
    offset = 12
    gltf = None
    binc = None
    while offset < length:
        clen, ctype = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8: offset + 8 + clen]
        if ctype == JSON_CHUNK:
            gltf = json.loads(chunk)
        elif ctype == BIN_CHUNK:
            binc = chunk
        offset += 8 + clen
    return gltf, binc


def read_acc(gltf, binc, index):
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    fmt = {5126: "f", 5123: "H", 5125: "I", 5121: "B"}[acc["componentType"]]
    size = struct.calcsize(fmt)
    stride = view.get("byteStride", size * comps)
    out = []
    for i in range(acc["count"]):
        out.append(struct.unpack_from("<" + fmt * comps, binc, base + i * stride))
    return out


def main():
    src, dst = sys.argv[1], sys.argv[2]
    W = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
    H = int(sys.argv[4]) if len(sys.argv) > 4 else 2048
    gltf, binc = parse_glb(src)
    prim = gltf["meshes"][0]["primitives"][0]
    pos = read_acc(gltf, binc, prim["attributes"]["POSITION"])
    uv = read_acc(gltf, binc, prim["attributes"]["TEXCOORD_0"])
    idx = [x[0] for x in read_acc(gltf, binc, prim["indices"])]

    mat = gltf["materials"][prim["material"]]
    tex_index = mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    img_index = gltf["textures"][tex_index]["source"]
    img = gltf["images"][img_index]
    view = gltf["bufferViews"][img["bufferView"]]
    start = view.get("byteOffset", 0)
    raw = binc[start:start + view["byteLength"]]
    source = Image.open(io.BytesIO(raw)).convert("RGB")
    sw, sh = source.size
    spx = source.load()

    out = Image.new("RGB", (W, H), (0, 0, 0))
    opx = out.load()
    best = [0.0] * (W * H)
    covered = bytearray(W * H)

    for t in range(0, len(idx), 3):
        ia, ib, ic = idx[t], idx[t + 1], idx[t + 2]
        pa, pb, pc = pos[ia], pos[ib], pos[ic]
        ra = math.hypot(pa[0], pa[2])
        rb = math.hypot(pb[0], pb[2])
        rc = math.hypot(pc[0], pc[2])
        if ra < 0.04 and rb < 0.04 and rc < 0.04:
            continue  # top/bottom disks; flat colors instead
        ua = math.atan2(pa[2], pa[0]) / (2.0 * math.pi) + 0.5
        ub = math.atan2(pb[2], pb[0]) / (2.0 * math.pi) + 0.5
        uc = math.atan2(pc[2], pc[0]) / (2.0 * math.pi) + 0.5
        if max(ua, ub, uc) - min(ua, ub, uc) > 0.5:
            ua += 1.0 if ua < 0.5 else 0.0
            ub += 1.0 if ub < 0.5 else 0.0
            uc += 1.0 if uc < 0.5 else 0.0
        va = pa[1] / 3.0
        vb = pb[1] / 3.0
        vc = pc[1] / 3.0
        xa, ya = ua * W, (1.0 - va) * (H - 1)
        xb, yb = ub * W, (1.0 - vb) * (H - 1)
        xc, yc = uc * W, (1.0 - vc) * (H - 1)
        den = (yb - yc) * (xa - xc) + (xc - xb) * (ya - yc)
        if abs(den) < 1e-12:
            continue
        r_avg = (ra + rb + rc) / 3.0
        minx = max(0, int(math.floor(min(xa, xb, xc))) - 1)
        maxx = min(W - 1, int(math.ceil(max(xa, xb, xc))) + 1)
        miny = max(0, int(math.floor(min(ya, yb, yc))) - 1)
        maxy = min(H - 1, int(math.ceil(max(ya, yb, yc))) + 1)
        if minx > maxx or miny > maxy:
            continue
        for py in range(miny, maxy + 1):
            fy = py + 0.5
            for px in range(minx, maxx + 1):
                fx = px + 0.5
                l0 = ((yb - yc) * (fx - xc) + (xc - xb) * (fy - yc)) / den
                l1 = ((yc - ya) * (fx - xc) + (xa - xc) * (fy - yc)) / den
                l2 = 1.0 - l0 - l1
                if l0 < -0.002 or l1 < -0.002 or l2 < -0.002:
                    continue
                u = l0 * uv[ia][0] + l1 * uv[ib][0] + l2 * uv[ic][0]
                v = l0 * uv[ia][1] + l1 * uv[ib][1] + l2 * uv[ic][1]
                sx = int(u * (sw - 1))
                sy = int(v * (sh - 1))
                if sx < 0 or sy < 0 or sx >= sw or sy >= sh:
                    continue
                x = px % W
                k = py * W + x
                if covered[k] and r_avg < best[k]:
                    continue
                opx[x, py] = spx[sx, sy]
                best[k] = r_avg
                covered[k] = 1

    # Fill uncovered pixels with the median color of covered ones.
    colors = [opx[x, y] for y in range(0, H, 4) for x in range(0, W, 4) if covered[y * W + x]]
    if colors:
        fill = tuple(sorted(c[i] for c in colors)[len(colors) // 2] for i in range(3))
    else:
        fill = (90, 70, 50)
    for y in range(H):
        for x in range(W):
            if not covered[y * W + x]:
                opx[x, y] = fill

    # Wrap-seam blend: make U=0 and U=1 match over 8 px.
    for k in range(8):
        for y in range(H):
            a = opx[k, y]
            b = opx[W - 1 - k, y]
            c = tuple((a[i] + b[i]) // 2 for i in range(3))
            opx[k, y] = c
            opx[W - 1 - k, y] = c

    out.save(dst)
    filled = sum(covered)
    print("baked", dst, out.size, "coverage", round(filled * 100.0 / (W * H), 2), "%", "fill", fill)


if __name__ == "__main__":
    main()
