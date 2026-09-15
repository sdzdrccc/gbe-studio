# GBE-Studio

**GBE = Generative Blender-to-Engine**

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

横切三项：**CostLedger 账本** · **QA Gate 门禁** · **MCP 桥治理（实现可切换）**。

---

## 三条设计主线

| # | 主线 | 落地机制 |
|---|---|---|
| 1 | **生成与落地可插拔** | Provider 适配器（3 动词：submit / poll / fetch）+ Engine 适配器（8 个语义动作） |
| 2 | **建模单位是"构件"而非"建筑"** | L0–L3 分层 + 模数网格 + 插槽拼装（ADR-0006） |
| 3 | **不把自己焊死在任何一个第三方上** | 三张注册表：平台 / 引擎 / **MCP 实现**（ADR-0005，实现可运行时切换） |

---

## 快速开始

```bash
node core/policy/test/router.smoke.js    # 路由策略冒烟测试（25 项）
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

## 仓库结构

| 路径 | 说明 |
|---|---|
| `core/registry/` | ★ **三张注册表**：`providers.json` / `engines.json` / `mcp.json` —— 一切"启用什么"的真源 |
| `core/policy/` | `router.js`（平台选择策略）· `fallback.json`（降级链）· `budget.json`（闸门） |
| `core/contracts/` | 7 个内部契约（GenerationJob / Artifact / **DecompositionPlan** / RefineRecipe / EngineImportPlan / AssemblyPlan / Ledger） |
| `core/schema-ref.js` | 解析 `@gbe/schema`（**永不拷贝副本**） |
| `providers/` | 平台适配器；`_template/` 是新增平台的模板 |
| `decompose/` | ★ 拆分：计划 / 规则 / Blender 切分脚本 |
| `refine/` | Blender 精修：配方 / 交互脚本 / 无头批处理 / 应急链 |
| `build/` | ★ 装配清单生成与校验 + **参数化建筑模板** |
| `engines/` | 引擎适配器 + `semantic_map.json`（语义动作 → 具体 MCP 工具名） |
| `bridges/` | MCP 治理：端口视图同步 / profile / 体检 / Bridge Router（Phase 4） |
| `pipeline/` `qa/` `cmd/` `scripts/` | 提示词库 / 门禁 / 子命令 / 工具脚本 |

---

## 端口（本仓只占这几个）

| 用途 | 端口 |
|---|---|
| Blender MCP | 9877 |
| Godot 编辑器桥 | 9876（写死不可改） |
| Unreal Python Remote Exec / Remote Control | 6776 (UDP) / 30010 |
| Unreal 备选实现 | 8091 / 55557（仅选中该实现时占用） |
| ~~Unity MCP~~ | 8080（**延后，当前不占用**） |

> **端口真源不在这里** —— 在 `gbe-assets/catalog/ports.json`。本仓 `bridges/registry.json` 是从它生成的**只读视图**。改端口请改真源，再跑 `node bridges/sync-ports.js`。

---

## 文档

| 文档 | 作用 |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | 生产端完整方案 |
| [`docs/BUILDING-DECOMPOSITION.md`](docs/BUILDING-DECOMPOSITION.md) | ★ 场景建筑拆分细化方案（分层 / 模数 / 两条产线 / 粒度判据 / 万安城排期） |
| [`AGENTS.md`](AGENTS.md) | AI 助手在本仓的工作纪律 |
| `../gbe-assets/docs/DECISIONS.md` | ★ 决策台账（ADR-0001 ~ 0006） |
| `../gbe-assets/docs/CONVENTIONS.md` | ★ 双库共享约定 v1.2 |

---

## 许可

MIT —— 见 `LICENSE`。
