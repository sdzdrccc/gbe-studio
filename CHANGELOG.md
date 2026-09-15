# 更新日志 —— GBE-Studio

> **版本真源** = [`VERSION`](VERSION)（单行纯文本，`MAJOR.MINOR.PATCH`）。
> 本文件是**变更内容的真源**；根 `package.json.version` 是它的镜像（由脚本同步）。
> **每次 `git push` 前必须升版本并在此追加条目** —— 见 [`AGENTS.md`](AGENTS.md) §2.7。
> 推送前自动校验：`node scripts/version.js check`（pre-push 钩子已接上）。

本仓遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)。0.x 预发布阶段的取值约定：

| 段位 | 何时 +1 |
|---|---|
| **MAJOR** | 契约破坏性变更：`core/contracts/` 不兼容、三张注册表结构重建、8 个语义动作改口径 |
| **MINOR** | 新增能力：接入平台 / 引擎 / MCP 实现、新增语义动作、新增拆分规则或建筑模板、新增子命令 |
| **PATCH** | 修错、文档、提示词调优、`capabilities.json` 能力声明修正、镜像同步 |

> 双库的版本号**各自独立**：契约变更通常两边各发一版，但不必同号。

---

## [未发布]

## [0.4.0] - 2026-09-15

### 新增

- **程序化构件生成器**（`build/procedural/`，零依赖、0 credit）：把 BUILDING-DECOMPOSITION §9.2 里标 **P** 的构件全部做出来 —— **18 件**（原方案表记 17，实为 18，已勘误）
  - `geom.js` 参数化几何内核：box / cylinder / dome / extrude（含耳切三角化）/ swept-beam（带起拱，两端底面精确落 y=0）；非索引三角形汤 + 逐三角法线
  - `gltf.js` glTF 2.0 binary 写出器与回读自检（accessor min/max、material 引用、4 字节对齐）
  - `render.js` 纯 JS 软件光栅化预览：512×512 白底 3/4 视角、**跟随相机的三点布光**、投影阴影、2× 超采样、手写 PNG
  - `material-colors.json` 占位配色真源（引用者一律带 `needs-material-review`）
  - `components.js` 18 件定义：台基 4 · 柱网 1 · 梁架 3 · 墙 2 · 屋顶 6 · 栏杆 1 · 装饰 1
  - `generate.js` 生成器：几何 → 逐件自检（插槽落定位网格 / 水平尺寸落造型网格 / 底面 y=0 / 面数预算 / 材质引用 / glb 回读三角数 / 预览 512）→ 打包含 `asset.json` + `source.json` + `preview.png` → 投递 `inbox/<id>@<version>/`（`--check` / `--only` / `--out` / `--no-preview` / `--ss`）
  - `verify.js` 出包复验：调 `gbe-assets` 的 `@gbe/schema` 真源校验器，不另起第二套语法校验
- **装配清单生成器**（`build/procedural/assemble.js`）：按「谁插谁」的配方**求解坐标**（`position = 宿主插槽世界坐标 − R·本件插槽局部坐标`），**不硬编码任何坐标**；插槽定义从**已入库的实体**读取（顺手验证 intake 落盘）；生成后跑 §19.5 首跑校验，通过才落盘
- 首份装配清单 `cn-ancient.assembly.wanan-wall-corner-a`：转角墙墩 + 两向直墙（3 段）+ 望柱 + 门钉，6 实例 / 4 种构件 / 5 处对接 / 324 面

### 变更

- `docs/BUILDING-DECOMPOSITION.md`：
  - 修正 §9.2 算术 —— 路线分布 **P 17→18 · A 25→24**（附逐行勘误）、预算估算 915 → **885 credit**、批 1 交付 37 → **38 件**
  - 新增「转角件为什么是墩而不是 L 形墙」的裁决说明（L 形翼厚 0.5 m 在契约下不可自洽）
  - 新增「批 1 程序化部分 · 实施进展」表，并注明**这一步证实的是「可装配」而不是「够用」**
  - §1.2(a) 成本表补**警示框**：按该表口径 25 栋时生成 credit 仍高于逐栋（2385 vs 1375），回本靠复用带来的精修 / LOD / 材质免重做——成本模型折算工时后待重算，不假装已算过
- README：结构树补 `build/procedural/` 全貌（8 个文件）；CONVENTIONS 版本引用 v1.2 → v1.3
- `docs/PLAN.md` 的 CONVENTIONS 版本引用同步至 v1.3

### 验收

- **18/18 通过出包门禁**：0 错误 · 1 软警告（`gable-board-a` 板厚 0.1 未落 0.25 造型网格——薄板天然如此，如实报告比骗零警告诚实）
- **同一配方重复执行统计一致**（批 1 验收点 / DoD §17.2）：两次独立生成 + 与已入库件**三方逐字节比对**，18 件的 glb 与 preview 全部一致；`recipe_hash` 18 件各不相同
- **装配清单门禁双跑**：studio 侧首跑 + assets 侧 `assembly-check` 复跑，均 0 错误 0 警告
- 构件级冒烟 37/37 · 装配级冒烟 27/27 未回归

## [0.3.1] - 2026-09-15

### 变更
- README 版本徽章改为从 git tag 动态读取（shields github/v/tag），消除硬编码版本号 —— 徽章自此无需随版本手工维护

## [0.3.0] - 2026-09-15

### 变更
- 新增 tag 子命令：在当前 HEAD 打附注 tag vX.Y.Z，说明自动取自 CHANGELOG 该版本正文；工作区不干净时直接报错，防止 tag 打错位置
- check 新增 tag 锚点检查：该版本的 tag 是否已打、是否指向正确的提交（提示项，不阻断）
- 补齐历史 tag：v0.1.0（初始骨架）、v0.2.0（版本机制），并推送远端
- README 与 AGENTS.md 写入发版固定四步：bump → commit → tag → push --follow-tags
- package.json 新增 version:sync / version:tag 快捷脚本

## [0.2.0] - 2026-09-15

### 新增
- **版本号与更新日志机制**：`VERSION`（真源）+ `CHANGELOG.md`（变更真源）+ `scripts/version.js`（`show` / `bump` / `check` / `log`），并同步 `package.json.version` 镜像
- `scripts/hooks/pre-push` + `scripts/install-hooks.js`：推送前强制校验版本号已更新（`git config core.hooksPath scripts/hooks` 启用）
- `package.json` 新增 `version:show` / `version:bump` / `version:check` 快捷脚本
- `README.md` 写入**完整项目结构树**（逐目录逐文件注释）

### 说明
- 校验项含「自上个版本以来是否有未记录的变更」—— 靠 git 基线机械判定，不靠自觉
- `scripts/version.js` 与 `gbe-assets/scripts/version.js` **逐字节相同**，改动需双仓同步提交

## [0.1.0] - 2026-09-15

### 新增
- 仓库初始化：五层流水线（生成 / 拆分 / 精修 / 集成 / 装配）+ 横切三项（账本 / 门禁 / 桥治理）
- **三张真源注册表** `core/registry/`：`providers.json` / `engines.json` / `mcp.json` —— 一切"启用什么"由此决定
- `core/policy/`：`router.js` 五步决策（可用性 → 形态 → 优先表 → 成本闸门 → 降级链）、`fallback.json`、`budget.json`
- **8 个语义动作**稳定接口：`probe / importAsset / instantiate / applyCollision / remapMaterials / registerScene / verify / undo`
- `providers/`：tripo / meshy / hunyuan3d（含三通道 `channel_matrix`）/ fal 能力声明 + `_template/` 新增平台模板；rodin 标记 `enabled:false`（ADR-0002）
- `engines/`：`base.js` 适配器骨架 + godot / unreal 语义映射（未映射项显式声明，禁止猜测工具名）；unity 留位（ADR-0004）
- `core/contracts/`：7 个内部契约 —— GenerationJob / GenerationArtifact / DecompositionPlan / RefineRecipe / EngineImportPlan / LedgerEntry / （Assembly 真源在 assets）
- `decompose/`：插槽推断规则（按构件类型 10 条）+ 计划 / 产出目录
- `build/templates/`：参数化建筑模板（主殿 7 开间 / 配殿 5 开间 = 同模板两组参数）
- `bridges/sync-ports.js`：由 assets 侧 `ports.json` 生成只读端口视图，支持 `--check` / `--probe`
- `docs/BUILDING-DECOMPOSITION.md`：场景建筑拆分细化方案（L0–L3 分级 / 两级模数 / 粒度五判据 / 两条产线 / 45 类构件清单 / 四批排期 / 回退条件）
- `docs/PLAN.md`：生产端完整方案
- 空目录占位：`cmd/*`（8 个子命令）、`refine/`、`qa/`、`pipeline/`、`decompose/plans` `decompose/out`、`bridges/profiles` `bridges/router-server`
