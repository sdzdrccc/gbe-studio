# 仓库目录与文档规范

> 2026-10-22 立。**本文件是 `AGENTS.md` §6 的展开**；两者冲突时以 `AGENTS.md` 为准。
> 目标：任何人（或 AI）新增文件时，不用猜"放哪、叫什么、进不进 Git"。

---

## 0. 三条判据

1. **谁产生，谁身边**：契约归 `core/` / `gbe-assets/catalog/`；平台适配归 `providers/`；批次产物归 `pipeline/`。
2. **进不进 Git 看"是否需要可复现"**，不看"重不重要"：提示词、脚本、报告进；15 MB 原图、64 MB 产物不进。
3. **根目录只放仓库级文件**：README / AGENTS / CHANGELOG / VERSION / LICENSE / package.json / 配置样板 / 点文件 / 域目录。**根目录不是下载文件夹。**

---

## 1. 根目录白名单

允许：

```
README.md  AGENTS.md  CHANGELOG.md  VERSION  LICENSE  package.json
gbe.config.example.json  .gitattributes  .gitignore  .github/
core/  providers/  engines/  decompose/  refine/  build/  cmd/
bridges/  qa/  scripts/  docs/  pipeline/
```

禁止：

- `vibe_images/`、`screenshots/`、`新建文件夹/` 这类根级素材堆；
- 根级临时 `.glb` / `.png` / `.blend` / `.zip`；
- 个人笔记、Obsidian 工作区状态、系统缩略图缓存。

> 已有内容不许"直接删"：按 §6 先归档，再移除入口。

---

## 2. 域目录职责

| 目录 | 职责 | 真源 / 产物 | 备注 |
|---|---|---|---|
| `core/registry/` | 平台 / 引擎 / MCP 启用与优先级 | ✅ 真源 | 禁止在代码里写死平台名 |
| `core/policy/` | 路由、降级链、成本闸门 | ✅ 真源 | 改策略改 JSON，不改流程分支 |
| `core/contracts/` | 本仓内部 JSON Schema | ✅ 真源 | 跨仓契约在 `gbe-assets/catalog/schema/` |
| `providers/` | 生成平台适配器（3 动词） | 代码 | 新平台先加 `_template` 副本 + capabilities |
| `decompose/` | 构件拆分规则 / 计划 / 产物 | 规则是源，`out/` 是产物 | `out/` 不入 Git |
| `refine/` | 声明式精修配方 / 应急链 | 配方是源 | 当前留位；有内容后再删 `.gitkeep` |
| `build/` | 程序化构件、收敛分析、装配 | 代码 + 模板 | `build/out/` 是产物，不入 Git |
| `engines/` | 引擎语义映射（8 动作） | 映射是源 | 不写具体 MCP 工具名到上层 |
| `bridges/` | 端口视图、MCP 桥、Profile | `registry.json` 是产物 | 禁止手改 `registry.json` |
| `cmd/` | CLI 薄壳（每目录一命令） | 代码 | 每个命令只做参数解析与调用 |
| `qa/` | QA Gate 留位 | — | 门禁由 `@gbe/schema` 承担 |
| `scripts/` | 仓库自身工具（版本 / 钩子） | 代码 | `version.js` 两仓各自维护（共享命令语义一致 · ADR-0009） |
| `docs/` | 长期方案与规范 | ✅ 文档 | 不放批次报告 |
| `pipeline/` | 批次产线：提示词 → 图 → GLB → LOD | 见 §3 | 唯一允许放批次产物的域 |
| `.github/` | CI 工作流 | ✅ | push / PR 三闸门 |

---

## 3. `pipeline/` 固定五段

```
pipeline/
├── README.md                产线说明（本目录的门牌）
├── prompts/                 人写的提示词/设定稿          ✅ 入 Git
│   └── cn-ancient/
│       ├── README.md
│       └── pilot-01-yingshan-single-a.md
├── source-images/           图像模型原图（横向三视图）    ❌ 不入 Git（6 张，约 15 MB）
│   └── pilot-2026-10-22/
├── tools/                   批次处理脚本                 ✅ 入 Git
│   ├── normalize-hunyuan-glb.py
│   ├── preview-normalized-glb.js
│   └── lod/                 轨 B 减面 + 轨 C 重拓扑 + 门禁
│       ├── simplify-attr.js
│       ├── retopo-bake.py
│       ├── validate-lod.js
│       ├── inspect-glb.js
│       └── analyze-mesh.js
├── out/                     切图/归一化/LOD/预览         ❌ 不入 Git
│   └── pilot-2026-10-22/
│       ├── refs/            喂混元的单视角图
│       ├── normalized/      归一化 GLB（高模源）
│       ├── lod/             LOD0 GLB
│       └── preview/         灰模预览
└── reports/                 批次报告                     ✅ 入 Git
    └── PILOT-2026-10-22.md
```

> 没有可用 LOD 的批次可以没有 `lod/`；坏件进 `out/_archive/<batch>/lod-failed/`，不要交坏 LOD。
> `pipeline/tools/lod/` 的依赖（`meshoptimizer` + `@gltf-transform/*`）声明在**仓库根** `devDependencies`。
> **`node_modules` 不入 Git，也不放项目内**：本机统一放在仓库外的共享父目录（Node 会从项目目录逐级向上查找，能命中）；**不要在仓库根跑 `npm install`**，确需重装时在共享目录维护。
> 轨 C 的 `retopo-bake.py` 用本机 **Blender 5.2** headless（也可 bpy 4.5 venv；脚本只依赖 numpy，Blender 自带）；路径用 `GBE_BLENDER` 指向，Blender/venv 不入 Git。示例见 `pipeline/README.md`。

**为什么 `source-images/` 不入 Git**：本仓未启用 Git LFS，15 MB 原图进历史会永久膨胀。报告里记录文件名、尺寸、SHA256；真要复现时从图像模型重出。启用 LFS 后再改成入库，并同步本节。

---

## 4. 命名

| 对象 | 规则 | 例 |
|---|---|---|
| 文档 | 全大写-连字符 `.md` | `REPO-LAYOUT.md` · `PILOT-2026-10-22.md` |
| 脚本 | 小写-kebab | `normalize-hunyuan-glb.py` · `preview-normalized-glb.js` |
| 批次目录 | `pilot-YYYY-MM-DD` | `pilot-2026-10-22` |
| 资产 id | `<kit>.<category-leaf>.<name>` | `cn-ancient.roof.yingshan-single-a` |
| 资产目录 | **严格等于 id 第三段** | `yingshan-single-a/`（不加 `roof-`） |
| 喂图 | `<asset>-<view>.png` | `yingshan-single-a-front.png` |
| 归一化 | `<asset>-normalized.glb` | `yingshan-single-a-normalized.glb` |
| LOD | `<asset>-lod<N>-<tris>k.glb` | `yingshan-single-a-lod0-20k.glb` |
| 预览 | `<asset>-<stage>-<view>.png` | `yingshan-single-a-lod0-20k-three-quarter.png` |

**硬约束**：文件名与目录名一律 ASCII；空格、中文、驼峰都不行。要写中文说明写进正文。

---

## 5. 入 Git / 不入 Git

| 入 Git | 不入 Git |
|---|---|
| `prompts/` · `tools/` · `reports/` | `pipeline/out/` |
| `docs/` · `core/` · `providers/` · `engines/` · `build/` 代码 | `pipeline/source-images/`（暂无 LFS） |
| `scripts/` · `.github/` · 配置样板 | `build/out/` · `decompose/out/` · `decompose/quarantine/` |
| `README` · `AGENTS` · `CHANGELOG` · `VERSION` | `runs/` · `jobs/` · `raw/` · `tmp/` · 日志 |
| — | 凭证、本机配置、`.obsidian/workspace.json`、`node_modules/`（放仓库外共享父目录） |

> 判断口诀：**"下次 clone 后，没有它还能不能复跑？"** 能 ⇒ 不进；不能 ⇒ 进。

---

## 6. 生命周期与门禁

```
prompt → source-images → refs → normalized → lod → report → gbe-assets/inbox
```

| 阶段 | 门禁 |
|---|---|
| prompt | 一资产一份；尺寸/形制/材质/禁止项写全；三视图同缩放 |
| source-images | 只收原图；不改名、不切图 |
| refs | 同 px/m、同画布；正/俯同宽；正交透视校正；只留构件本体 |
| normalized | 烘焙节点旋转；精确合同尺寸；底中心；`+Y up`；PBR 内嵌；TANGENT |
| lod | `weld` → `simplify`；**直减毁形时宁可不交 LOD**，用高模并写明；不要交坏 LOD |
| report | 源/结果 tris、bbox、贴图、材质、已知不足、复跑命令 |
| inbox | 走 `gbe-assets` 的 intake；本仓不直接写 `kits/` |

> **构件 vs 整栋**：构件级批次（pilot-01 / 02）才走 `gbe-assets/inbox` → intake；整栋 / 整件批次（pilot-05 起）**不拆构件、不入 `kits/`**，归一后的 GLB 交场景侧（模型库 / 下游），本仓只留提示词、报告与处理脚本。

---

## 7. 新文件落点决策树

1. 是平台/引擎/MCP 的启用或优先级？→ `core/registry/`（改 JSON，不改代码）。
2. 是新平台适配？→ `providers/<id>/` + `_template` 骨架。
3. 是新引擎映射？→ `engines/<id>/semantic_map.json`。
4. 是本仓内部契约？→ `core/contracts/`；跨仓契约 → `gbe-assets/catalog/schema/`。
5. 是程序化构件？→ `build/procedural/components.js`。
6. 是提示词、原图、切图、GLB、LOD、批次报告？→ `pipeline/` 对应五段。
7. 是长期方案/规范？→ `docs/`。
8. 是临时脚本/试验？→ `pipeline/out/_tmp/`（ignored）；稳定后移进 `tools/`。
9. 是仓库自身工具？→ `scripts/`；是 CLI 子命令？→ `cmd/<name>/`。

---

## 8. 清理与迁移

1. **根目录不堆东西**：新素材先想 `pipeline/` 哪一段，再落盘。
2. **移动即改引用**：同一笔提交里 grep 旧名/旧路径（`AGENTS.md` §7）；四仓全查。
3. **归档不删**：批次作废 → `pipeline/out/_archive/<batch>/`；资产作废 → `gbe-assets/_archive/`。
4. **不留空壳**：目录有内容后删 `.gitkeep`；只有契约预留位可留 `.gitkeep`。
5. **编辑器状态不进 Git**：`.obsidian/workspace.json` 是每次打开都变的缓存，忽略并 untrack；共享的 vault 配置另议。
6. **提交前跑**：`git status` 看根目录、`git check-ignore` 看产物、`node scripts/version.js check` 看版本/日志。

---

## 9. 例外

- `docs/PLAN.md`、`docs/BUILDING-DECOMPOSITION.md` 是长期方案，**不按批次命名**。
- `gbe-assets/docs/` 的 `DECISIONS.md` / `CONVENTIONS.md` 是跨仓真源，本仓只读。
- `pipeline/README.md` 与 `pipeline/reports/` 是**批次门牌与报告**，不是长期方案，别搬进 `docs/`。
- **仓外模型库**：AI 生成或下载的整模、清点报告与预览放在本仓之外（本机在仓库外的模型库目录）；本仓只保留提示词、批次报告与处理脚本，**不把整模拷进仓库**。
