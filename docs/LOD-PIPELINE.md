# LOD 与简化器设计

> 状态：2026-10-23。**P1 ✅** 檐柱轨 A 384 tris；**P2 ✅** 屋面轨 B 28,944 tris（保边界）；**P3 ✅** 屋面轨 C 重拓扑 **8,996 tris + 2K 烘焙**（村景主用）；P4 未实现。
> 触发：`pilot-2026-10-22` 用 glTF-Transform 4.5.1 直减到 20k，檐柱被压成锥形、屋面变薄；单独预览看不出来，搭进建筑才暴露。

---

## 0. 一句话

**不是"混元不行"，也不是"换个减面器就行"——是"把 AI 三角汤直接减面"这条路不行。**
简化器要分三轨：**简单构件重建**、**复杂件带锁减面**、**hero 重拓扑 + 法线烘焙**。

---

## 1. 失败证据（先写下来，避免重复）

| 试验 | 参数 | 结果 |
|---|---|---|
| glTF-Transform `simplify` | 檐柱 `ratio 0.484, error 0.001` | 20,005 tris；柱身被压成锥/鼓包 |
| glTF-Transform `simplify` + `lock-border` | 同上 | 19,839 tris；仍锥 |
| 自写 `meshoptimizer.simplifyWithAttributes` | UV+法线权重 `[1,1,2,2,2]`；边界 + UV 缝 + 每 0.25 m 环锁；`Permissive/Prune/PreserveFolds` | 19,999 tris、error 0.00096；**搭建筑仍锥**；锁住的顶点可以变成"未使用顶点"，QEM 误差看不出轮廓塌陷 |
| 同上 + 重算法线 | —— | 仍锥；说明不是法线，是索引/topology |
| 屋面全局属性感知减面（不锁边界） | 目标 20k、error 0.1；UV/法线权重 `[0.25,0.25,1,1,1]`；`ErrorClamped` | **20,000 tris**；边界边 33,082 → 19,828（60%）；檐口/山脊被削成锯齿，搭建筑不可用 |
| 屋面分件 + `Permissive` | 同上，`--per-component --min-tris 8` + `Permissive` | **19,939 tris**；瓦面被压成菱形破洞/碎片；不可用 |
| 屋面分件 + 保边界 | 同上，不 `Permissive`、不锁边界；≤8 tris 小件原样保留 | **28,944 tris**；边界 33,078（99.99%）；bbox 精确；搭建筑与 50k 接近；**可交 LOD0** |
| 屋面轨 C 重拓扑 | Blender 5.2 headless：voxel 0.03 → decimate 9k → clean → smart UV 89° → Cycles 烘 2K | **8,996 tris**；水密、bbox 精确、UV 45.2%；贴图搭建筑与 50k 接近；**村景主用** |
| Quadriflow（headless） | `quadriflow_remesh(mode='FACES', target_faces=4500, preserve_sharp)` | **0.0s 返回、588,394 tris 不变**；headless 下未生效，弃用（证据归档 `lod-failed/yingshan-retopo/`） |

**结论**：
1. QEM 的 `error` 只衡量几何偏差，**不衡量轮廓/可用性**；必须加"搭建筑"门禁。
2. 锁顶点不等于锁面；简化器可以把锁住的顶点变成未使用，表面仍会收敛。
3. 简单回转体（柱、梁、墙段、瓦）**不该减面**，该按参数重建。
4. ★ **屋面不是一整张壳**：49,958 tris 分属 **2,773 个互不相连的瓦件**，44,105 顶点里 **32,987 个是边界点**（75%）。保边界减面不能删边界点，每个壳体至少要“边界点数 − 3”个三角面 ⇒ 这版屋面的**拓扑下限约 29k**。20k 只能靠破坏檐口/脊线换取；要 20k 以下必须靠轨 C 重拓扑或程序化屋面。
5. ★ **轨 C 已验证**：voxel remesh 0.03 把 2,773 个壳并成一张水密面，decimate 到 **8,996 tris**，重新 UV + 2K 烘焙后搭建筑与 50k 接近。代价：UV 覆盖率 45.2%、瓦面近看略软、仍有少量小黑点、MR 用常量；hero / 特写仍用 50k。

---

## 2. 现有方案调研

| 方案 | 能做什么 | 适合 | 局限 |
|---|---|---|---|
| **meshoptimizer**（[GitHub](https://github.com/zeux/meshoptimizer) · [npm](https://www.npmjs.com/package/meshoptimizer)） | `simplifyWithAttributes`；UV/法线误差权重；`vertex_lock`（1=锁、2=保护缝）；`LockBorder` / `Permissive` / `PreserveFolds` / `Prune` / `Regularize` | 复杂三角面、带 UV 的 LOD | 仍是 QEM；对 AI 的 split-vertex/薄壳/分离岛不稳定；glTF-Transform CLI **没有暴露**这些能力（只给 ratio/error/lock-border） |
| **gltfpack**（meshoptimizer 的 CLI） | `-si` 简化、锁边界、属性感知；比 glTF-Transform CLI 参数多 | 批量 GLB | 仍是同一套算法；Cocos 文档明确警告可能丢 UV 排布 |
| **Blender Decimate + 法线烘焙**（[Decimate](https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/decimate.html) · [Bake](https://docs.blender.org/manual/en/latest/render/cycles/baking.html)） | Collapse/Planar；`preserve_boundary`；顶点组保护；高模→低模法线烘焙 | 复杂件、hero、最终交付 | 要 Blender；需要高低模/UV/烘焙流程；不是 0 依赖 |
| **MeshLab / PyMeshLab**（[MeshLab](https://github.com/cnr-isti-vclab/meshlab) · [PyMeshLab](https://github.com/cnr-isti-vclab/pymeshlab)） | Quadric Edge Collapse **with texture**；Preserve Boundary/Normal；脚本化 | 带贴图的三角网格 | GLB 往返要转 OBJ/PLY；UV/材质需要复核 |
| **SeamAwareDecimater**（[GitHub](https://github.com/songrun/SeamAwareDecimater)） | 保留 UV 边界的简化 | 带缝网格 | 老项目；工程化成本 |
| **Fast-Quadric-Mesh-Simplification** | 快速 QEM | 纯几何 | Cocos 明确标注"可能丢 UV 排布" |
| **UnityMeshSimplifier**（[GitHub](https://github.com/Whinarn/UnityMeshSimplifier)） | Preserve Boundaries / UV Seams / Hard Edges | 算法参考 | Unity 侧；不是本仓运行时 |
| **Instant Meshes / Quadriflow**（[Instant Meshes](https://github.com/wjakob/instant-meshes)） | 场对齐 quad 重拓扑 | 干净四边面 | 不保 UV/贴图；要重新展开 + 烘焙 |
| **Tripo 低模 / remesh** | 原生 48–20k 面 | component 低模 | `quad:false`（仅 H3.1 有限 quad）；适配器未落地；仍要检查拓扑 |
| 论文：**Simplifying Textured Triangle Meshes in the Wild**（[arXiv](https://arxiv.org/html/2409.15458v2)） | 纹理感知的简化度量 | 设计参考 | 研究代码，不宜直接进流水线 |

---

## 3. 设计：三轨，而不是一个减面器

### 轨 A · 简单构件重建（首选）

**对象**：檐柱、梁、墙段、台基、瓦、栏杆直段等参数化构件。
**做法**：按参数生成干净低模（圆柱 12–24 段、墙段 2–4 段、瓦面单片），UV 用规则展开；把 AI 贴图**投影/烘焙**到新 UV 上。
**目标**：0.5k–5k tris；**不减面**。
**收益**：拓扑干净、轮廓数学上正确、没有锥化风险；柱子的 AI 木纹保留。
**判据**：半径/截面逐段与高模一致；套箍/柱头是独立环；贴图无明显接缝。

> 檐柱是第一个该走 A 的件：它本质就是"圆柱 + 套箍 + 平顶"，没必要在 41k 三角汤上减面。

### 轨 B · 带锁属性感知减面（复杂件）

**对象**：屋面、树、脊饰、斗拱等无法参数化的件。
**做法**（已落 `pipeline/tools/lod/simplify-attr.js`）：
- `meshoptimizer.simplifyWithAttributes`，属性 = UV + 法线（权重 `[0.25,0.25,1,1,1]`，按件可调）；
- **分件预算**：先按连通分量拆开，`≤ min-tris` 的小件原样保留（保住瓦当/小脊饰），大件按统一比例减、每件有下限；总目标用二分求比例；
- 结构锁：正脊带（默认最高 0.03 m）、山墙带（默认两端 0.03 m）；边界与 UV 缝默认**不**锁（见下）；
- `ErrorClamped`；**不用 `Permissive`**——屋面实测会破瓦面；`LockBorder` 也不要——2,773 个壳的边界一锁就减不动；
- 后处理：只复用原顶点、保 UV/法线；删 TANGENT（运行时重算）；`prune()` 清旧 accessor；索引按顶点数降到 Uint16；
- 输出用 `VertexLayout.SEPARATE`：**不要交错**，否则只认紧凑布局的下游工具会读错（本轮踩过）。
**门禁**（`pipeline/tools/lod/validate-lod.js`）：bbox、边界边保留率 ≥99.9%、退化三角、反向面积、索引/NaN；再加搭建筑渲染。**单独预览不算**。
**失败处置**：保留高模，进轨 C 或直接不交 LOD。

> 实测：屋面 20k 只能靠全局减面（边界掉到 60%）或 `Permissive`（破瓦面）；保边界的分件减面下限 28,944 tris，搭建筑可用。见 `PILOT-2026-10-22` §4.4 / §4.7。

### 轨 C · 重拓扑 + 法线烘焙（hero / 近景）

**对象**：主殿、城门楼、近景构件、需要 9k 以下的屋面。
**已落工具**：`pipeline/tools/lod/retopo-bake.py`（Blender 5.2 headless；脚本只依赖 numpy，Blender 自带）。
**实测流程**：
1. 导入归一化高模（Blender 自动 Y-up → Z-up）；
2. 复制低模，`voxel_remesh(0.03 m)` 把 2,773 个瓦件壳并成一张面（588k tris，0.6s）；
3. `DECIMATE(COLLAPSE)` 减到 ~9k（7s）；
4. 清 loose / 零面积 / 补洞 / 统一法线；按合同尺寸 **10 × 7 × 2 m（Blender 轴序）** 逐轴对齐；
5. `smart_project(89°)` + `average_islands_scale` + `pack_islands(CONCAVE)`（UV 覆盖 45.2%）；
6. Cycles CPU 从高模烘 **2K baseColor（DIFFUSE/COLOR）** 与 **2K 切线空间 normal**；高模 normal map 参与烘焙；空像素用最近邻填掉；
7. 建 PBR 材质（metallic 0 / roughness 0.85），导出 GLB（+Y up、米、贴图内嵌、非交错）。

**结果**：8,996 tris / 4,484 焊接顶点（GLB 12,281，UV 拆点后）；水密（焊接后边界 0）、bbox 精确、退化 0；13.2 MB；复跑 GLB 与两张贴图逐字节一致；搭建筑贴图渲染与 50k 接近。见 `PILOT-2026-10-22` §4.8。

**已知不足**：
- UV 只覆盖 45.2%，纹理有效分辨率低于 2K；瓦面近看略软；
- 仍有 2–4 个针尖大小黑点（贴图/法线采样），建筑距离不可见；
- MR 用常量，未烘 metallic-roughness；normal 由高模（含其 normal map）烘出，未做 AO；
- Quadriflow 在 headless 下 0.0s 返回、面数不变，**不可用**；Collapse 是当前唯一可靠路径；
- 依赖 **Blender 5.2**（本机已有；也可用 bpy 4.5 venv）；脚本只依赖 numpy（Blender 自带），不要求 PIL/scipy；Blender/venv **不进 Git**，路径见 `pipeline/README.md`。

---

## 4. 流水线

```
分类 → 预算门禁 → 预处理 → 减面/重建 → 后处理 → 门禁 → 烘焙(可选) → 报告
```

1. **分类**：按 `asset.category` / `tier` / 几何特征分到 A/B/C。
2. **预算门禁**：源 tris ≤ tier 预算 ⇒ **不减**，直接交。
3. **预处理**：按位置+属性 weld；删退化三角；统计边界边、UV 缝、材质边界、二面角硬边。
4. **简化/重建**：轨 A 参数重建；轨 B 带锁减面；轨 C 重拓扑。
5. **后处理**：重算法线/切线；清理未使用顶点；检查 UV 缝。
6. **门禁**（缺一不可）：
   - **几何门禁**：`pipeline/tools/lod/validate-lod.js` —— 减面用 `--mode simplify`（边界保留率 ≥99.9%），重拓扑用 `--mode retopo --weld 1e-5`（要求水密）；另查 bbox、退化三角 <0.5%、反向面积、索引/NaN；
   - **搭建筑色块渲染**（`pipeline/tools/preview-building.js`）；
   - **轮廓/剖面**：柱按每 0.25 m 半径剖面；屋面按脊/檐/山墙边界与轮廓 IoU；
   - **锁点使用率**：锁住的顶点必须仍被索引引用；
   - **UV 缝**：不能被跨缝合并（`Permissive` 默认禁用）。
7. **烘焙**：几何细节丢失时，用轨 C 的方式烘 normal/AO；否则不伪造细节。
8. **报告**：源/目标/实得 tris、error、锁点数、门禁结果、复跑命令。

**铁律**：
- 门禁不过 ⇒ **不交 LOD**；保留高模并写明。
- 不做"单张预览看着行"就入库——这次就是单张预览骗过了我们。
- 不把"目标 9k"当硬指标压到毁形；宁可交 20k/50k 高模。

---

## 5. 落地顺序

| 阶段 | 做什么 | 验收 |
|---|---|---|
| **P1** ✅ | 檐柱走轨 A：程序化圆柱 + 套箍 + 平顶，投影/烘焙 AI 木纹 | 384 tris；bbox 精确；搭建筑笔直；见 `pipeline/reports/PILOT-2026-10-22.md` §4.6 |
| **P2** ✅ | `pipeline/tools/lod/simplify-attr.js`：分件预算 + meshoptimizer 属性感知 + 结构锁 + `validate-lod.js` 门禁 | 屋面 **28,944 tris**（目标 20k 不可达）；边界 99.99%、bbox 精确、搭建筑可用；见 `PILOT-2026-10-22` §4.7 |
| **P3** ✅ | `pipeline/tools/lod/retopo-bake.py`（Blender 5.2 headless）：voxel remesh → decimate → UV → Cycles 烘 baseColor/normal → GLB | 屋面 **8,996 tris**；水密、bbox 精确、2K 贴图、搭建筑与 50k 接近；见 `PILOT-2026-10-22` §4.8 |
| **P4** | 把门禁接进 `pipeline/README` 第 5 段；报告模板加 LOD 结果 | 每次出 LOD 自动跑门禁 |

**当前批次结论**：`pilot-2026-10-22` 的屋面**主用 9k 轨 C 重拓扑版**（`yingshan-single-a-retopo-9k.glb`，8,996 tris + 2K 烘焙），村景/中景；`yingshan-single-a-lod0-29k-attr.glb`（28,944 tris，原 UV/贴图）留作中间档/回退；50k 高模保留作 hero / 特写 / 贴图源。檐柱轨 A 已重建（384 tris）；老槐 49k 先用高模。20k / `Permissive` / Quadriflow 失败候选在 `pipeline/out/_archive/pilot-2026-10-22/lod-failed/`。

---

## 6. 参考

- meshoptimizer：<https://github.com/zeux/meshoptimizer> · npm：<https://www.npmjs.com/package/meshoptimizer> · releases（`simplifyWithUpdate` / permissive）：<https://github.com/zeux/meshoptimizer/releases>
- gltfpack：meshoptimizer 仓库内 CLI；Cocos 对"可能丢 UV 排布"的警告：<https://docs.cocos.com/creator/3.7/manual/zh/asset/model/mesh.html>
- Blender Decimate：<https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/decimate.html> · Bake：<https://docs.blender.org/manual/en/latest/render/cycles/baking.html>
- bpy 4.5（Blender as a Python module）：<https://pypi.org/project/bpy/> · Blender 4.5 Manual：<https://docs.blender.org/manual/en/4.5/>
- MeshLab：<https://github.com/cnr-isti-vclab/meshlab> · PyMeshLab：<https://github.com/cnr-isti-vclab/pymeshlab>
- SeamAwareDecimater：<https://github.com/songrun/SeamAwareDecimater>
- UnityMeshSimplifier：<https://github.com/Whinarn/UnityMeshSimplifier>
- Instant Meshes：<https://github.com/wjakob/instant-meshes>
- 论文：<https://arxiv.org/html/2409.15458v2>
