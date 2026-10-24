# pipeline/ —— 提示词 → 参考图 → GLB → LOD 的唯一产线

> 本目录只放**批次产物**与**处理脚本**，不放契约、不放核心代码。
> 仓库级目录规范见 [`../docs/REPO-LAYOUT.md`](../docs/REPO-LAYOUT.md)。

## 固定五段

| 子目录 | 放什么 | 入 Git | 命名 |
|---|---|---|---|
| `prompts/` | 人写的提示词 / 三视图设定稿 | ✅ | `pilot-NN-<asset>.md` |
| `source-images/` | 图像模型直接产出的原图（横向三视图） | ❌（6 张，约 15 MB，暂无 LFS） | `<batch>/<asset>-<view>-<variant>.png` |
| `tools/` | 批次处理脚本 | ✅ | `kebab-case.py` / `kebab-case.js` |
| `out/` | 切图、归一化 GLB、LOD、预览 | ❌ | `<batch>/{refs,normalized,lod,preview}/` |
| `reports/` | 批次报告：统计、门禁、已知不足 | ✅ | `<BATCH>.md` |

**批次目录名**统一 `pilot-YYYY-MM-DD`。

> **构件 vs 整栋**：构件级批次（pilot-01 / 02）才走 `gbe-assets/inbox` → intake；整栋 / 整件批次（pilot-05 起）**不拆构件、不入 `kits/`**，归一后的 GLB 交场景侧（模型库 / 下游），本仓只留提示词、报告与处理脚本。

> 没有可用 LOD 的批次不建 `lod/`；坏件进 `out/_archive/<batch>/lod-failed/`。

## 阶段门禁

1. **prompt**：一资产一份，写清尺寸、形制、材质、禁止项；三视图同一缩放。
2. **source-images**：只收原图；不在这里切图、不改名。
3. **refs**：切成单视角、去水印、同 px/m、同画布；正/俯同宽，正交要透视校正；只留屋面本体，不带房子其他部分。
4. **normalized**：烘焙节点旋转；归一到合同尺寸；轴心底中心；`+Y up`；PBR 贴图内嵌；补 TANGENT；材质 id 用 `<group>/<name>`。
5. **lod**：见 [`../docs/LOD-PIPELINE.md`](../docs/LOD-PIPELINE.md) 的三轨；**不交毁轮廓的 LOD**。本批：檐柱走轨 A（384 tris）；屋面走轨 B 保边界 28,944 tris（中间档/回退）与轨 C 重拓扑 **8,996 tris + 2K 烘焙**（村景主用），均过几何门禁 + 搭建筑门禁。20k / `Permissive` / Quadriflow 候选归档 `out/_archive/pilot-2026-10-22/lod-failed/`。50k 高模保留作 hero。
6. **report**：写清源/结果 tris、bbox、贴图、材质、已知不足、复跑命令；这是唯一入 Git 的批次说明。

## 当前批次

### 待生成（图已齐，直接图生 3D）

- `village-ruin-b`（10-25）、`village-school-b`（10-24）、`cave-mouth`（10-23）。

> 按「整栋 / 整件不拆分」口径，出图后按 `docs/REPO-LAYOUT.md` §3 落 `out/pilot-<日期>/refs/<asset>/`。

### 2026-10-26（槐阴村道具与地标）

- 提示词：[`prompts/cn-ancient/pilot-07-village-props.md`](prompts/cn-ancient/pilot-07-village-props.md)
- 报告：[`reports/PILOT-2026-10-26.md`](reports/PILOT-2026-10-26.md)
- 产物：`out/pilot-2026-10-26/refs/<asset>/{front,side,top}.png`（10 件 × 3 张 = 30 张，1920×1920；口径为**三张单图分张**，非三格拼图）
- 原图：`source-images/pilot-2026-10-26/`（30 张定稿 62.4 MB + 淘汰稿 13 张，不入 Git）
- 3D 成品：仓外模型库 `models/huaiyin/props/`（10 件，已处理；见 `MODEL-INVENTORY.md` 第十节）

### 2026-10-25（槐阴村民居变体）

- 提示词：[`prompts/cn-ancient/pilot-06-village-buildings-b.md`](prompts/cn-ancient/pilot-06-village-buildings-b.md)
- 报告：[`reports/PILOT-2026-10-25.md`](reports/PILOT-2026-10-25.md)
- 产物：`out/pilot-2026-10-25/refs/{village-house-b,village-house-c,village-house-d,village-ruin-b}/`（各 3 张，1920×1920；house-b/c/d 是正 / 侧 / 俯，`ruin-b` 是正 / 侧 / 俯 / **背** 四张）
- 原图：`source-images/pilot-2026-10-25/`（13 张，23.2 MB，不入 Git）

### 2026-10-24（槐阴村整栋不拆分）

- 提示词：[`prompts/cn-ancient/pilot-05-village-whole-buildings.md`](prompts/cn-ancient/pilot-05-village-whole-buildings.md)
- 报告：[`reports/PILOT-2026-10-24.md`](reports/PILOT-2026-10-24.md)
- 产物：`out/pilot-2026-10-24/refs/{village-house-a,village-school-b}/`（各正 / 侧 / 俯 3 张，1920×1920）
- 原图：`source-images/pilot-2026-10-24/`（6 张，约 15 MB，不入 Git）

### 2026-10-23（村落自然与废墟）

- 提示词：[`prompts/cn-ancient/pilot-04-village-nature-ruin.md`](prompts/cn-ancient/pilot-04-village-nature-ruin.md)
- 报告：[`reports/PILOT-2026-10-23.md`](reports/PILOT-2026-10-23.md)
- 产物：`out/pilot-2026-10-23/refs/{cave-mouth,school-ruin-4m,old-locust-v2}/`
- 原图：`source-images/pilot-2026-10-23/`（9 张，约 14 MB，不入 Git）

### 2026-10-22（构件试产）

- 报告：[`reports/PILOT-2026-10-22.md`](reports/PILOT-2026-10-22.md)
- 产物：`out/pilot-2026-10-22/{refs,normalized,lod,preview}/`
- 原图：`source-images/pilot-2026-10-22/`（6 张，约 15 MB，不入 Git）

## 工具

| 脚本 | 用途 |
|---|---|
| `tools/normalize-hunyuan-glb.py` | 混元 GLB 归一：烘焙旋转、精确尺寸、底中心、法线/切线、2K 贴图、材质改名；檐柱支持 `--column-profile --column-cut-cap` |
| `tools/preview-normalized-glb.js` | 零依赖灰模预览（3/4、正、顶），只验证几何 |
| `tools/bake-column-texture.py` | 把高模 baseColor 沿圆柱 UV 烘焙成 1024×2048（檐柱轨 A） |
| `tools/rebuild-column.py` | 参数化重建檐柱：48 段、套箍 0.5 m、平顶，384 tris |
| `tools/lod/simplify-attr.js` | 轨 B：分件预算 + meshoptimizer 属性感知减面 + 结构锁；输出非交错 GLB |
| `tools/lod/retopo-bake.py` | 轨 C：Blender 5.2 headless —— voxel remesh → decimate → UV → Cycles 烘 baseColor/normal → GLB；可渲贴图/搭建筑对照 |
| `tools/lod/validate-lod.js` | LOD 几何门禁：bbox / 边界保留率（或 `--mode retopo` 水密）/ 退化 / 反向面积 / 索引 / UV |
| `tools/lod/inspect-glb.js` | 读 GLB 结构：节点、primitive、属性、材质、贴图、bbox |
| `tools/lod/analyze-mesh.js` | 拓扑体检：连通分量、边界、开闭、高度分布（判断能不能锁边界） |

LOD 工具依赖 `meshoptimizer` + `@gltf-transform/*`，声明在**仓库根** `package.json` 的 `devDependencies`（运行时不依赖）。

**本机依赖不放在项目内**：`node_modules` 统一在 `F:\zxc\node_modules`，Node 按父目录查找即可命中（`gbe-studio` → `Project` → `zxc`）。不要在仓库根跑 `npm install`——那会在项目内重建一份；确需重装时，在 `F:\zxc` 维护这份依赖，再回仓库跑测试。

轨 C 用 **Blender 5.2**（headless；本机已有，也可用 bpy 4.5 venv）。脚本只依赖 numpy（Blender 自带），不需要 PIL/scipy。用环境变量指向可执行文件，**Blender/venv 都不进 Git**：

```bash
export GBE_BLENDER=/path/to/blender
"$GBE_BLENDER" --background --python pipeline/tools/lod/retopo-bake.py -- --help
```

```bash
py pipeline/tools/normalize-hunyuan-glb.py <in.glb> <out.glb> \
  --dims 10,2,7 --tex 2048 --name yingshan-single-a --material roof-tile/qingwa

node pipeline/tools/preview-normalized-glb.js <out.glb> <out-dir>
```

## 不做

- 不在仓库根目录放 `vibe_images/`、截图、临时 `.glb` / `.png`。
- 不把 `out/`、`source-images/`、`build/out/`、`decompose/out/` 加进 Git。
- 不把批次报告写进 `docs/`；`docs/` 只放长期方案与规范。
- 不直接改 `gbe-assets` 的契约；入库走 `inbox/` → intake。
