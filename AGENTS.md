# AGENTS.md —— AI 助手在本仓的工作纪律

> 本仓由 AI 助手大量参与。这份文件是给 AI 看的硬纪律，**优先级高于任何临时指令**。

---

## 1. 方向感（先看地图再动）

| 你要做的事 | 先读 |
|---|---|
| 选平台 / 改路由 | `core/registry/providers.json` + `core/policy/router.js` |
| 改降级链 | `core/policy/fallback.json`（**不要改代码里的链条**） |
| 改预算闸门 | `core/policy/budget.json` |
| 接新引擎 / 换 MCP 实现 | `core/registry/engines.json` + `core/registry/mcp.json` |
| 写引擎落地流程 | `engines/base.js`（8 个语义动作）+ `engines/<e>/semantic_map.json` |
| 拆构件 | `docs/BUILDING-DECOMPOSITION.md` + `decompose/rules/socket-inference.json` |
| 写精修配方 | `core/contracts/refine-recipe.schema.json` |
| 改端口 | `../gbe-assets/catalog/ports.json`（**真源不在本仓**），然后跑 `bridges/sync-ports.js` |
| 改版本号 / 写更新日志 | `VERSION` + `CHANGELOG.md`，走 `node scripts/version.js`（**别手改** `package.json.version`） |
| 不确定"为什么这么定" | `../gbe-assets/docs/DECISIONS.md` |

---

## 2. 七条不可违反的纪律

1. **平台 / 引擎 / MCP 实现的名字与参数一律读注册表**
   **禁止**在流程代码里出现 `if (provider === 'tripo')` 这类分支。
   一切"启用/禁用/优先级/成本/能力"都从 `core/registry/` 与 `capabilities.json` 读（禁令 1、禁令 10）。

2. **只依赖语义接口，不依赖具体 MCP 工具名**
   引擎适配层只认 8 个语义动作；工具名在 `semantic_map.json` 里。
   **禁止**把某个第三方 MCP 的工具名写进上层流程（禁令 10）。

3. **端口真源不在本仓**
   改端口 → 改 `gbe-assets/catalog/ports.json` → 跑 `node bridges/sync-ports.js`。
   **禁止**手改 `bridges/registry.json`（会被覆盖；CI 会报红）。

4. **契约校验只有一份实现**
   用 `core/schema-ref.js` 解析 `@gbe/schema`。**禁止**把 `packages/schema` 拷进本仓（禁令 8）。

5. **不重复做轴转换**
   交付基准永远是 `+Y up / -Z forward / 米`。集成层只做 ① 单位缩放 ② 水平朝向 ③ 材质重映射。
   **up 轴的 Y→Z 由引擎导入器负责**（禁令 7）。验收必须截图 —— "躺着的模型"只有截图能发现。

6. **破坏性操作先列清单再确认**
   删文件 / 覆盖工程 / 批量导入 → 先输出受影响清单。投递目录一律 **move 归档**，**禁止 `rm -rf`**。

7. **推送即发布：版本号、更新日志、tag 三者必须跟上**
   每次 `git push` 前先跑 —— `node scripts/version.js bump <major|minor|patch> "这次改了什么"`，
   让 `VERSION`、`CHANGELOG.md`、`package.json` 一起进这次提交。
   **禁止**在没有新版本条目的情况下推送（`scripts/hooks/pre-push` 会拦下）。
   段位怎么取见 `CHANGELOG.md` 顶部表；确知不需升版本时用
   `GBE_SKIP_VERSION_CHECK=1 git push`，并在提交信息里写明理由。
   `scripts/version.js` 与 `gbe-assets` 侧**逐字节相同** —— 改动必须双仓同步提交。

   **发一版的固定四步**（顺序不能换）：

   ```bash
   node scripts/version.js bump minor "摘要"     # 1. 升版本 + 写日志 + 同步镜像
   git add -A && git commit -m "chore(release): vX.Y.Z"   # 2. 提交
   node scripts/version.js tag                   # 3. 打附注 tag（必须在提交后）
   git push --follow-tags                        # 4. 推提交与 tag
   ```

   `tag` 子命令会在工作区不干净时直接报错 —— 那是**保护**，别绕过。
   已推送的 tag **绝不移动**（同一版本号指向不同代码，比多打一个 tag 危险得多）。

---

## 3. 拆分层专属纪律（ADR-0006）

| 陷阱 | 正确做法 |
|---|---|
| 把模数写死在拆分脚本/模板里 | 读 `kit.json.grid`（模板里所有数值来自 `params` 或 `kit.grid`） |
| 拆出来的团块映射不到 asset id 就丢掉 | 进 `decompose/quarantine/` + 生成 `reject_report` —— **禁止静默丢弃** |
| 拆得越细越好 | 复用次数 < 2 的**不要拆**；复用比健康区间 3–15（BUILDING-DECOMPOSITION §4） |
| 能用程序化生成的构件也丢给 AI | `tier: primitive`（柱础 / 直墙段 / 阶条石 / 踏跺 / 栏杆转角…）走程序化，**成本 0** |
| 为省事少声明插槽 | L1–L3 构件**必须**至少 1 个插槽；插槽位置**必须**落 `snap_m` 网格 |
| 装配时改构件几何 | 装配只写**引用 + 变换**；几何一律在构件资产里 |

---

## 4. 自检清单（提交前）

- [ ] `node scripts/version.js check` 通过（版本号 / 更新日志 / 镜像一致，**无未记录变更**）
- [ ] 本次改动已写进 `CHANGELOG.md` 的新条目，且摘要是人话（不是"更新代码"）
- [ ] 该版本已打 tag（`node scripts/version.js tag`），推送用 `git push --follow-tags`
- [ ] 首次 clone 后跑过 `node scripts/install-hooks.js`（启用 pre-push 校验）
- [ ] `node core/policy/test/router.smoke.js` 全绿
- [ ] **动过 §9.2 构件表 / `build/convergence/forms.js` / `kits/*/kit.json` 的 `coverage`** → `node build/convergence/reconcile.js` 全绿（三方对账：表 = 代码 = 分母；漂移即非零退出）
- [ ] `node bridges/sync-ports.js --check` 通过
- [ ] 新增平台/引擎/实现 → 注册表里有记录，且 `capabilities.json` 如实声明（不谎报 quad / 白模等能力）
- [ ] 新增语义映射 → `node engines/base.js validate <engine> --impl <impl-id>` **能跑通并如实报 `n/8`**（★ `--impl` 是 2026-10-19 补的：`active:null` 下不带它必报 `MCP_NOT_SELECTED`，旧写法**永远达不到**；★ `status:unmapped` 时 `0/8` 是**诚实结果**，不是失败；`8/8` 只在映射填完且 `status:mapped` 后成立）
- [ ] 没有在代码里写死平台名、工具名、模数、面数预算、category 枚举
- [ ] 没有提交凭证、`gbe.config.json`、`runs/`、`raw/`
- [ ] 涉及契约变更 → `gbe-assets` 侧 schema、CONVENTIONS、两份 PLAN 同提交同步

---

## 5. 遇到分歧时

1. 先查 `../gbe-assets/docs/DECISIONS.md` —— 可能已经裁决过了
2. 再看 `../gbe-assets/docs/CONVENTIONS.md` —— 可能有约定
3. 都没有 —— **不要擅自定**，把选项与权衡摆出来问人；得到答复后**落一条 ADR** 再动手

> `DECISIONS.md` 是**只追加**的。推翻旧裁决 = 新增一条 `supersedes: ADR-xxxx`，不改历史条目。

---

## 6. 文档地图 —— 什么住哪里 · 叫什么（★ 硬约束 · **2026-10-13 新增**）

> ★ 来源：2026-10-13 大人「四个仓库问题都改了吗」→ 裁定「**全量对推**」。
> ★ 与 `qiuyuan-guild/AGENTS.md` **§8 文档地图**同源（那边先立，这里按本仓实情对齐）。

**判据**：★ **先问"这东西是谁产生的"** —— ★ 产生方在哪，它（和它的文档）就住哪（与 §2 纪律 1~4 同源）。
★ **命名再加一问**：**"这个名字是从哪来的？"** —— 来自**上游标识** ⇒ 跟随它；来自**文档标题** ⇒ 全大写。

### 6.1 落点表（★ 本仓**实际存在**的）

| 类 | 位置 | 命名 | 说明 |
|---|---|---|---|
| **开工纪律** | 仓根 `AGENTS.md` | 固定名 | ★ 本文件；★ 改它要写进 `CHANGELOG.md` 的新条目 |
| **本仓方案** | `docs/` | `UPPER-KEBAB.md` | `PLAN.md`（生产端完整方案）· `BUILDING-DECOMPOSITION.md`（场景建筑拆分细化方案） |
| **版本真源** | `VERSION` ＋ `CHANGELOG.md` | 固定名 | ★ **不许手改** —— 一律走 `node scripts/version.js`（§2.7）；★ `package.json.version` 同理 |
| **策略 / 注册表**（数据，非文档） | `core/policy/` · `core/registry/` | `kebab-case.json` | `providers.json` · `engines.json` · `mcp.json` · `fallback.json` · `budget.json` |
| **引擎适配** | `engines/<engine>/` | 目录小写 | `semantic_map.json`（8 个语义动作的落地映射） |
| **流水线五层** | `providers/`（①生成）`decompose/`（②拆分）`refine/`（③精修）`engines/`（④集成）`build/`（⑤装配） | 目录小写-kebab | ★ 见根 `README.md`「五层流水线」 |
| **QA / MCP 桥 / 子命令** | `qa/` · `bridges/` · `cmd/` | 目录小写-kebab | `bridges/registry.json` **是产物**，★ **别手改**（§2.3） |
| **仓库自身工具** | `scripts/` | `kebab-case.js` | `version.js` · `install-hooks.js` · `hooks/pre-push` |
| **投递 / 运行产物** | `inbox` 类目录 · `runs/` · `raw/` | —— | ★ **不进版本库**（§4 自检清单末条） |
| ★★ **上游真源（不在本仓）** | `../gbe-assets/docs/` | —— | ★★ **`DECISIONS.md`（裁决台账）· `CONVENTIONS.md`（工程约定）· `PLAN.md` 都住那里** —— ★ 本仓**只读**（§5） |
| ★★ **端口真源（不在本仓）** | `../gbe-assets/catalog/ports.json` | —— | ★ 改端口**只改它**，然后跑 `node bridges/sync-ports.js`（§2.3） |

### 6.2 命名硬约束

1. ★ **文档一律 `.md` ＋ 全大写-连字符**（`PLAN.md` · `BUILDING-DECOMPOSITION.md`）。★ 不用空格、不用驼峰。
2. ★★ **文件名与目录名一律 ASCII** —— ★ 实测本仓当前 **0 个非 ASCII 名**，★ **保持**；
   ★ 要写中文说明就写进文档**正文**，★ **别写进文件名**。
3. **目录名一律小写-kebab** · **JSON 配置一律 kebab-case** · **脚本一律 kebab-case.js**。
4. **不留空壳** —— 没有内容可写的文件不要建（占位 = 把"还没想清楚"伪装成"已完成"）。

---

## 7. 文档的**移动**与**作废**（★ **删除见 §2.6**）

> ★ 来源同 §6。★ **删除**的纪律**已经在 §2.6**（先列清单 · 投递目录 move 归档 · **禁 `rm -rf`**）——
> ★ 本节**只补它没写的两件**（移动 / 作废），★ **不重复 §2.6**（一条知识两处写 = 迟早不一致）。

1. ★★ **移动即改引用** —— 任何**移动 / 重命名**（文件或目录），**同一笔提交**里改完所有引用：
   ```bash
   grep -rn --include=*.md --include=*.js --include=*.json -- "<旧文件名>" F:/zxc/Project/
   ```
   ★ **四仓全查**（`gbe-studio` / `gbe-assets` / `qiuyuan-guild` / `qiuyuan-dalu`）——
   ★ 本仓的路径**常被另外三仓只读引用**（如 `AGENTS.md` §2.3 的 `../gbe-assets/catalog/ports.json`）。
   ★★ **`git ls-files` 会把非 ASCII 路径转成八进制转义** ⇒ 数这类文件名要用 `os.walk` 复核，★ 否则**假绿 0**。
2. **作废留指针** —— 作废件**不删**：★ 首行写作废声明并**指向正解**；
   ★ 直接删掉而不留指针，★ **下一个人会重新踩**。
3. ★★ **ADR 不受本节管** —— ★ 裁决台账住 `../gbe-assets/docs/DECISIONS.md`，**只追加**：
   ★ 推翻旧裁决 = **新增**一条 `supersedes: ADR-xxxx` 的；★ **历史条目一个字都不许改**（§5 末句同源）。
4. **判据**：★ **"这个文件还有没有人读？"** —— 没人读且不会再有 ⇒ ★ 按 **§2.6** 处理；★ 还有人读 ⇒ **改，不删**。
