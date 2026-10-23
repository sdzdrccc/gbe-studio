#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
轨 C：屋面重拓扑 + 从高模烘焙 baseColor / normal，导出 GLB。

运行环境：Blender 5.2 headless（也兼容 bpy 4.5 venv）；只依赖 numpy（Blender 自带），不依赖 GUI。
流程在 `blender --background --python ...` 里完成。

流程：
  1. 导入归一化高模（+Y up 的 GLB，Blender 自动转 Z-up）
  2. 复制一份低模，voxel remesh 合并 2773 个瓦件壳
  3. Collapse 减到目标面数（Quadriflow 在 headless 下不生效，未启用）
  4. 清 loose / 补洞 / 统一法线；把 bbox 精确对齐合同尺寸
  5. Smart UV 展开
  6. Cycles CPU 从高模烘 baseColor（DIFFUSE/COLOR）与切线空间 normal
  7. 建 PBR 材质，导出 GLB（+Y up、米、贴图内嵌）
  8. 可选：Cycles 渲染高模 / 低模同机位对照图

用法（仓库根）：
  export GBE_BLENDER=/path/to/blender
  "$GBE_BLENDER" --background --python pipeline/tools/lod/retopo-bake.py -- \
    --input pipeline/out/pilot-2026-10-22/normalized/yingshan-single-a-normalized.glb \
    --out-dir pipeline/out/pilot-2026-10-22/lod \
    --name yingshan-single-a-retopo-9k \
    --tris 9000 --voxel 0.03 --tex 2048 --render --building

注意：
  - Blender 的 glTF 导入后对象已经是 Z-up、单位变换；导出用 export_yup=True 转回 +Y up。
  - 高模的 normal map 会参与 normal 烘焙（保留 AI 细节）；若出现双重浮雕，用 --no-source-normal 关掉。
  - 只烘 baseColor/normal；metallic=0、roughness=0.85 用常量（原 MR 贴图绑在高模 UV 上，低模无法直接复用）。
"""

import argparse
import json
import math
import os
import sys
import time

import bpy
from mathutils import Vector


def log(msg):
    print(f'[retopo] {msg}', flush=True)


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--out-dir', required=True)
    p.add_argument('--name', default='retopo')
    p.add_argument('--tris', type=int, default=9000)
    p.add_argument('--voxel', type=float, default=0.03)
    p.add_argument('--tex', type=int, default=2048)
    p.add_argument('--no-source-normal', action='store_true', help='烘焙 normal 前断开高模 normal map（只烘几何）')
    p.add_argument('--render', action='store_true')
    p.add_argument('--building', action='store_true', help='额外渲染搭建筑对照（需 --render）')
    p.add_argument('--render-dir', default=None, help='默认与 out-dir 相同')
    p.add_argument('--render-samples', type=int, default=32)
    return p.parse_args(argv)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        raise RuntimeError('no mesh in input')
    # 合并多 mesh（本批屋面只有 1 个）
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def mesh_stats(obj):
    obj.data.calc_loop_triangles()
    tris = len(obj.data.loop_triangles)
    coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
    mn = Vector((min(v.x for v in coords), min(v.y for v in coords), min(v.z for v in coords)))
    mx = Vector((max(v.x for v in coords), max(v.y for v in coords), max(v.z for v in coords)))
    return {
        'verts': len(obj.data.vertices),
        'polys': len(obj.data.polygons),
        'tris': tris,
        'bbox_min': [round(v, 6) for v in mn],
        'bbox_max': [round(v, 6) for v in mx],
        'size': [round(v, 6) for v in (mx - mn)],
    }


def clean_mesh(obj):
    import bmesh
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    # 先删零面积面（导出器会静默丢掉它们并留下洞）
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    deg = [f for f in bm.faces if f.calc_area() < 1e-9]
    if deg:
        bmesh.ops.delete(bm, geom=deg, context='FACES')
        bm.to_mesh(obj.data)
        obj.data.update()
        log(f'removed {len(deg)} zero-area faces')
    bm.free()
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.delete_loose(use_verts=True, use_edges=True, use_faces=True)
    bpy.ops.mesh.dissolve_degenerate(threshold=1e-6)
    bpy.ops.mesh.fill_holes(sides=0)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.data.validate(verbose=True, clean_customdata=False)


def fit_bbox(obj, target_size, target_center_xy=(0.0, 0.0), target_zmin=0.0):
    """把顶点缩放到精确合同尺寸；先算当前 bbox，再逐轴缩。"""
    me = obj.data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    mn = Vector((min(xs), min(ys), min(zs)))
    mx = Vector((max(xs), max(ys), max(zs)))
    size = mx - mn
    sx = target_size[0] / size.x
    sy = target_size[1] / size.y
    sz = target_size[2] / size.z
    cx = (mn.x + mx.x) / 2
    cy = (mn.y + mx.y) / 2
    for v in me.vertices:
        v.co.x = (v.co.x - cx) * sx + target_center_xy[0]
        v.co.y = (v.co.y - cy) * sy + target_center_xy[1]
        v.co.z = (v.co.z - mn.z) * sz + target_zmin
    me.update()


def uv_stats(obj):
    me = obj.data
    uv = me.uv_layers.active.data
    me.calc_loop_triangles()
    area = 0.0
    mn = [1e9, 1e9]
    mx = [-1e9, -1e9]
    for tri in me.loop_triangles:
        pts = []
        for li in tri.loops:
            u, v = uv[li].uv
            pts.append((u, v))
            mn[0] = min(mn[0], u)
            mn[1] = min(mn[1], v)
            mx[0] = max(mx[0], u)
            mx[1] = max(mx[1], v)
        (ax, ay), (bx, by), (cx, cy) = pts
        area += abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2
    return {'coverage': round(area, 6), 'uv_min': [round(v, 5) for v in mn], 'uv_max': [round(v, 5) for v in mx]}


def bm_stats(obj):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    boundary = sum(1 for e in bm.edges if len(e.link_faces) == 1)
    nonmanifold = sum(1 for e in bm.edges if len(e.link_faces) > 2)
    loose = sum(1 for e in bm.edges if len(e.link_faces) == 0)
    bm.free()
    return {'boundaryEdges': boundary, 'nonManifoldEdges': nonmanifold, 'looseEdges': loose}


def uv_unwrap(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    # 89°：把近共面的瓦面并成少数大岛；66° 会在 9k 起伏面上切出 ~2000 个碎岛，
    # 导致 UV 只占 18%、烘焙大片空白与黑点。
    bpy.ops.uv.smart_project(
        angle_limit=math.radians(89.0),
        island_margin=0.0015,
        area_weight=0.0,
        correct_aspect=True,
        scale_to_bounds=True,
    )
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(
        rotate=True,
        rotate_method='ANY',
        margin=0.0015,
        margin_method='ADD',
        shape_method='CONCAVE',
        scale=True,
    )
    bpy.ops.object.mode_set(mode='OBJECT')


def make_bake_material(obj, tex_size, base_img, normal_img):
    # 高模还占着同名材质；先改名，避免 Blender 给低模材质加 .001 后缀
    existing = bpy.data.materials.get('roof-tile/qingwa')
    if existing:
        existing.name = 'roof-tile/qingwa-source'
    mat = bpy.data.materials.new('roof-tile/qingwa')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    tex_base = nt.nodes.new('ShaderNodeTexImage')
    tex_norm = nt.nodes.new('ShaderNodeTexImage')
    nrm = nt.nodes.new('ShaderNodeNormalMap')
    tex_base.image = base_img
    tex_base.interpolation = 'Linear'
    tex_base.extension = 'EXTEND'
    tex_norm.image = normal_img
    tex_norm.interpolation = 'Linear'
    tex_norm.extension = 'EXTEND'
    nt.links.new(tex_base.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tex_norm.outputs['Color'], nrm.inputs['Color'])
    nt.links.new(nrm.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.85
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return mat, tex_base, tex_norm


def disable_normal_map(obj):
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == 'NORMAL_MAP':
                for link in list(node.inputs['Color'].links):
                    mat.node_tree.links.remove(link)


def setup_bake(scene):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 16
    scene.render.bake.use_clear = True
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = 0.03
    scene.render.bake.max_ray_distance = 0.12


def bake_to(low, high, mat, node, kind):
    bpy.ops.object.select_all(action='DESELECT')
    high.hide_set(False)
    low.hide_set(False)
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    mat.node_tree.nodes.active = node
    t0 = time.time()
    if kind == 'normal':
        bpy.ops.object.bake(
            type='NORMAL',
            normal_space='TANGENT',
            use_selected_to_active=True,
            cage_extrusion=0.03,
            max_ray_distance=0.12,
            margin=16,
            use_clear=True,
        )
    else:
        bpy.ops.object.bake(
            type='DIFFUSE',
            pass_filter={'COLOR'},
            use_selected_to_active=True,
            cage_extrusion=0.03,
            max_ray_distance=0.12,
            margin=16,
            use_clear=True,
        )
    log(f'bake {kind} seconds {round(time.time() - t0, 1)}')


def save_image(img, path):
    img.filepath_raw = os.path.abspath(path)
    img.file_format = 'PNG'
    img.save()
    log(f'saved {path}')


def fill_texture_gaps(base_img, normal_img, radius=32):
    """把 baseColor 的空白区填成色块中值，并把边缘颜色向外扩 16 px。

    只用 numpy（Blender 自带），不依赖 PIL/scipy；以 normal 的背景色 (0.5,0.5,1)
    判断空白。38% UV 覆盖率下，接缝/mipmap 会采到黑色背景，表现为黑点。
    """
    import numpy as np
    w, h = base_img.size
    base = np.empty(w * h * 4, dtype=np.float32)
    normal = np.empty(w * h * 4, dtype=np.float32)
    base_img.pixels.foreach_get(base)
    normal_img.pixels.foreach_get(normal)
    base = base.reshape(h, w, 4)
    normal = normal.reshape(h, w, 4)
    bg = np.array([0.5, 0.5, 1.0], dtype=np.float32)
    good = (np.abs(normal[..., :3] - bg).max(axis=2) > 0.01) & (base[..., :3].max(axis=2) > 0.02)
    if good.all():
        return
    med = np.median(base[..., :3][good], axis=0)
    filled = base.copy()
    filled[~good, :3] = med
    mask = good.copy()
    for _ in range(radius):
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            sc = np.roll(filled, (dy, dx), axis=(0, 1))
            sm = np.roll(mask, (dy, dx), axis=(0, 1))
            if dy == -1:
                sm[-1, :] = False
            elif dy == 1:
                sm[0, :] = False
            if dx == -1:
                sm[:, -1] = False
            elif dx == 1:
                sm[:, 0] = False
            take = (~mask) & sm
            filled[take, :3] = sc[take, :3]
            mask |= take
        if mask.all():
            break
    base_img.pixels.foreach_set(filled.ravel())
    base_img.update()
    base_img.save()
    log(f'filled baseColor gaps: good={round(float(good.mean()) * 100, 1)}%')


def add_render_setup(scene):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 960
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'

    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.9, 0.9, 0.9, 1.0)
    bg.inputs[1].default_value = 1.0
    scene.world = world

    sun_data = bpy.data.lights.new('Sun', 'SUN')
    sun_data.energy = 3.0
    sun = bpy.data.objects.new('Sun', sun_data)
    scene.collection.objects.link(sun)
    sun.location = (6, -8, 12)
    sun.rotation_euler = (math.radians(35), math.radians(-15), math.radians(25))

    area_data = bpy.data.lights.new('Fill', 'AREA')
    area_data.energy = 300
    area_data.size = 8
    area = bpy.data.objects.new('Fill', area_data)
    scene.collection.objects.link(area)
    area.location = (-7, -6, 8)
    area.rotation_euler = (math.radians(55), 0, math.radians(-40))

    cam_data = bpy.data.cameras.new('Camera')
    cam_data.lens = 50
    cam = bpy.data.objects.new('Camera', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def aim_camera(cam, yaw_deg, pitch_deg, distance=18.0, target=(0.0, 0.0, 1.0)):
    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    tx, ty, tz = target
    cam.location = (
        tx + distance * math.cos(pitch) * math.sin(yaw),
        ty - distance * math.cos(pitch) * math.cos(yaw),
        tz + distance * math.sin(pitch),
    )
    direction = Vector(target) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def simple_material(name, color, roughness=0.8):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def add_box(scene, name, size, loc, mat):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return obj


def add_cylinder(scene, name, radius, depth, loc, mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=radius, depth=depth, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def build_static(scene):
    """Blockout 房子：台基 / 墙 / 5 根檐柱 / 地面。尺寸与 preview-building.js 一致。"""
    ground_mat = simple_material('ground-mat', (0.72, 0.72, 0.72, 1.0), 0.9)
    base_mat = simple_material('base-mat', (0.55, 0.53, 0.49, 1.0), 0.85)
    wall_mat = simple_material('wall-mat', (0.78, 0.74, 0.66, 1.0), 0.8)
    wood_mat = simple_material('wood-mat', (0.33, 0.20, 0.11, 1.0), 0.75)
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    ground = bpy.context.object
    ground.name = 'ground'
    ground.data.materials.append(ground_mat)
    base = add_box(scene, 'base', (10.4, 7.4, 0.4), (0, 0, 0.2), base_mat)
    wall = add_box(scene, 'wall', (9.6, 6.4, 3.0), (0, 0, 1.9), wall_mat)
    cols = []
    for i, x in enumerate([-4.4, -2.2, 0.0, 2.2, 4.4]):
        cols.append(add_cylinder(scene, f'column-{i}', 0.2, 3.0, (x, -3.3, 1.9), wood_mat))
    return [ground, base, wall] + cols


def add_building_roof(scene, roof_src, tag):
    roof = roof_src.copy()
    roof.data = roof_src.data.copy()
    roof.name = f'roof-building-{tag}'
    scene.collection.objects.link(roof)
    roof.location.z += 3.4
    return roof


def render_group(scene, cam, show, hide, prefix, out_dir, views, target=(0.0, 0.0, 1.0), distance=18.0):
    os.makedirs(out_dir, exist_ok=True)
    for label, yaw, pitch in views:
        aim_camera(cam, yaw, pitch, distance=distance, target=target)
        for obj in hide:
            obj.hide_render = True
        for obj in show:
            obj.hide_render = False
        scene.render.filepath = os.path.abspath(os.path.join(out_dir, f'{prefix}-{label}.png'))
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        log(f'render {scene.render.filepath} seconds {round(time.time() - t0, 1)}')


def main():
    args = parse_args()
    os.makedirs(args.out_dir, exist_ok=True)
    reset_scene()

    t_all = time.time()
    high = import_glb(args.input)
    high.name = 'high-source'
    src_stats = mesh_stats(high)
    log(f'source {src_stats}')

    # 低模：独立复制，避免破坏高模
    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)
    bpy.context.view_layer.objects.active = high
    bpy.ops.object.duplicate()
    low = bpy.context.view_layer.objects.active
    low.name = args.name
    low.data.name = args.name

    # voxel remesh 合并瓦件壳
    bpy.ops.object.select_all(action='DESELECT')
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    low.data.remesh_voxel_size = args.voxel
    low.data.remesh_voxel_adaptivity = 0.0
    t0 = time.time()
    bpy.ops.object.voxel_remesh()
    log(f'voxel remesh {round(time.time() - t0, 1)}s -> {mesh_stats(low)}')

    # 减面
    bpy.ops.object.select_all(action='DESELECT')
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    # 只走 Collapse。Quadriflow 在 bpy 4.5 模块下实测 0.0s 返回、面数不变（未生效），
    # 失败证据见 PILOT-2026-10-22 §4.8，这里不再暴露该选项。
    low.data.calc_loop_triangles()
    cur = len(low.data.loop_triangles)
    mod = low.modifiers.new('dec', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = min(1.0, args.tris / max(1, cur))
    mod.use_collapse_triangulate = True
    t0 = time.time()
    bpy.ops.object.modifier_apply(modifier=mod.name)
    log(f'decimate {round(time.time() - t0, 1)}s -> {mesh_stats(low)}')

    clean_mesh(low)
    log(f'cleaned {mesh_stats(low)} bm={bm_stats(low)}')

    # 合同尺寸：glTF +Y up 下 10 x 2 x 7（面阔 x 高 x 进深）；
    # Blender 是 Z-up，导入后轴序为 x=10 / y=7 / z=2，所以这里传 (10, 7, 2)
    fit_bbox(low, (10.0, 7.0, 2.0))
    log(f'fitted {mesh_stats(low)}')
    # 非均匀缩放后可能有零面积三角，导出时会被丢掉并留下 6 条边界；再清一遍
    clean_mesh(low)
    log(f'post-fit clean {mesh_stats(low)} bm={bm_stats(low)}')

    uv_unwrap(low)
    log(f'uv layers {[uv.name for uv in low.data.uv_layers]} {uv_stats(low)}')

    # 贴图与材质
    base_img = bpy.data.images.new(f'{args.name}-basecolor', args.tex, args.tex, alpha=False)
    base_img.colorspace_settings.name = 'sRGB'
    normal_img = bpy.data.images.new(f'{args.name}-normal', args.tex, args.tex, alpha=False)
    normal_img.colorspace_settings.name = 'Non-Color'
    mat, tex_base, tex_norm = make_bake_material(low, args.tex, base_img, normal_img)

    if not args.no_source_normal:
        log('source normal map kept for normal bake')
    else:
        disable_normal_map(high)

    setup_bake(bpy.context.scene)
    bake_to(low, high, mat, tex_norm, 'normal')
    bake_to(low, high, mat, tex_base, 'diffuse')

    save_image(normal_img, os.path.join(args.out_dir, f'{args.name}-normal.png'))
    save_image(base_img, os.path.join(args.out_dir, f'{args.name}-basecolor.png'))
    fill_texture_gaps(base_img, normal_img)

    # 导出 GLB：只选低模
    bpy.ops.object.select_all(action='DESELECT')
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    glb_path = os.path.join(args.out_dir, f'{args.name}.glb')
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(glb_path),
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_tangents=False,
    )
    log(f'exported {glb_path}')

    # 可选：高模 / 低模同机位贴图对照
    if args.render:
        render_dir = args.render_dir or args.out_dir
        cam = add_render_setup(bpy.context.scene)
        bpy.context.scene.cycles.samples = args.render_samples
        views = [('three-quarter', 35, 20), ('front', 0, 8), ('side', 90, 8)]
        render_group(bpy.context.scene, cam, [low], [high], f'{args.name}-textured', render_dir, views)
        render_group(bpy.context.scene, cam, [high], [low], 'roof-50k-textured', render_dir, views)

        if args.building:
            statics = build_static(bpy.context.scene)
            roof_low_b = add_building_roof(bpy.context.scene, low, 'low')
            roof_high_b = add_building_roof(bpy.context.scene, high, 'high')
            bviews = [('three-quarter', 35, 18), ('front', 0, 6), ('side', 90, 6)]
            render_group(
                bpy.context.scene, cam, statics + [roof_low_b], [low, high, roof_high_b],
                f'{args.name}-building-textured', render_dir, bviews, target=(0.0, 0.0, 2.4), distance=20.0
            )
            render_group(
                bpy.context.scene, cam, statics + [roof_high_b], [low, high, roof_low_b],
                'building-50k-textured', render_dir, bviews, target=(0.0, 0.0, 2.4), distance=20.0
            )

    report = {
        'input': os.path.abspath(args.input),
        'output_glb': os.path.abspath(glb_path),
        'name': args.name,
        'method': 'collapse',
        'voxel': args.voxel,
        'tris_target': args.tris,
        'texture_size': args.tex,
        'source_normal_used': not args.no_source_normal,
        'seconds_total': round(time.time() - t_all, 1),
        'source': src_stats,
        'low': mesh_stats(low),
        'textures': {
            'basecolor': os.path.abspath(os.path.join(args.out_dir, f'{args.name}-basecolor.png')),
            'normal': os.path.abspath(os.path.join(args.out_dir, f'{args.name}-normal.png')),
        },
    }
    with open(os.path.join(args.out_dir, f'{args.name}-report.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    log(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
