# GBE-Studio 设计方案

> **GBE = Generative Blender-to-Engine**
> GBE-Studio 是**生产端**：把「多平台 AI 生成 → 构件拆分 → Blender 精修 → 多引擎落地」做成一条可复用、可复现、可控成本的资产流水线。
> 本文是**重构方案**，不复用 tbg-3d 的既有结构；tbg-3d 仅作为已验证的原型与经验来源（**只读归档，不迁移**，ADR-0001）。
> **共享约定见 `gbe-assets/docs/CONVENTIONS.md`（v1.4，权威）**：单位/轴心/朝向、尺寸轴序、id·version、契约版本、预算与分类单源、status 与 flags、recipe_hash、材质、许可、成本账本、硬性禁令、**构件分级 §19**、**注册表 §20**。
> **决策依据见 `gbe-assets/docs/DECISIONS.md`（ADR-0001 ~ ADR-0007）**：存量不迁移 · 不接 Rodin · 混元3D 三通道 · Unity 延后 · MCP 实现可切换 · 构件分级拼装 · 官方 MCP 进注册表但不预设首选。
> **拆分工序见 [`docs/BUILDING-DECOMPOSITION.md`](./BUILDING-DECOMPOSITION.md)**（场景建筑拆分细化方案）。
> Studio 精修与打包必须遵守共享约定；**禁止本地另立一套**。

---

## 0. 一句话目标

**一句话进来，一个可用资产（或一栋可拼装的建筑）落到目标引擎里。**

```
"给万安城做一座歇山顶重檐大殿，落进 UE5 的 WananCity 场景，带碰撞和 LOD"
  → 路由选平台（构件走 Tripo / 混元3D，hero 件走 Meshy）→ 生成
  → 拆分成 L2 构件（檐柱 / 额枋 / 斗拱 / 瓦面 / 脊筒…）
  → Blender 精修（统一模数 + 插槽）→ 质检 → 打包投递 gbe-assets
  → 写一份装配清单（引用构件 id + 插槽绑定）
  → 需要时直接导入 Godot / UE5，跑起来截图验收
```

---

## 1. 定位与边界

| | GBE-Studio（本方案） | GBE-Assets |
|---|---|---|
| 角色 | **生产端** | **仓储 / 服务 / 分发端** |
| 交互面 | AI 助手对话（自然语言 + 命令） | Web 站 + REST API + 引擎客户端 |
| 职责 | 路由 → 生成 → **拆分** → 精修 → 质检 → 打包 | 校验 → 入库 → 索引 → 浏览 → 下载 → **装配** |
| 独占资产 | 平台凭证、精修配方、提示词库、**拆分策略**、MCP 桥 | 数据契约（schema 权威）、资产实体、装配清单、索引 |
| 产物 | **GBE 资产包**（多格式模型 + asset.json + source.json）+ **装配清单** | 可检索、可预览、可按引擎下载、可拼装的资产库 |

**唯一契约 = GBE 资产包**。schema 权威在 gbe-assets，studio 打包时校验；契约变更只从 assets 侧发起。
**校验器为同一份依赖**（`@gbe/schema`，语法单源）：studio 出包前调用一次、assets 入库时再调用一次，**语法校验不双实现**；业务门禁在两侧各跑一次，但判据聚合自同一组真源（`kit.json.budgets` / `kit.json.grid` / schema enum / `kit.json.materials`）。

---

## 2. 为什么要重构（相对 tbg-3d）

| 维度 | tbg-3d（原型） | GBE-Studio（重构） | 动机 |
|---|---|---|---|
| 生成平台 | 仅 Tripo（+ 混元手动拖文件） | **Provider 适配层**：Tripo / Meshy / 混元3D（三通道）/ fal | 单一供应商有质量、成本、可用性三重风险；不同 tier 适配不同平台 |
| **建模单位** | **整栋建筑** | **构件（L1–L3）为主，建筑由装配清单拼出** | 整栋不可复用；构件才是资产（ADR-0006） |
| 引擎 | 仅 Godot | **Engine 适配层**：Godot / UE5（Unity 延后） | 资产要能被两个引擎消费，抽象要能容纳第三个 |
| 路由 | 人肉选模型 | **Policy Router**：按 tier / 拓扑 / 预算 / 平台可用性自动选 | 把"选哪家"从人的记忆变成可执行策略 |
| MCP | 2 个 MCP 直连，端口手工错开 | **实现注册表 + 可切换**（ADR-0005）+ 工具面收敛 | 社区 MCP 生命周期不稳；固定一家等于把自己焊死在别人的进度上 |
| 成本 | 单一积分余额 | **CostLedger**：跨平台统一账本 + 预算闸门 | 多平台后成本失控风险剧增；构件复用是最大的省钱杠杆 |
| 精修 | 脚本 + 人工混用 | **RefineRecipe 声明式配方**（可复现）+ 交互逃生舱 | 精修结果必须可复现、可回归 |
| 质检 | 入库时人工看 | **QA Gate 自动门禁**（尺寸/轴序/轴心/面数/UV/材质/命名/**插槽**/契约版本） | 多引擎 + 构件化后规格一致性靠人不可行 |
| 契约 | 无版本、无 status、命名靠自觉 | **v2 契约**（`schema_version` / `version` / `status` / `flags` / `granularity`）+ 共用 `@gbe/schema` | 出包与入库必须对同一套判据 |

> 结论：**重构的核心是三件事**——① 把"生成"和"落地"抽象成可插拔适配层；② 中间夹一条确定性、可复现的拆分 + 精修 + 质检流水线；③ **把建模单位从"建筑"改成"构件"**，让资产真正复用起来。

---

## 3. 总体架构

```
                       ┌──────────────────────────────────────────┐
   用户自然语言 ──────▶ │              GBE-Studio                   │
                       │   Intent → Plan → 逐步确认 → 执行         │
                       └───────────────────┬──────────────────────┘
                                           │
   ┌──────────────────┬────────────────────┼────────────────────┬──────────────────┐
   │                  │                    │                    │                  │
   ▼                  ▼                    ▼                    ▼                  ▼
┌───────────┐  ┌──────────────┐  ┌─────────────────┐  ┌────────────────┐  ┌──────────────┐
│ ① 生成层   │  │ ② 拆分层 ★新  │  │ ③ 精修层         │  │ ④ 集成层        │  │ ⑤ 装配层 ★新  │
│ Providers │  │ Decompose    │  │ Blender Core     │  │ Engines        │  │ Assemble     │
├───────────┤  ├──────────────┤  ├─────────────────┤  ├────────────────┤  ├──────────────┤
│ tripo     │  │ 路线A 构件直生│  │ refine.py(交互)  │  │ godot          │  │ 装配清单编写  │
│ meshy     │  │ 路线B 整栋拆分│  │ headless.py(批)  │  │ unreal         │  │ 插槽绑定      │
│ hunyuan3d │  │ 语义切分      │  │ recipe/*.json    │  │ (unity 延后)   │  │ 碰撞/校验     │
│ fal       │  │ 模数归一      │  │ retopo / solidify│  │                │  │ 参数化变体    │
│ (rodin ✗) │  │ 插槽生成      │  │ fallback 链      │  │                │  │              │
└─────┬─────┘  └──────┬───────┘  └────────┬─────────┘  └───────┬────────┘  └──────┬───────┘
      │               │                   │                    │                  │
      │ 计费          │ 拆分计划           │ 质检                │ MCP              │ 装配校验
      ▼               ▼                   ▼                    ▼                  ▼
┌───────────┐  ┌──────────────┐  ┌─────────────────┐  ┌────────────────┐  ┌──────────────┐
│CostLedger │  │Decomposition │  │ QA Gate          │  │ MCP 实现注册表  │  │ AssemblyPlan │
│ 跨平台账本 │  │ Plan         │  │ 规格/拓扑/插槽   │  │ (可切换)        │  │ + 装配校验    │
└───────────┘  └──────────────┘  └────────┬─────────┘  └────────────────┘  └──────┬───────┘
                                           │                                      │
                                           ▼                                      ▼
                              ┌────────────────────────────┐        ┌────────────────────────┐
                              │ GBE 资产包 → gbe-assets     │        │ 装配清单 → assemblies/  │
                              │ model.glb + asset.json      │        │ （L0 建筑，引用构件）    │
                              │ + source.json + preview.png │        └────────────────────────┘
                              └────────────────────────────┘
```

---

## 4. 核心抽象契约

生产端的全部可插拔性由 6 个契约承载。它们**语言无关**（JSON Schema），放在 `core/contracts/`。

### 4.1 GenerationJob — 生成请求

```jsonc
{
  "job_id": "gen-20260915-0001",
  "mode": "text | image | multiview | remesh | retexture | rig",
  "intent": "component | mass | hero | texture | animation",
  "granularity_target": "L2",        // ★ 期望的几何粒度（ADR-0006）：决定出模后走哪条拆分路线
  "inputs": { "prompt": "...", "negative_prompt": "...", "images": ["front.png"] },
  "constraints": {
    "topology": "tri | quad",        // quad 需 Blender 重拓扑（Rodin 已不接入，ADR-0002）
    "face_limit": 15000,
    "texture": "none | standard | hd",
    "pbr": true,
    "geometry_only": false,          // ★ 白模：拆件阶段只需几何（混元3D tencentcloud 通道支持）
    "format": "glb"
  },
  "budget": { "max_cost": 40, "unit": "credit" },
  "provider_hint": "auto | tripo | meshy | hunyuan3d | fal",
  "repro": { "seed": 12345 }
}
```

### 4.2 GenerationArtifact — 平台无关产出

```jsonc
{
  "job_id": "gen-20260915-0001",
  "provider": "hunyuan3d",
  "channel": "tokenhub",              // ★ 多通道平台的实际通道（ADR-0003）
  "model": "hy-3d-3.1",
  "files": [{ "role": "model", "path": "raw/model.glb", "format": "glb" }],
  "preview": "raw/preview.png",
  "stats": { "polycount": 42000, "dimensions_m": [8.0, 4.5, 6.0] },
  "billing": { "cost": 38, "unit": "credit", "currency": "USD_EST", "est_usd": 0.42 },
  "raw_meta": { /* 平台原始响应，保留以便溯源与排障 */ }
}
```

> 关键点：**上层只认 GenerationArtifact**。换平台、加平台都不影响拆分、精修与集成层。

### 4.3 DecompositionPlan — 拆分计划（★ 新增，ADR-0006）

```jsonc
{
  "plan_id": "dec-20260915-0002",
  "source": { "job_id": "gen-20260915-0001", "artifact": "raw/model.glb" },
  "route": "A | B",                    // A 构件直生 / B 整栋拆分
  "target_granularity": "L2",
  "parts": [
    {
      "part_id": "colonnade-front",
      "kind": "L1",                    // 该件的几何粒度
      "asset_id": "cn-ancient.pillar.yanzhu-round-a",
      "select": { "by": "material_slot | bbox | connected | manual", "value": "wood" },
      "split_ops": ["separate", "align_to_grid"],
      "sockets": [ { "name": "foot", "type": "ground-foot", "position_m": [0,0,0], "direction": "-y" } ]
    }
  ],
  "grid": { "snap_m": 0.5, "source": "kit.json" },   // ★ 只引用，不写死（禁止第二份模数）
  "reject_policy": "fail | quarantine"                // 拆不出来的部分：报错 or 隔离待人工
}
```

> 拆分计划是**可复现的**：同一 raw 模型 + 同一计划 → 同一组构件。计划记录在 `source.json.refine.recipe_id` 的同一溯源链里。

### 4.4 RefineRecipe — 声明式精修配方

```jsonc
{
  "recipe_id": "cn-ancient/roof-component",
  "steps": [
    { "op": "cleanup",   "params": { "merge_distance": 0.001, "fill_holes": true } },
    { "op": "retopo",    "params": { "target_faces": 12000, "method": "quadriflow" },
                         "when": "topology_wanted == 'quad'" },     // ★ Rodin 不接入后，quad 靠重拓扑（ADR-0002）
    { "op": "normalize", "params": { "unit": "m", "pivot": "bottom-center", "axis": { "up": "+Y", "forward": "-Z" },
                                     "snap_to_grid_m": 0.5 } },     // ★ 构件必须吸附模数网格（CONVENTIONS §19.2）
    { "op": "solidify",  "params": { "thickness_m": 0.05 }, "when": "open_shell" },
    { "op": "decimate",  "params": { "target_faces": 20000, "method": "collapse" } },
    { "op": "material_slots", "params": { "map": "pipeline/material-map.json" } },
    { "op": "export",    "params": { "format": "glb", "apply_transform": true } }
  ],
  "qa": ["pivot", "unit", "axis", "budget", "uv_exists", "material_slots", "grid_alignment", "socket_present"]
}
```

同一件资产用同一配方 → 结果可复现。
**`recipe_hash` 覆盖 `steps` + `qa` + `recipe_id` + Blender 主版本**——`qa` 必须纳入（CONVENTIONS §7.1）：判据变了，"合格"的含义就变了，同一 hash 不能对应两套门禁。

人工精修（hero 件）走 `refine.py` 交互路径，但**最终仍需回填配方**；确实回填不了时：写 `manual: true` + `note`（操作摘要，不进 hash），并在 QA 打 `refine-unreproducible`，不得宣称可回归。

### 4.5 EngineImportPlan — 引擎落地计划

```jsonc
{
  "plan_id": "imp-20260915-0003",
  "engine": "unreal",
  "mcp_impl": "sam-david-unreal-mcp",   // ★ 指定实现（可切换，ADR-0005）；缺省则用注册表的 active
                                        //   候选含官方实现 unreal-official-mcp（UE 5.8+，ADR-0007）
  "target": { "project": "F:/zxc/Project/WananCity", "map": "/Game/Maps/WananCity" },
  "asset": {
    "id": "cn-ancient.roof.xuanshan-single-a",
    "version": "1.0.0",                 // ★ 必须带版本，否则无法判断导入的是哪一版
    "recipe_hash": "a1b2c3d4e5f60718",
    "lod": 0
  },
  "placement": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": 100 },
  "collision": "box",
  "materials": { "strategy": "remap", "map": { "roof-tile/qingwa": "/Game/Mat/M_Qingwa" } },
  "verify": { "screenshot": true, "run": false }
}
```

- **落地身份**：包装内附 `_gbe.json`（`asset_id` / `asset_version` / `recipe_hash` / `source_hash`），导入后仍能自证来源版本（CONVENTIONS §11）。
- **轴转换只做三件事**：① 单位缩放（UE `scale: 100`）；② **水平**朝向修正（仅绕 Y）；③ 材质重映射。**up 轴的 Y→Z 由引擎导入器负责，集成层不得重复转换**——重复转换会得到"躺着的模型"。

### 4.6 AssemblyPlan — 装配清单（产出物，schema 真源在 assets）

装配清单的**格式权威**是 `gbe-assets/catalog/schema/assembly.v2.json`（CONVENTIONS §19.4）；Studio 侧负责**编写**，不另立格式。

```jsonc
{
  "id": "cn-ancient.assembly.wanan-hall-main",
  "granularity": "L0",
  "instances": [
    { "instance_id": "roof-01",
      "asset": { "id": "cn-ancient.roof.xieshan-double-a", "version": "^1.0.0" },
      "transform": { "position": [0, 6, 0], "rotation": [0, 0, 0], "scale": 1 },
      "sockets": { "roof-foot": "colonnade-01::roof-seat" } }
  ]
}
```

**要点**：装配清单**不烘焙几何**。要单网格时走 assets 侧 `derive --bake`（派生物，可重建）。改一根柱子样式 → 只改构件资产一处。

### 4.7 CostLedger — 跨平台账本

**记账字段（唯一字段集，与 assets 侧共用，禁止改名）**：

```
provider_requested   -- 请求时指定的平台（可能是 auto）
provider_used        -- 实际出件的平台（降级后可能不同，出包与对账都看这个）
provider_channel     -- 实际通道（多通道平台，如 hunyuan3d 的 tokenhub|tencentcloud|web）
job_id / asset_id / tier
cost / unit / usd_est
balance_after / balance_source   -- 余额来源：主账号 / 子账号 / CLI OAuth
```

提供三种闸门：**单件预算**、**批次预算**、**平台余额兜底**（余额低于阈值直接停，不静默重试）。
`web` 通道不返回计费信息，需**手工补记**。

---

## 5. 生成层：Provider 适配器

### 5.1 接入矩阵（2026-09 核实，ADR-0002 后）

| Provider | 接入方式 | 模式 | 拓扑/特点 | 成本量级 | 角色 |
|---|---|---|---|---|---|
| **Tripo** | `tripo` CLI（OAuth 本地凭证） | text / image / multiview / remesh / rig / lowpoly | P1 低模 48–20k，H3.1 可用 quad | 低（≈$0.10–0.25/件） | **默认主力**（速度+便宜+低模友好） |
| **Meshy** | REST API（Pro 起） | text / image / multi-image / retexture / remesh / rig | Meshy 6/7，600+ 动画库，生态最好 | 低–中 | **角色 / 动画 / 贴图重做 / hero 件** |
| **腾讯混元 3D** | **三通道**（见 §5.4） | text / image / multiview，含 geometry-only 白模 | 国内直连、无网络墙；Rapid 快 / Pro 精 | 低 | **国内兜底 + 白模构件**（拆件首选） |
| **fal.ai** | 单一 API Key，聚合多个模型 | 覆盖 tripo h3.1/p1、meshy v6/v7、hunyuan-3d v3.1、trellis-2、hitem3d、triposr | 一个 key 打多家 | pay-per-use，≈$0.07–0.48 | **聚合兜底 + 长尾模型** |
| ~~Hyper3D Rodin~~ | **不接入**（Business 订阅约 $120/mo 不划算） | — | 原优势为 quad 拓扑最干净 | — | **已移除**；quad 需求改走 Blender 重拓扑（ADR-0002） |
| （可选）本地开源 | Stability SF3D / TRELLIS 自托管 | image-to-3D | 0.5s 级，仅 albedo，无 PBR | 近似 0 | **批量草稿 / 隐私敏感**（未排期） |

> **provider id 取值统一为**：`tripo` / `meshy` / `hunyuan3d` / `fal`。
> **不追求"接满"**：四家的覆盖已足够；新增平台 = 一个目录 + 一份 `capabilities.json`（见 `providers/_template/`）。

### 5.2 能力声明与路由

每个 provider 一份 `capabilities.json`，声明：

```jsonc
{
  "id": "tripo",
  "enabled": true,
  "channels": ["default"],
  "modes": ["text", "image", "multiview", "remesh", "rig"],
  "topology": ["tri"],
  "formats": ["glb", "fbx", "obj", "usdz"],
  "max_concurrency": 3,
  "billing_unit": "credit",
  "supports": { "pbr": true, "quad": false, "face_limit": true, "seed": true,
                "negative_prompt": true, "geometry_only": false },
  "reliability": { "region_blocked_from_cn": false }
}
```

**Policy Router 决策顺序**（`core/policy/router.js`）：

1. 引擎/平台可用性过滤（区域封锁、未登录、余额不足 → 剔除）
2. 形态约束过滤（要 quad → 无平台直接支持，改走重拓扑；要低模 2 万面 → Tripo / Meshy）
3. tier / granularity 优先表：
   - `primitive` → **程序化（0 成本）**（柱 / 础 / 直墙段 / 阶条石 / 栏杆）
   - `L2` 构件（无贴图白模优先）→ `hunyuan3d (geometry-only)` → `tripo`
   - `mass` → `tripo | fal`
   - `hero` → `meshy`
4. 成本闸门（超预算降档或换家）
5. 失败降级链：**`meshy → fal → hunyuan3d`**；每次降级**告知用户**并记入账本（`provider_requested ≠ provider_used`）

> 路由表真源：`core/registry/providers.json`（启用状态）+ `core/policy/router.js`（策略）。**禁止把平台名写死在流程里**（CONVENTIONS §15.1）。

### 5.3 统一任务模型

多平台的共同痛点：**并发上限不同、异步轮询、URL 过期**。统一封装为：

- `submit(job) → ticket`，`poll(ticket)`，`fetch(artifact)` 三动词
- 并发令牌池（按 provider 的 `max_concurrency` 排队）
- **产出即时落盘**（应对模型 URL 短时效）
- 断点续跑：job 状态持久化，中断后可从"已生成未精修"继续

### 5.4 多通道平台的处理（★ ADR-0003）

混元3D 有三条并行通道，能力与门槛不同：

| 通道 | 鉴权 | 能力 | 门槛 |
|---|---|---|---|
| `tokenhub` | Bearer API Key | 文生 / 图生 3D，返回 obj/glb 直链 | 低（**推荐默认**） |
| `tencentcloud` | TC3 签名（SecretId / SecretKey） | 最全：Rapid / Pro / **geometry-only 白模** / **多视角图生** | 中 |
| `web` | 浏览器登录态（官网网页版） | 同上，人工交互 | 最低（半自动兜底） |

**统一处理规则**：

1. 通道由 `gbe.config.json` → `providers.hunyuan3d.channel` 显式指定；未指定时按 `tokenhub → tencentcloud → web` **探测可用性**，结果写入 `gbe-set` 体检报告。
2. **通道差异被限制在 `providers/hunyuan3d/` 内**——对外只暴露统一的 `submit/poll/fetch`，上层不感知。
3. `web` 通道为**半自动**：适配器不提交任务，只**登记 provenance**（平台 / 时间 / 提示词）。此通道下 `source.json.provenance.task_id` 允许 `null`，但 `mode` / `prompt` 必填；成本需手工补记。
4. **`geometry_only` 白模优先用于拆件阶段**——拆件只需要几何，不需要纹理，白模更快更便宜（与 `BUILDING-DECOMPOSITION.md` 的路线 B 配合）。

---

## 6. 拆分层与精修层

### 6.1 拆分层（★ 新增，ADR-0006）

**目的**：把 AI 生成的"整栋建筑"变成"可复用的 L2 构件"；或在生成阶段就**直接产出构件**。

两条路线（详见 `docs/BUILDING-DECOMPOSITION.md`）：

| 路线 | 做法 | 适用 | 成本 |
|---|---|---|---|
| **A · 构件直生** | 提示词直接生成**裸构件**（无墙体 / 无地面 / 无场景），走声明式精修 | 标准化 L2：屋顶 / 柱 / 墙段 / 门 / 栏杆 | 低（每件一次生成，后续复用） |
| **B · 整栋拆分** | 生成整栋 → 语义切分 → 得到构件 → 逐个精修 | hero 建筑、非常规形制 | 高（需交互式精修） |

**关键技术手段**（`decompose/`）：

- **语义切分**：按材质槽 / 连通域 / 包围盒 / 手工标注面选择集切分（Blender `separate` 系列）
- **模数归一**：切出的构件统一 `snap_to_grid_m` 吸附（CONVENTIONS §19.2）
- **插槽生成**：按构件类型自动推断插槽候选（柱底 → `ground-foot`，柱顶 → `stack-up`…），人工确认后写入
- **命名与 id 分配**：切分产物必须映射到 `cn-ancient.<category-leaf>.<name>`；**映射不出的部分隔离待人工，不得静默丢弃**
- **零成本优先**：能用程序化生成的构件**不进 AI 队列**（`tier: primitive`）——这是预算利用率最大的杠杆

> 拆分计划的产出物 **`DecompositionPlan`**（§4.3）使拆分可复现、可回归。

### 6.2 精修层

三条路径，按成本与场景选：

| 路径 | 入口 | 适用 | 可复现 |
|---|---|---|---|
| **声明式批处理** | `refine/headless.py` + RefineRecipe | 构件 / 量产件 / 批量回归 | ✅ 完全可复现 |
| **交互精修** | `refine/refine.py`（经 blender-mcp） | hero 件、结构修复、拆件 | ⚠️ 人工，需回填配方（回填不了则标 `refine-unreproducible`） |
| **应急无 Blender** | FBX2glTF + gltf-transform + 自研修正脚本 | 机器无 Blender；仅格式/减面/压贴图/修单位 | ✅ 脚本化 |

**精修规范（跨引擎前提，硬约束）**：

| 项 | 标准 |
|---|---|
| 单位 | 1 unit = 1 m，Apply Transform |
| 轴心 | bottom-center（**不可被 kit.json 覆盖**） |
| 朝向 | +Y up，**-Z forward 为 glTF 基准**；Unity / UE 的转换全部在**集成层**做，且 **up 轴由引擎导入器负责** |
| 尺寸轴序 | `geometry.dimensions_m = [x 宽, y 高, z 深]`，**顺序写死** |
| 面数 | 按 tier 预算（primitive 5k / component 20k / mass 50k / hero 100k），口径为**三角面** |
| 命名 | `kebab-case`，id = `<kit>.<子类>.<名称>`；**目录名 == id 第三段，无类别前缀** |
| **模数** | 构件尺寸与插槽位置**必须落在 `kit.json.grid` 网格上**（CONVENTIONS §19.2） |
| **插槽** | L2 及以上构件**必须**声明 `sockets[]`（≥1 个） |
| 许可 | 出包必填 SPDX 标识符，**不允许留空** |

> 重要设计决策：**精修层只产出"引擎无关的标准 glb"**。坐标轴、单位、材质引用全部由集成层按目标引擎转换——避免同一资产为不同引擎存多份精修结果。

---

## 7. 集成层：多引擎适配器

### 7.1 统一落地语义

每个引擎适配器都要实现同一组语义动作：

| 动作 | 语义 | Godot | Unreal |
|---|---|---|---|
| `probe()` | 环境是否就绪 | 编辑器桥连通 | Python Remote Execution 连通 |
| `importAsset(plan)` | 把模型放进工程 | 拷入 `res://` 触发导入 | 导入 Content Browser（uasset） |
| `instantiate(plan)` | 实例化到场景 | MeshInstance3D + .tscn | Actor + StaticMeshComponent |
| `applyCollision(plan)` | 碰撞 | Box/Capsule/Convex Shape | Simple Collision |
| `remapMaterials(plan)` | 材质映射 | .tres 共享材质 | Material Instance |
| `registerScene(plan)` | 场景登记 | 地图注册表 | Level 登记 |
| `verify(plan)` | 验收 | 运行截图 | PIE 截图 |
| `undo()` | 可回退 | 原生撤销栈 | 事务 |

> **坐标契约**（CONVENTIONS §1）：交付基准永远是 `+Y up / -Z forward / 米`。引擎差异只在三处体现——**单位缩放**（UE ×100）、**水平朝向**、**up 轴**（由引擎自己的导入器 Y→Z，我们不碰）。

### 7.2 引擎注册表与 MCP 实现（★ 不固定，ADR-0005 / ADR-0007）

**核心变化：不再给每个引擎指定唯一 MCP，而是「引擎 × 实现」多对多，运行时切换。**

> **ADR-0007 补充**：UE 5.8 起官方 MCP 插件内置，注册表新增 **`source` / `engine_version_range` / `maturity`** 三个维度以表达「官方 vs 社区」的取舍；官方实现进注册表但**不预设首选**。

`core/registry/mcp.json`：

```jsonc
{
  "godot": {
    "active": null,                      // null = 尚未选择，gbe-set 会引导
    "implementations": [
      { "id": "yanhuifair-godot-mcp", "repo": "@yanhuifair/godot-mcp",
        "transport": "tcp", "port": 9876, "tool_count": 386,
        "requirements": ["编辑器插件", "项目已打开"],
        "supports": ["probe","importAsset","instantiate","applyCollision",
                     "remapMaterials","registerScene","verify","undo"],
        "verified_at": "2026-09" }
    ]
  },
  "unreal": {
    "active": null,
    "implementations": [
      // ★ first-party（ADR-0007）：UE 5.8 起内置，Experimental，本地回环端口 8000
      //    注意 semantic_map: null = 「工具尚不存在」而非「还没填」—— 需先自写 GBE Toolset
      { "id": "unreal-official-mcp", "repo": "内置（Engine Experimental 插件）",
        "source": "first-party", "maturity": "experimental", "engine_version_range": ">=5.8",
        "transport": "http", "ports": [8000], "tool_count": null,
        "requirements": ["UE 5.8+", "启用内置 Unreal MCP 插件 + AllToolsets",
                         "★ 自写 GBE Toolset（继承 UToolsetDefinition）才有可映射工具名"],
        "semantic_map": null, "supports_basis": "design-complete",
        "verified_at": null, "verification_note": "未上机实测" },
      { "id": "sam-david-unreal-mcp", "repo": "sam-david/unreal-mcp",
        "source": "community", "maturity": "unknown", "engine_version_range": null,
        "transport": "udp+http", "ports": [6776, 30010], "tool_count": 127,
        "requirements": ["内置 Python Editor Script 插件", "Remote Control 插件"],
        "note": "零编译路线，无需 C++ 插件", "verified_at": "2026-09" },
      { "id": "chir24-unreal-mcp", "repo": "ChiR24/Unreal_mcp",
        "source": "community", "maturity": "unknown", "engine_version_range": null,
        "transport": "ws", "port": 8091, "tool_count": 36,
        "requirements": ["C++ 插件"], "verified_at": "2026-09" },
      { "id": "aadeshrao123-unreal-mcp", "repo": "aadeshrao123/Unreal-MCP + ue-cli",
        "source": "community", "maturity": "unknown", "engine_version_range": null,
        "transport": "tcp", "port": 55557, "tool_count": 230,
        "requirements": ["C++ 插件"], "verified_at": "2026-09" }
    ]
  },
  "blender": {
    "active": null,
    "implementations": [
      { "id": "blender-mcp", "transport": "tcp", "port": 9877,
        "requirements": ["Blender addon 启用"], "verified_at": "2026-09" }
    ]
  }
}
```

**规则**：

1. **`active` 决定当前生效实现**，通过 `gbe-engine mcp use <engine> <impl-id>` 切换；切换只改注册表 + 重写助手 MCP 配置，**不改任何上层代码**。
2. **适配器只依赖 8 个语义动作**；各实现提供 `engines/<engine>/semantic_map.json`（语义动作 → 该 MCP 的具体工具名）。**新实现 = 一条注册表记录 + 一份映射表**。
3. **能力差异显式声明**：实现声明 `supports: []`；缺某语义动作时，适配器**明确告知能力缺失**并给替代路径，不静默失败。
4. Bridge Router（Phase 4）聚合的是**语义面**而非实现面，因此**换实现不影响 Router**。
5. **不预设首选**：`active: null` 时 `gbe-set` 列出候选、说明各家的 requirements 与能力差异，由用户选择。
6. **三维度取舍**（ADR-0007）：先按 `engine_version_range` 过滤；要长期稳定、或要让 8 个语义动作由自己掌控 → 倾向 `first-party`（代价：得写 Toolset）；要零编译、或引擎版本低于官方支持区间 → 倾向 `community`。**均为偏好提示，不自动选定。**
7. **`maturity` 不得因「官方」而上调**：官方实现当前标 `experimental`（Epic 自述 API 与格式可能变化、不建议用于生产）；`unknown` 表示未核实，**禁止替它猜一个体面的值**。
8. **`semantic_map: null` 不许用空壳映射表代替**：官方插件暴露的是引擎操作工具（actor / 蓝图 / 材质 / Niagara / Sequencer），**不含** 8 个语义动作，必须**先实现 GBE Toolset**。写一份全 `null` 的空壳会掩盖「要写实现」与「要填映射」这两种完全不同的工作量。

> **Unity 延后**（ADR-0004）：`unity` 在 `core/registry/engines.json` 中 `status: "deferred"`，注册表中不列实现；`gbe derive --engine unity` **明确报错**"引擎未启用"，不静默跳过。

### 7.3 端口规划（全项目一张表）

| 用途 | 端口 | 说明 |
|---|---|---|
| Godot 编辑器桥 | 9876 | godot-mcp 写死，不可改 |
| Blender MCP | 9877 | 与 Godot 错开 |
| Unreal Python Remote Execution | 6776 | UDP |
| Unreal Remote Control API | 30010 | HTTP |
| Unreal（备选实现 ChiR24） | 8091 | WS，仅该实现启用时占用 |
| Unreal（备选实现 aadeshrao123） | 55557 | TCP，仅该实现启用时占用 |
| **Unreal 官方 MCP（预留）** | **8000** | HTTP，UE 5.8+ 内置（ADR-0007）。**已登记但未启用**；属通用端口，启用前必须探测占用 |
| **Unity MCP（预留）** | 8080 | **延后，当前不占用**（ADR-0004） |
| gbe-assets API | 8788 | 见 assets 方案 |
| gbe-assets Web | 8789 | 见 assets 方案 |

**端口真源已移交 assets 侧**：全项目唯一真源是 `gbe-assets/catalog/ports.json`（含上表全部端口）。本仓 `bridges/registry.json` 是**从真源生成/校验的只读视图**，不得作为第二真源；起服务前仍做**冲突探测**（端口被占则报错并给出换端口建议，不静默改）。

> 切换 MCP 实现会带来端口变化（如 UE 从 6776/30010 切到 8091）——切换命令负责更新助手配置并**复检端口可用性**。

---

## 8. MCP 桥治理

### 8.1 问题

原生直连各引擎 MCP，工具总量：

```
Godot 386 + Unreal 127（首选实现）+ Blender ~20  ≈ 530+
```

全量挂载会（a）吃掉大量上下文预算，（b）产生语义重复（引擎都有"创建物体/截图/保存场景"），（c）让模型选错工具。

### 8.2 方案：两层收敛

**第一层 — Engine Profile（默认，立即可用）**
一次会话只激活**一个目标引擎**的 MCP。`gbe-engine use unreal` 切换 profile，写 MCP 配置并提示重启。零成本、立刻可用。

**第二层 — Bridge Router（推荐终态）**
自建一个聚合 MCP server，对外只暴露**语义化工具集**（≤ 24 个），内部按 profile 转发到原生 MCP：

| 聚合工具 | 覆盖能力 | 内部转发 |
|---|---|---|
| `engine_status` | 环境体检 | 各引擎 probe |
| `engine_profile_switch` | 切换目标引擎 | 重载 profile |
| `mcp_impl_switch` | **切换 MCP 实现** | 重写注册表 active |
| `asset_import` | 导入模型 | importAsset |
| `scene_object_spawn` / `scene_object_modify` | 实例化 / 变换 | instantiate |
| `collision_apply` | 碰撞 | applyCollision |
| `material_remap` | 材质映射 | remapMaterials |
| `scene_register` | 场景登记 | registerScene |
| `viewport_capture` | 截图验收 | verify |
| `undo_last` | 回退 | undo |
| … | | |

**逃生舱**：需要深度操作（如 UE 蓝图连线）时，可临时切换回原生 MCP，用完即收回。

> **Router 只认语义动作，不认实现**——这正是 ADR-0005 让实现可自由替换的前提。

### 8.3 健康检查与自愈

`gbe-set` / `bridges/health.js` 做逐项体检：Node、Blender、各引擎可执行文件、**当前 active 实现的各端口**连通、平台登录态、平台余额、**混元3D 可用通道**。
失败给出**单步修复指令**（不是"环境有问题"这种废话），并支持 `--fix` 自动拉起编辑器。

---

## 9. 质量门禁（QA Gate）

打包投递**前**强制执行，不通过即拒绝出包：

| 门禁 | 判据 | 失败处理 |
|---|---|---|
| 契约版本 | `schema_version` 存在且为 `"2"` | 拒绝出包 |
| schema | asset.json / source.json 过 `@gbe/schema` | 拒绝出包 |
| **几何粒度** | `granularity` 存在且为 `L0|L1|L2|L3` | 拒绝出包 |
| 几何 | 面数在 tier 预算内（**三角面**） | 提示减面或提升 tier |
| 单位/轴心/朝向 | 1u=1m、bottom-center、-Z forward | 自动回精修 |
| **尺寸轴序** | `dimensions_m = [x 宽, y 高, z 深]` | 自动纠正并复检 |
| **模数对齐** | 构件尺寸与插槽位置落在 `kit.json.grid` 网格上（§19.2） | 自动吸附并复检；`grid_exempt` 例外 |
| **插槽完备** | L2 及以上构件 `sockets[]` 非空 | 自动补候选 + 人工确认 |
| UV | 有 UV（有贴图时） | 拒绝出包 |
| 材质 | 无贴图件必须挂共享材质槽（槽名词表见 §5.1） | 打 `needs-material-review`（标记，非 status） |
| 命名 | kebab-case + id 规范 + **目录名 == id 第三段** | 自动纠正 |
| 许可 | `license` 为 SPDX 标识符且非空 | 拒绝出包 |
| 预览图 | 有 `preview.png` 且为 512×512 | 自动无头渲染补 |
| 溯源 | `refine.recipe_hash` 非空（含 qa） | 打 `refine-unreproducible` |

> **双保险的做法**：**语法校验单源**——两侧调用同一份 `@gbe/schema`，不写第二套实现；**业务门禁双跑**——出包前跑一次、入库时再跑一次，两次都读同一组真源（预算 ← `kit.json.budgets`、模数 ← `kit.json.grid`、分类 ← schema enum、材质 ← `kit.json.materials`）。这样"两处校验"带来的是安全余量，而不是两套判据。

**装配校验**（`gbe assembly validate`）在投递装配清单**前**跑，判据见 CONVENTIONS §19.5。

---

## 10. 目录结构

```text
gbe-studio/
├── SKILL.md                      # 主技能（意图识别 → 流程编排）
├── AGENTS.md                     # 多工位纪律（生成/拆分/精修/集成/质检/装配）
├── gbe.config.json               # 本机环境：引擎路径、目标工程、assets_repo、启用 provider 与通道（gitignore）
├── cmd/                          # 子命令技能
│   ├── gbe-set/                  # 环境安装与体检（含 MCP 实现选择引导）
│   ├── gbe-gen/                  # 生成（多平台）
│   ├── gbe-decompose/            # ★ 构件拆分（ADR-0006）
│   ├── gbe-refine/               # 精修
│   ├── gbe-build/                # ★ 装配清单编写与校验
│   ├── gbe-ship/                 # 质检 + 打包 + 投递
│   ├── gbe-engine/               # 引擎落地（含 profile / MCP 实现切换）
│   └── gbe-cost/                 # 账本与预算
├── core/
│   ├── contracts/                # GenerationJob / Artifact / DecompositionPlan / RefineRecipe
│   │                             # / EngineImportPlan / AssemblyPlan(引用 assets 真源) / Ledger
│   ├── registry/                 # ★ 三张注册表（ADR-0005）
│   │   ├── providers.json        #   平台（含 enabled 与通道）
│   │   ├── engines.json          #   引擎（含 status: enabled | deferred）
│   │   └── mcp.json              #   「引擎 × 实现」多对多 + active
│   └── policy/                   # router.js（选平台）、fallback.json（降级链）、budget.json
├── providers/                    # ★ 生成平台适配器
│   ├── _template/                # 新平台模板（一个目录 + capabilities.json）
│   ├── tripo/
│   ├── meshy/
│   ├── hunyuan3d/                #   三通道：tokenhub / tencentcloud / web（ADR-0003）
│   └── fal/
├── decompose/                    # ★ 拆分（ADR-0006）
│   ├── plans/                    #   DecompositionPlan（可复现）
│   ├── rules/                    #   按构件类型的切分与插槽推断规则
│   └── decompose.py              #   Blender 无头切分脚本
├── refine/                       # Blender 精修
│   ├── recipes/                  #   声明式精修配方（按 kit / 类别 / 粒度）
│   ├── refine.py                 #   交互精修（blender-mcp）
│   ├── headless.py               #   无头批处理 + 预览渲染（512）
│   └── fallback/                 #   FBX2glTF + gltf-transform 应急链
├── build/                        # ★ 装配清单编写与校验
│   ├── templates/                #   建筑模板（参数化：开间数 / 层数 / 形制）
│   └── validate.js               #   调用 assets 侧 §19.5 判据
├── engines/                      # ★ 引擎适配器（每个实现 8 个语义动作）
│   ├── godot/                    #   adapter.js + semantic_map.json
│   ├── unreal/                   #   adapter.js + semantic_map.json
│   └── unity/                    #   （延后，ADR-0004；目录预留）
├── bridges/                      # ★ MCP 集成治理
│   ├── registry.json             #   端口只读视图（真源 = gbe-assets/catalog/ports.json）+ 冲突探测
│   ├── profiles/                 #   per-engine profile
│   ├── install-mcp.js            #   写各助手 MCP 配置（按 active 实现）
│   ├── health.js                 #   体检与 --fix
│   └── router-server/            #   聚合 MCP server（Bridge Router）
├── qa/                           # 质量门禁判定
├── pipeline/                     # 提示词库（多平台变体 + 构件专用）、材质映射、生成计划、轴心规范
├── scripts/                      # install / verify / pack / classify / fix-scale
└── docs/                         # PLAN.md / BUILDING-DECOMPOSITION.md / 决策记录
```

> **依赖 `@gbe/schema`**：开发期走 `file:../gbe-assets/packages/schema`，CI 期用 git submodule 锁 commit。**禁止拷贝副本**——拷贝即等于第二套校验器。

---

## 11. 配置与凭证治理

| 项 | 做法 |
|---|---|
| 平台凭证 | **CLI OAuth 优先**（Tripo）；REST 平台走本地密钥文件（`~/.gbe/credentials.json`，权限 600），**永不进对话/日志/仓库** |
| 密钥字段 | 日志与截图统一脱敏（`sk-***`、`Bearer ***`） |
| 账号约束 | 单账号任务绑定（task_id 与账号绑定），流程中不切账号 |
| 平台配置 | `gbe.config.json` 记启用 provider / 通道 / 引擎 / MCP 实现，随 `.gitignore` 排除 |
| 危险动作 | 删文件/覆盖工程/批量导入 → 先列清单再确认；投递目录一律 **move 归档**，禁止 `rm -rf` |

---

## 12. 交付物

| 交付 | 形态 | 说明 |
|---|---|---|
| `gbe-studio` Skill | AI 助手技能包 | 自然语言触发全流程 |
| 命令集 | `/gbe-set` `/gbe-gen` `/gbe-decompose` `/gbe-refine` `/gbe-build` `/gbe-ship` `/gbe-engine` `/gbe-cost` | 子命令技能 |
| Provider 适配器 | 4 个（可扩展） | 新增平台 = 一个目录 + capabilities |
| **拆分层** | 拆分规则库 + 脚本 | 构件直生 / 整栋拆分两条路线 |
| Engine 适配器 | 2 个启用（可扩展） | 新增引擎 = 8 个语义动作 + 一份 semantic_map |
| **三张注册表** | JSON 真源 | 平台 / 引擎 / MCP 实现，一切"启用什么"由此决定 |
| Bridge Router | MCP 聚合服务 | 工具面收敛 + 端口治理 + 实现可切换 |
| QA Gate | 校验器 | 出包门禁（共享 `@gbe/schema`）+ 装配校验 |
| **装配清单模板库** | 参数化建筑模板 | 开间数 / 层数 / 形制可参数化生成清单 |

---

## 13. 路线图

**Phase 0 — 契约先行（不写平台代码）**
1. 与 assets 侧冻结契约：`@gbe/schema`（asset.v2 / source.v2 / **assembly.v2**）、`catalog/ports.json`
2. 定稿 7 个内部契约 schema（GenerationJob / Artifact / **DecompositionPlan** / RefineRecipe / EngineImportPlan / AssemblyPlan 引用 / Ledger）
3. 建 `core/registry/` 三张注册表（providers / engines / mcp），**`active` 全部留 `null`**
4. 定义 Provider / Engine 能力声明格式；建 `providers/_template/`
5. 建 `bridges/registry.json` 只读视图 + 端口冲突探测

**Phase 1 — 双平台 + 构件化 + 单引擎打通**
6. 迁移 Tripo 适配器（复用 tbg-3d 已验证的调用纪律）
7. 接入混元3D（**先 `tokenhub` 通道**；`tencentcloud` 与 `web` 通道随后）
8. 打通 **路线 A（构件直生）**：提示词生成裸屋顶 → 声明式精修 → 插槽 → 入库
9. Godot 适配器跑通端到端（生成 → 拆分 → 精修 → 质检 → 包 → 导入 → 截图）

**Phase 2 — 拆分细化与第二引擎**
10. 打通 **路线 B（整栋拆分）**：语义切分 + 模数归一 + 插槽推断
11. UE5 适配器（先在注册表里选实现；零编译路线优先）
12. 装配清单编写 + 装配校验（消费 assets 侧 §19.5）
13. Engine Profile 切换 + MCP 实现切换 + 包装 `_gbe.json` 身份

**Phase 3 — 质量与成本成体系**
14. RefineRecipe 配方库覆盖主要类别与粒度
15. QA Gate 全量门禁 + 回归样本 + 容差基线（含插槽与模数判据）
16. CostLedger 账本、预算闸门、降级链

**Phase 4 — 收敛与扩展**
17. Bridge Router（工具面 530+ → ≤24）
18. 补 Meshy / fal 的深度能力（动画 / 重贴图 / 长尾模型）
19. 可选：本地开源模型自托管通道

**未排期**
- Unity 适配器（ADR-0004，抽象与字段已预留）
- Rodin 重接入（ADR-0002，注册表条目已留 `enabled: false`）

---

## 14. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 平台 API 变更/下线 | 管线中断 | 适配器隔离 + 能力声明 + 降级链；任一平台可被替换 |
| 多平台成本失控 | 超预算 | CostLedger + 三级闸门 + 出包前成本预览（强制确认）；**构件复用是最大省钱杠杆** |
| **AI 生成构件的成功率不确定** | 路线 A 可能产出垃圾 | Phase 1 先小批量试（如 20 件裸屋顶），实测成功率与可复用率；失败则回退路线 B |
| **拆分粒度定得过细** | 构件数爆炸，反而更贵 | 设"可复用率"门槛：**复用次数 < 2 的拆分无意义**，合并不拆（详见 BUILDING-DECOMPOSITION §5） |
| **quad 拓扑能力空档**（Rodin 不接入） | hero 件拓扑差 | Blender 重拓扑（Quadriflow / Instant Meshes）；hero 件数量控制在个位数 |
| 引擎 MCP 质量参差（社区项目多） | 集成不稳 | **实现注册表 + 语义动作层**：换实现 = 一条注册表记录 + 一份映射表，不改上层 |
| 工具面爆炸 | 上下文被吃光 | Engine Profile（立即可用）+ Bridge Router（终态） |
| 端口冲突（切换实现后变化） | 服务起不来 | 端口真源在 assets（`ports.json`）+ 切换时复检 + 明确报错，不静默改 |
| UE 需编译 C++ 插件 | 装机门槛高 | 注册表标注 requirements；零编译实现优先，C++ 实现作为可选 |
| **UE 轴二次转换** | 模型进引擎"躺着" | 明确责任划分：up 轴由引擎导入器转，集成层只做缩放 + 水平朝向；验收必截图 |
| 精修结果不可复现 | 无法回归 | RefineRecipe 强制声明式；交互精修须回填配方，回填不了标 `refine-unreproducible` |
| **装配引用悬空**（构件 deprecated） | 建筑拼不起来 | 装配校验硬失败；`asset deprecate` 前跑 `used-by` 影响面检查 |
| 文档多方漂移 | 双库各做各的 | 共用 `@gbe/schema`；文档镜像表由 CI 校验；变更同提交同步四处 |

---

## 15. 与 GBE-Assets 的交接

```
GBE-Studio（生产端）
  生成 → 拆分 → 精修 → QA Gate → pack
        │                              │
        │                              ├─▶ GBE 资产包（构件）
        │                              │    model.glb(+lod) + asset.json
        │                              │    + source.json（+ preview.png 512）
        │                              │         │ 投递
        │                              │         ▼
        │                              │    <gbe-assets>/inbox/<asset-id>@<version>/
        │                              │         │ assets 侧：复检 → 派生 → 索引 → move 归档
        │                              │         ▼
        │                              │    kits/<kit>/<category>/<name>/
        │                              │
        └─▶ 装配清单（assembly.v2）
                  │ 投递
                  ▼
             assemblies/<kit>/building/<name>.json
                  │ 引用构件 id + 插槽绑定
                  ▼
             GBE-Assets（仓储端）→ Web 浏览（含装配视图）/ REST API / 按引擎下载
```

详见 `gbe-assets/docs/PLAN.md`。契约细节以 `gbe-assets/docs/CONVENTIONS.md`（v1.4）为准；拆分工序见 `docs/BUILDING-DECOMPOSITION.md`。
