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

## [0.5.1] - 2026-09-23

### 新增

- **`build/convergence/` 形制收敛的纸面分析器**（`forms.js` 理想构件集 + `report.js` 分析），实现 `BUILDING-DECOMPOSITION.md` §10.5(c)：**在造任何一件构件之前**先算出「每新增一个形制还需要多少件全新构件」。库基线从 `kits/` 实读、不猜数；输出收敛曲线 + 逐形制判定 + 新增件明细，报告落 `build/out/`。
- `BUILDING-DECOMPOSITION.md` §10.5 新增「形制收敛的判定协议」：**三档统计**（全新型 / 同型新尺寸 / 纯引用，判定只看①）+ **两级门槛**（批 2 早检同形制 · 批 3 终检跨形制）。

### 修正（同一判据原有 5 处口径互相打架，一次性统一）

- **§1.2 / §9.3 / §10.3 / §11 的「全新构件数」统一口径** —— 原为 `0` / `0–1` / `≤3` / `≥4` 四个数字混写，且「一栋」未交代是同形制还是跨形制。现以 §10.5 为唯一口径，四处改为引用它。
- **§1.2 「验证点设在批 2 结束时：若 8 类形制建完后…」单句自相矛盾**（批 2 只建 2 栋配殿，「8 类形制建完」是批 3）→ 拆为两级门槛，并明确**判失败以终检为准**。
- **§10.3 「同形制第 2 栋的新增几何为 0」与 §9.3「≤3 件全新」冲突**（有全新件就不可能几何为 0）→ 统一为「全新型构件 = 0」。
- **§9.2 路线分布算术错**：逐行复算 **A 24 → 27**、**B 3 → 0**（18 + 27 = 45 ✓）。`B = 3` 是**量纲错误** —— 把 §9.1 的「3 类 hero 形制」误记成了「3 件构件」；B 是方法不是构件条目。
- **§9.2 补勘误**：roof 段只覆盖歇山系，**漏掉硬山 / 悬山 / 攒尖 / 庑殿 / 盝顶 5 个样式件**，而 §9.1 明确需要它们（民居硬山 ×8、商铺悬山 ×5、亭攒尖 ×3、城门楼庑殿、牌坊盝顶）。这 5 件正对应 §9.3 批 1 的「20 件裸屋顶（五样式）」—— **两处口径未对齐**。
- **§4 / §10.3 复用比定义方向写反**：原文「独特构件数 ÷ 总实例数」，但紧随的例子（独特 45 / 总 300 → 6.7）按原式应为 0.15 → 改为「**总实例数 ÷ 独特构件数**」。
- **§1.2 成本表连带修正**：建库 `885 → 975 credit`（27 × 30 + 3 × 55）、25 栋累计 `2385 → 2475`；「程序化压掉八成」无据 → 改为实算的 **540 credit**。

### 待裁决（已写入文档，**未生效**）

- **hero 形制的判定阈值**：hero 件本就"只出现 1 次"（§4 判据 1 明确不拆），用 `≤3` 卡它等于要求 hero 建筑不许有独特设计。纸面分析暂用 **≤6**，**未经确认**；按原判据则主殿（4 件：金柱 / 歇山下檐 / 歇山上层 / 筒瓦）判失败。裁决前 hero 判定结论不生效。

### 纸面收敛分析结果（估算，非实测）

收敛曲线 **18 → 3 → 1 → 0 → 3 → 2 → 4 → 1**，第 2 栋起全部 ≤ 4，7/7 通过门槛 → **纸面收敛成立**。第 1 栋配殿的 **18 件是不可摊薄的入场费**。
> ⚠️ 该结果有**自证偏差**（输入取自 §9.2 自己的规划表）—— 只证明「规划内部没打架」，不证明「拆分可行」。已连同边界声明写入 §10.5(c)。

## [0.5.0] - 2026-09-15

### 新增

- **`core/registry/mcp.json` 接入官方实现**：新增 `unreal-official-mcp`（`source: "first-party"`，UE 5.8+，HTTP 8000，`maturity: "experimental"`）—— **不预设首选**，`preselect: false` 不变。
- **注册表新增三个维度**（ADR-0007）：`source` / `engine_version_range` / `maturity`，并回填全部既有实现。`selection_policy` 增 `filter_by_engine_version` 与 `preference_rules`。
- 官方实现的 `semantic_map` 显式置 `null` + `semantic_map_blocked_by`：官方插件暴露的是**引擎操作工具**（actor / 蓝图 / 材质 / Niagara / Sequencer），**不含 8 个语义动作**，需先自写 GBE Toolset（继承 `UToolsetDefinition`）。**阻塞是「工具还不存在」，不是「还没查」** —— 故不写空壳映射表。
- `semantic_map` 新增 `supports_basis: "design-complete"` 语义：设计上齐全，但落地前**实际可用为 0**，适配器必须如实报告。
- `core/registry/engines.json`：`unreal.ports` 增 `unreal-mcp-official` + `mcp_note`。

### 修复

- **`bridges/sync-ports.js`：`--probe` 从未产出过任何输出。** 根因是 `process.exit(main(process.argv.slice(2)))` —— `main()` 是同步函数、返回 0，而 `process.exit` 在异步探测完成前就把进程杀了（探测头一行打印后即无输出）。改为 `main` 支持 async + `Promise.resolve(...).then(code => process.exit(code))`。**这个 bug 从建立该脚本起就存在。**
- **`bridges/sync-ports.js`：`reserved` 端口被误算进「已启用」。** 原判断为 `status !== 'deferred'` 即算启用，导致新登记的预留端口 8000 进了 `studio_ports` 并被计入 `summary.active`。现按三态分类（省略 / `reserved` / `deferred`），新增 `reserved_ports` 分组与 `summary.reserved`；`by_engine.unreal` 含 active + reserved（切实现时它们都必须空闲）；`--probe` 也探测预留端口并提示「启用前需解决」。

### 文档

- `docs/PLAN.md`：§7.2 补 ADR-0007 说明、官方实现条目与新增规则 6~8；§7.3 端口表增 8000 行；同步 CONVENTIONS 版本引用至 v1.4。
- `README.md`：端口表增官方 MCP 预留行；决策台账范围更新为 ADR-0001 ~ 0007。

## [0.4.1] - 2026-09-15

### 新增

- **构件总览单页**（`build/procedural/catalog.js`）：从**已入库实体**重建一页自包含 HTML（预览图 base64 内嵌，184 KB），按 `components/*` 分组列出 18 件的预览、尺寸、三角数、材质槽与**全部插槽（名 / 类型 / 方向 / 坐标）**。程序化构件的验收不能只看控制台里的三角数与插槽数——「长成什么样」是美术判断，只能看图；一页看全比翻 18 个目录快

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
