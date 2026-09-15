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

<!-- 每次 bump 时，这段内容会被带进新版本条目；留空则使用命令行的摘要。 -->

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
