# GBE-Studio

**GBE = Generative Blender-to-Engine**

[![version](https://img.shields.io/github/v/tag/sdzdrccc/gbe-studio?label=version&color=blue)](CHANGELOG.md) ![license](https://img.shields.io/badge/license-MIT-green) ![engine](https://img.shields.io/badge/engines-Godot%20%7C%20Unreal-informational)

> 生产端：把「多平台 AI 生成 → **构件拆分** → Blender 精修 → 多引擎落地」做成一条可复用、可复现、可控成本的资产流水线。

---

## 五层流水线

```
① 生成层      tripo / meshy / hunyuan3d(三通道) / fal        ← rodin 不接入，Unity 延后
② 拆分层 ★    构件直生（路线 A） / 整栋拆分（路线 B）
③ 精修层      Blender：声明式配方 + 交互逃生舱 + 重拓扑
④ 集成层      Godot / Unreal（Unity deferred）
⑤ 装配层 ★    L0 建筑 = 构件 + 插槽绑定，写装配清单
```

横切三项（★ **2026-10-19 按实现现状标注**，别把"留位"读成"已有"）：
**CostLedger 账本**（`core/contracts/ledger-entry.schema.json` 已定 · **实现未做**）·
**QA Gate 门禁**（★ **由共享 `@gbe/schema` 的出包门禁承担**；本仓 `qa/` **仅留位**，无实现）·
**MCP 桥治理**（✅ 已落：`bridges/` ＋ `core/registry/mcp.json` ＋ `engines/base.js`）。

---

## 三条设计主线

| # | 主线 | 落地机制 |
|---|---|---|
| 1 | **生成与落地可插拔** | Provider 适配器（3 动词：submit / poll / fetch）+ Engine 适配器（8 个语义动作） |
| 2 | **建模单位是"构件"而非"建筑"** | L0–L3 分层 + 模数网格 + 插槽拼装（ADR-0006） |
| 3 | **不把自己焊死在任何一个第三方上** | 三张注册表：平台 / 引擎 / **MCP 实现**（ADR-0005，实现可运行时切换） |

---

## 完整项目结构

> 这是速查图；新增文件先查 [`docs/REPO-LAYOUT.md`](docs/REPO-LAYOUT.md) 的落点表与决策树。

```
gbe-studio/
│
├── README.md                    本文件
├── CHANGELOG.md             ★   更新日志 —— 变更内容真源
├── VERSION                  ★   版本号真源（单行 MAJOR.MINOR.PATCH）
├── AGENTS.md                    AI 助手在本仓的工作纪律（硬约束）
├── LICENSE                      许可：MIT
├── package.json                 包元数据（private）+ 全部快捷脚本；version 是 VERSION 的镜像
├── gbe.config.example.json      本机配置样板（真实 gbe.config.json 不入库）
├── .gitattributes               统一 LF、二进制标记
├── .gitignore                   排除凭证 / 本机配置 / runs / raw
├── .github/
│   └── workflows/
│       └── ci.yml               CI：push / PR 触发，node 20·22 矩阵跑三闸门（版本校验 · 端口视图校验 · 路由冒烟）
│
├── core/                    核心：策略、契约、注册表
│   ├── registry/            ★   三张真源注册表 —— 一切「启用什么」由此决定，禁止写死在代码
│   │   ├── providers.json       生成平台开关与优先级（tripo / meshy / hunyuan3d / fal；rodin: false）
│   │   ├── engines.json         引擎开关 + 8 个语义动作定义（unity: deferred）
│   │   └── mcp.json             引擎 × MCP 实现注册表（多实现候选，active 运行时选定）
│   ├── policy/
│   │   ├── router.js        ★   平台选择策略：五步决策（可用性 → 形态 → 优先表 → 成本闸门 → 降级链）
│   │   ├── fallback.json        降级链（meshy → fal → hunyuan3d）
│   │   ├── budget.json          成本闸门（单件 / 单批上限、余额下限）
│   │   └── test/router.smoke.js 路由冒烟测试（★ 条数以输出为准，勿抄）
│   ├── contracts/           ★   内部契约（JSON Schema）
│   │   ├── generation-job.schema.json        一次生成作业的输入
│   │   ├── generation-artifact.schema.json   平台产出的原始件
│   │   ├── decomposition-plan.schema.json    构件拆分计划（L0 → 构件清单）
│   │   ├── refine-recipe.schema.json         声明式精修配方（可复现）
│   │   ├── engine-import-plan.schema.json    导入某引擎的计划（含 _gbe.json 包装）
│   │   └── ledger-entry.schema.json          账本条目（成本 / 余额 / provider_used）
│   │       · Assembly 契约的真源在 `gbe-assets/catalog/schema/assembly.v2.schema.json`
│   └── schema-ref.js            解析 `@gbe/schema`（开发期 file: / 环境变量 / submodule 三种候选，**永不拷贝副本**）
│
├── providers/               ① 生成层 · 平台适配器（每个平台一个目录）
│   ├── _template/               新增平台的模板
│   │   ├── capabilities.json        能力声明骨架（modes / topology / limits / supports / cost）
│   │   └── adapter.js               三动词骨架：submit / poll / fetch（含 redact 脱敏）
│   ├── tripo/capabilities.json      低模 + 高精度，CLI/OAuth，默认主力
│   ├── meshy/capabilities.json      写实件、动画库、auto-rig
│   ├── hunyuan3d/capabilities.json  三通道（tokenhub / tencentcloud / web）能力矩阵
│   └── fal/capabilities.json        聚合兜底（单 key 多家）
│
├── decompose/               ② 拆分层 ★
│   ├── rules/socket-inference.json  插槽推断规则（按构件类型 10 条）
│   ├── plans/                       拆分计划落盘（builder 产出）
│   └── out/                         拆分产物（glb 构件 + 隔离件）
│
├── refine/                  ③ 精修层（Blender）（留位）
│   ├── recipes/                     声明式精修配方（留位）
│   └── fallback/                    应急链（重拓扑等无法自动复现时的人工/半自动路径）（留位）
│
├── build/                   ⑤ 装配层 ★
│   ├── procedural/          ★   程序化构件生成（零依赖，0 credit）
│   │   ├── geom.js              参数化几何内核（box / cylinder / dome / extrude / swept-beam，非索引三角汤）
│   │   ├── gltf.js              glTF 2.0 binary 写出 + 回读自检（accessor / material / 对齐）
│   │   ├── render.js            纯 JS 软件光栅化预览（512×512 白底 3/4 视角 · 三点布光 · 投影阴影 · 手写 PNG）
│   │   ├── material-colors.json 占位配色真源（引用本表的资产一律带 needs-material-review）
│   │   ├── components.js        ★ 40 件程序化资产定义（24 建筑构件 ＋ 16 村落皮肤/道具）
│   │   ├── generate.js          生成器：几何 → 逐件自检 → 打包含盘 → 投递 inbox（--check / --only / --ss）
│   │   ├── assemble.js          装配清单生成：按「谁插谁」求解坐标（不硬编码）→ §19.5 首跑 → 落 `assemblies/`
│   │   ├── verify.js            出包复验（调 gbe-assets 的 @gbe/schema 真源校验器，门禁双跑的第二次）
│   │   └── catalog.js           构件总览单页（自包含 HTML，预览图内嵌）—— 从已入库实体重建，派生物
│   ├── convergence/         ★   形制收敛的纸面分析（BUILDING-DECOMPOSITION §10.5(c)）
│   │   ├── forms.js             8 类形制的理想构件集（推定模型，随 §9.1 / §9.2 更新）
│   │   └── report.js            在造构件之前算收敛曲线：库基线实读 kits/，输出逐形制全新型判定
│   └── templates/               参数化建筑模板
│       └── tpl-hall-xieshan-double.json   歇山双檐殿堂（主殿 7 开间 / 配殿 5 开间 = 同模板两组参数）
│
├── engines/                 ④ 集成层 · 引擎适配器
│   ├── base.js              ★   适配器骨架：只依赖 8 个语义动作（未映射 / 不支持时明确报错）
│   ├── godot/semantic_map.json      语义动作 → 具体 MCP 工具名（未映射项显式声明，禁止猜）
│   ├── unreal/semantic_map.json     同上
│   └── unity/                       留位（ADR-0004：当前不排期）
│
├── bridges/                 MCP 桥治理
│   ├── sync-ports.js        ★   从 `gbe-assets/catalog/ports.json` 生成只读端口视图（`--check` / `--probe`）
│   ├── registry.json            **只读视图**，由 sync-ports 生成 —— 禁止手改
│   ├── profiles/                引擎 Profile（每个引擎暴露哪些工具）（留位）
│   └── router-server/           Bridge Router 聚合服务（终态：≤24 个语义工具）（留位）
│
├── cmd/                     ⑤ 子命令入口（每个目录一个命令，薄壳）
│   ├── gbe-set/                     环境与凭证设置（留位）
│   ├── gbe-gen/                     发起生成（留位）
│   ├── gbe-decompose/               构件拆分（留位）
│   ├── gbe-refine/                  Blender 精修（留位）
│   ├── gbe-build/                   装配清单生成与校验（留位）
│   ├── gbe-ship/                    打包投递到 gbe-assets/inbox（留位）
│   ├── gbe-engine/                  引擎落地（留位）
│   └── gbe-cost/                    成本账本查询（留位）
│
├── pipeline/                 ★   批次产线（提示词 → 图 → GLB → LOD）
│   ├── prompts/                 提示词与三视图设定稿（入 Git）
│   ├── source-images/           图像模型原图（不入 Git）
│   ├── tools/                   归一化 / 预览脚本（入 Git）
│   ├── out/                     切图 / GLB / LOD / 预览（不入 Git）
│   └── reports/                 批次报告（入 Git）
├── qa/                          QA Gate 门禁（留位）
├── scripts/                 ★   仓库自身工具
│   ├── version.js               版本工具：show / log / bump / check / sync
│   ├── install-hooks.js         启用 Git 钩子（core.hooksPath）
│   └── hooks/
│       └── pre-push             推送前强制校验版本号与更新日志
│
└── docs/
    ├── PLAN.md                  生产端完整方案
    ├── BUILDING-DECOMPOSITION.md ★ 场景建筑拆分细化方案
    └── REPO-LAYOUT.md           ★ 目录与文档规范（本结构图的判据）
```

> **图例**：★ = 真源或关键文件；`（只读视图）` = 由真源生成、禁止手改；`（留位）` = 目录已建、实现未做。

---

## 版本与更新日志

**每次推送都必须带版本号与新日志条目。** 这条纪律由工具链保障，不靠自觉。

| 角色 | 文件 |
|---|---|
| 版本号**真源** | [`VERSION`](VERSION)（单行 `MAJOR.MINOR.PATCH`） |
| 变更内容**真源** | [`CHANGELOG.md`](CHANGELOG.md) |
| 版本**镜像** | `package.json` 的 `version`（由脚本同步，不许手改） |
| 版本**git 锚点** | 附注 tag `vX.Y.Z`（说明取自 CHANGELOG 该版本正文） |

```bash
node scripts/version.js show                  # 当前版本
node scripts/version.js log 5                 # 最近 5 个版本条目
node scripts/version.js bump patch "修了 X" "调了 Y"   # 升版本 + 写日志 + 同步镜像
node scripts/version.js bump minor --dry-run "只预览不落盘"
node scripts/version.js check                 # ★ 一致性校验（推送前必过）
node scripts/version.js sync                  # 只对齐镜像，不动版本、不写日志
node scripts/version.js tag                   # 提交后打附注 tag vX.Y.Z
```

等价 npm 脚本：`npm run version:show` / `version:log` / `version:bump` / `version:check` / `version:tag`

**发一版的固定节奏**（四步，别调换）：

```bash
node scripts/version.js bump minor "这次加了什么"   # 1. 升版本 + 写日志
git add -A && git commit -m "chore(release): v0.3.0"  # 2. 提交
node scripts/version.js tag                          # 3. 打 tag（必须在提交后）
git push --follow-tags                               # 4. 推提交 + tag
```

> 第 3 步**必须在提交之后** —— 工作区不干净时 `tag` 会直接报错拦下，避免 tag 打在旧提交上。
> `git push` 单独用不会带 tag，要用 `--follow-tags`。

**先启用钩子**（一次即可）：

```bash
npm run hooks:install             # → git config core.hooksPath scripts/hooks
```

之后每次 `git push` 都会自动先跑 `check`，**没升版本就推不上去**：

- `VERSION` 是否合法语义化版本
- `CHANGELOG.md` 最新条目是否 == `VERSION`
- `package.json` 版本镜像是否一致
- **自上个版本以来是否存在「没被记录的变更」** —— 用 git 基线机械判定，改了多少文件就管多少个
- 该版本的 tag `vX.Y.Z` 是否已打、是否指向正确的提交（提示项，不阻断）

确知不需升版本时（应写明理由）：`GBE_SKIP_VERSION_CHECK=1 git push`

> `scripts/version.js` 与 `gbe-assets/scripts/version.js` **不要求逐字节相同**（**ADR-0009**）：两仓版本各自独立，只保共享子命令的语义一致。

---

## 快速开始

```bash
node core/policy/test/router.smoke.js    # 路由策略冒烟测试（★ 条数以输出为准）
node core/policy/router.js route '{"tier":"component","mode":"text"}'
node core/policy/router.js engine unity  # → 明确报错"引擎未启用"（ADR-0004）

node bridges/sync-ports.js               # 从端口真源生成只读视图
node bridges/sync-ports.js --check       # CI：校验视图未过期
node bridges/sync-ports.js --probe       # 探测端口占用

node engines/base.js list                # 看各引擎的 MCP 实现候选
node engines/base.js validate unreal     # 语义映射完成度
node engines/base.js probe godot         # 端口连通性
```

---

## 端口（本仓只占这几个）

| 用途 | 端口 |
|---|---|
| Blender MCP | 9877 |
| Godot 编辑器桥 | 9876（写死不可改） |
| Unreal Python Remote Exec / Remote Control | 6776 (UDP) / 30010 |
| Unreal 备选实现 | 8091 / 55557（仅选中该实现时占用） |
| **Unreal 官方 MCP（预留）** | **8000**（UE 5.8+ 内置，**已登记未启用**，ADR-0007） |
| ~~Unity MCP~~ | 8090（**延后，当前不占用**；★ 8080 自 2026-10-18 起属 `qiuyuan-game-ws`） |

> **端口真源不在这里** —— 在 `gbe-assets/catalog/ports.json`。本仓 `bridges/registry.json` 是从它生成的**只读视图**。改端口请改真源，再跑 `node bridges/sync-ports.js`。

---

## 文档

| 文档 | 作用 |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | 生产端完整方案 |
| [`docs/BUILDING-DECOMPOSITION.md`](docs/BUILDING-DECOMPOSITION.md) | ★ 场景建筑拆分细化方案（分层 / 模数 / 两条产线 / 粒度判据 / 万安城排期） |
| [`docs/REPO-LAYOUT.md`](docs/REPO-LAYOUT.md) | ★ 目录与文档规范（根目录白名单 / 域目录 / pipeline 五段 / 命名 / 入 Git 判据） |
| [`docs/LOD-PIPELINE.md`](docs/LOD-PIPELINE.md) | ★ LOD 与简化器设计（三轨：构件重建 / 带锁减面 / 重拓扑烘焙；门禁判据） |
| [`pipeline/README.md`](pipeline/README.md) | ★ 批次产线：prompts → source-images → refs → normalized → lod → report |
| [`CHANGELOG.md`](CHANGELOG.md) | 更新日志 |
| [`AGENTS.md`](AGENTS.md) | AI 助手在本仓的工作纪律 |
| `../gbe-assets/docs/DECISIONS.md` | ★ 决策台账（ADR-0001 ~ 0007） |
| `../gbe-assets/docs/CONVENTIONS.md` | ★ 双库共享约定 v1.5 |

---

## 许可

MIT —— 见 `LICENSE`。
