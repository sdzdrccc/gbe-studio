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

## [0.6.5] - 2026-10-18

### 变更
- 端口视图随 gbe-assets v0.7.0 同步（bridges/registry.json 重生成 · 新增 qiuyuan-game-ws:8080 · unity-mcp→8090）

## [0.6.4] - 2026-10-13

### 变更
- **X-0032 遗留 S 类六修**（guild 审阅卡归口 gbe-studio 的未修项；S-1/S-7 已在 v0.6.1/v0.6.2 修毕）：
  - **S-2**：端口唯一性判据改按**端口号**做键（端口是 127.0.0.1 主机级全局资源，`godot:8000` 与 `unreal:8000` 同机即冲突 —— 原 `${engine}:${port}` 键让跨引擎同端口永不触发）；合法性下界 `> 1024` → `>= 1024`（1024 是合法端口）
  - **S-3**：`sync-ports.js --check` 新增**三份副本交叉校验** —— `mcp.json` 各 implementation 的端口数字、`engines.json` 各引擎的端口 ID，都必须能在 `gbe-assets/catalog/ports.json` 真源里找到（此前 `--check` 只比对生成视图与自身，副本写错仍绿）
  - **S-4**：`by_engine` 改为从端口记录**派生**（id 第一段），不再写死四个引擎家族 —— 新引擎登记进真源即自动出现；对现有数据生成的 `registry.json` **逐字节不变**
  - **S-5**：`core/registry/providers.json` 删除 `channel_matrix` 重复字段（真源在 `providers/hunyuan3d/capabilities.json`，router 只读它；两份副本必然分歧）
  - **S-6**：**新建 `.github/workflows/ci.yml`**（version check ＋ sync-ports --check ＋ npm test，node 20/22 矩阵；同级检出 gbe-assets 并用 `GBE_ASSETS_REPO` 指过去）；README 对空壳目录按自身图例补「（留位）」标注
  - **S-8**：`sync-ports.js` 的 `SOURCE` 改为读 **`GBE_ASSETS_REPO`** 环境变量（缺省回退同级目录），与 `core/schema-ref.js` 同款 —— 此前提示让人用该变量而代码从不读它
- 测试：router.smoke **26 通过 / 0 失败**；新判据反向用例全部实测（S-2 三组 · S-3 两组 · S-8 一组，篡改均还原）

## [0.6.3] - 2026-10-13

### 变更
- AGENTS.md 追加 §6 文档地图 + §7 移动与作废（全量对推 · 与 guild §8 同源）

## [0.6.2] - 2026-10-12

### 连带同步（`gbe-assets` **ADR-0008** · `CONVENTIONS v1.5`）

- **`$` 前缀的键 = 文档性注释**这一条契约裁决落在 `gbe-assets/catalog/schema/`，本仓按 `CONVENTIONS §0` 原则 5「四份文档同提交」同步指针：`docs/PLAN.md` 的 CONVENTIONS 版本 **v1.4 → v1.5**（两处：头部与 §13 结尾）、ADR 列表补 **ADR-0008**、`README.md` 文档表的版本指针同步。
- ★ **对本仓的实际影响 —— 注册表可以正式写注释了**：`core/registry/{providers,engines,mcp}.json`、`core/policy/{fallback,budget}.json`、`bridges/registry.json`、`build/templates/tpl-hall-xieshan-double.json`、`build/procedural/material-colors.json` **共 8 份文件早就在用 `$comment`**，而它们要过的 `@gbe/schema` 此前会在概念上拒绝这种键（kit/asset 侧同理）。现在这条惯例有了契约依据，不再是"工具链违反契约"。
- ★ 顺带记一条**踩过的坑**（同一形状我这次犯了两次）：收紧判据时只验"坏样本被拦住"、不验"合法样本别被误杀"，会写出偏严判据。上一版 `R4` 就是把铁律 3 的"封闭枚举"也纳入要求，误判出"契约一条都没落地"的红 —— 铁律 3 原文只管**向后回填**的枚举，`gbe-studio` 侧的注册表同样适用这个区分。

### 变更
- 连带同步 gbe-assets ADR-0008 / CONVENTIONS v1.5：PLAN 与 README 的版本指针、ADR 列表补 0008；本仓 8 份注册表的 $comment 惯例首次有了契约依据

## [0.6.1] - 2026-10-12

### 修正（`X-0032` 的 S-1 / S-7 · `core/policy/test/router.smoke.js` 写死期望值改派生）

- **v0.6.0「已知红」那一节记录的失败已消除**：`node core/policy/test/router.smoke.js` → **26 通过 / 0 失败**。
  改法**不是把 `3` 换成 `4`**，而是把四处写死的期望值改成从真源派生：
  - **unreal / godot 的 MCP 候选** ← `core/registry/mcp.json`，判据从「数量 = 3」改为「**逐 id 与注册表相等（含顺序）**」。注册表日后增删实现不再造成假红，而实现被改名/漏登仍会被发现。
  - **降级链** ← `core/policy/fallback.json`（用例名本来就写着「读自 fallback.json」，实际却硬编码 `['meshy','fal','hunyuan3d']` —— 名字与做法不符，正是 `1a3d71f` 那类漂移的温床）。
  - **语义动作数 `8`** —— **故意保留字面量、不派生**：`8` 是 `AGENTS.md` 的契约数字，派生掉它等于"注册表擅自加第 9 个动作时没人报警"。**契约要的是 tripwire，不是同步。** 另补一条真校验：每个有 `semantic_map.json` 的引擎，其动作集必须与注册表**完全相等**（少一个 = 未映射，多一个 = 私造）。
- **新增一条注册表形状守卫**：`mcp.json` 每个实现必须**声明** `source` / `engine_version_range` / `maturity` 三键（**缺键非法，`null` / `unknown` 合法** —— `CONVENTIONS.md §20.3` 明写 `null = 未核实`，省键与写 null 是两回事，前者是逃过声明）。
  ★ 这条是**派生化之后必须补的账**：候选数量不再写死，注册表**内容**层面的偷工减料就没人管了。
- ★ **派生化的代价，写在明处**：本用例现在验的是**接线**，不是注册表内容 —— 塞进一个字段齐全但根本不该存在的实现，它不会报警（那属"注册表内容审阅"，另有归口）。
- **负例两组实测有效**（不是"应该能抓到"）：① 把路由器的候选少端一个 → `23 通过 / 2 失败`、EXIT=1；② 往 `mcp.json` 塞一个缺 `engine_version_range` 的假实现 → 新守卫报警、EXIT=1。两次篡改均已**逐字节还原**（`git diff` 空），未留残留。
- **一次自我纠正（免得后来的人以为注册表真有缺口）**：我探针初版用 `!impl.engine_version_range` 判"缺字段"，把合法值 `null` 误判成缺失，于是得出"6 个实现里 5 个没声明"的错误结论。改用 `'engine_version_range' in impl` 复查：**6 个实现三维度全部齐备**。真正缺的只有一项 —— `blender-mcp` **没有 `tool_count` 键**（其余 5 个都有，含显式 `null`）。**未修**：`tool_count` 不在 `§20.3` 三维度表里，补它属数据裁决，登记为遗留。

### 遗留（本版未办）

- `blender-mcp` 缺 `tool_count`；`mcp.json` 里该字段无契约约束（`§20.3` 只规定三维度）⇒ 要么补数据，要么把 `tool_count` 写进 `§20.3` 再统一校验。
- S-2（端口唯一性按引擎限定、漏检跨引擎冲突 · `port > 1024` 把 1024 误判非法）· S-3～S-6 —— 大人本次只点了 S-1 / S-7，其余未动。

### 变更
- router.smoke 四处写死期望值改为从真源派生（S-1/S-7）· 新增 mcp.json 三维度缺键守卫 · 26 通过 0 失败，v0.6.0 的已知红已消

## [0.6.0] - 2026-10-12

### 新增

- **`build/convergence/reconcile.js`：§9.2 构件表 ↔ `forms.js` ↔ `kit.json` 三方对账哨兵**（8 类核对：① 代码要的件必须在表内 ② 表内行必须有人消费（孤儿件）③ 已入库的件必须在表内登记 ④ **来源标注两向单调**——标 B 的件必须真是 hero 专属、且未入库的 hero 专属件必须标 B ⑤ 标 P 的件不许有生成债 ⑥ `coverage.*.planned` 逐类别 = 表内该类行数、加总 = 表总行数 ⑦ §9.1 数量列 = `forms.count` 且形制名一一对上、`assemblies` 规划数 = 形制数 ⑧ 行号连续不重不复）。漂移即 `exit 1`，`--json` 可接 CI。**首跑即抓到 `gbe-assets` 的 roof `planned` 停在 13（表已 18）、`planned` 加总 45 ≠ 50。**
  ★ ④⑤ 两条**刻意不写成等号**：hero 件一旦随拆分入库、量产件一旦补生成，等号判据会开始误报 —— 会狼来了的门禁最后等于没有门禁。
  为什么现在补：`forms.js` 顶部注释写着「取值需随 §9.1 / §9.2 更新」，但这条纪律**没有任何执行机制**，全靠人记得 —— 而 §9.2 漏 5 件屋顶样式件的那 **19 天**（v0.5.1 `2026-09-23` → 今日），就是这条纪律空转的实测后果。
- `BUILDING-DECOMPOSITION.md` **§9.4 M4 首批场景：槐阴村（村落配比）** + **§9.5 完整生成队列（待生成 32 件）**。§9.4 用设定页 `虬渊大陆/05-地点/槐阴村.md` 逐项对齐村中物（民居 / 矮墙 / 学堂 / 老槐 / 土路 / 废洞药圃 / 道具 / 测灵盘），实测出 **M4 的构件缺口 6 件（≈180 credit · 相对当前 18 件库实算）**，真缺口在 `props/*` `nature/*` `terrain/*` 那 **8 个连 `planned` 都没定义的类别**（= 从未规划）。数量列全部标 **⚠️ 推导**（设定页没有任何建筑数量）。

### 修正（§9.2 那 5 件屋顶样式件，从「勘误文字」升格为「表内行」：45 类 → 50 类）

- **`BUILDING-DECOMPOSITION.md` §9.2 补入 38–42 行**：`yingshan-single-a`（硬山）/ `xuanshan-single-a`（悬山）/ `cuanjian-single-a`（攒尖）/ `wudian-single-a`（庑殿）/ `luding-single-a`（盝顶）。**v0.5.1 只做到"登记缺口"** —— 那条「§9.2 补勘误」原文止于「两处口径未对齐」，5 件仅记进 `forms.js` 的 `extra`，**没落成表内行**；本次落成，表规模 **45 → 50 类**。
- **`§0` / `§1.2(a)` / `§1.2(c)` / `§9.2` 标题 / `§9.2` 预算行**的「45」全部改 50（此前四处断言没跟着 forms.js 走）。路线分布改写为 **P 18 / A 27 / B 5**（旧「B 恒为 0」那两条勘误的计数单位结论保留、来源标注另立）。
- **§1.2(a) 的逐栋基线从 25 栋改 28 栋**：§9.1 数量列**实加 = 28**（1+4+2+8+5+3+2+3），而全文按 25 栋算账 —— 逐栋 1375 → **1540 credit**。构件化的回本结论**没变**（前 10 栋已 2475 > 28 栋逐栋 1540），警示框原样保留。
- **建库 975 credit 这个数字没变，但构成变了**（新 27 = 旧 27 + 4 件量产屋顶 − 4 件 hero 专属件）。旧口径少算 4 × 30 = 120、又多算 4 件，两笔在 975 上打平——**是巧合，不是原来的账对**，已在 §9.2 预算行写明。
- **§9.3 批次表新增「就绪态（实测）」列**：原表把批 1 写成「20 件裸屋顶 + 18 件程序化 → 38 件入库」，读起来像 38 件已落地；实测 **18 / 23**（屋顶样式件 **0 件生成**）。「计划」与「就绪」从此分列。
- **旧「20 件裸屋顶（五样式）」的 20 与件集都无来源可对**：§9.2 屋顶段可核对 18 件，§5.1 的原型「五样式」是悬山/歇山/庑殿/攒尖/盝顶（含歇山、不含硬山），与补漏 5 件**既不同数也不同集** —— 改为按 §9.2 可核对件数表述，不再沿用 20。
- **§9.3 批 2 验收点「缺失构件补齐」改为可验判据**：实际入库的全新型件数必须 **= 纸面预测值**（配殿 18 / 民居 3 / 商铺 1 / 廊 0 / 亭 3 / 牌坊 2）。原写法没有目标值，验收会退化成"做完了"；而批 2 恰是第一次实测，偏离本身是要采集的数据（§10.5(c) 自陈的头号偏差）。
- **§10.5(c) / §9.2 的件名定为唯一口径**：`forms.js` 的 `parts` 短名 = asset id 第三段 = §9.2 行，**短名即键**；`EXTRA_NOTE` / `extra` 字段随 5 件入表而**退役**（旧"只存在于代码、不在文档"的补丁机制不再需要，对账交给 `reconcile.js`）。
- **删除「万安城」**（大人裁决）：该场景名在设定库 `虬渊大陆` **0 命中**，属 gbe 侧自造代号。§9 节名改「虬渊大陆落地计划（M4 村落 · 远期城邑）」，`§0`/`§1.2`/`§8` 的"万安城"改为「城邑 / 北桢洲城邑」，批 4 交付改「北桢洲城邑可运行场景（具体是哪座城由 guild 定）」。
  ⚠️ **未顺手改的残留**：已发布资产 id `cn-ancient.assembly.wanan-wall-corner-a`、`build/templates/` 里的示例 id `wanan-hall-main`、`packages/schema/test/smoke.js` 的测试夹具名 —— **id 不可变**，改名属破坏性变更，须另开 ADR + 发版。

### 裁决落地（hero 档：从「阈值悬空」改为「卡来源、不卡件数」）

- §10.5(b) 的 `≤3` vs `≤6` 悬案**作废**（大人裁：两个数字卡的都不是真正要紧的东西）。改为：**hero 形制不设全新型件数门槛，卡来源** —— 只被 hero 形制消费**且尚未入库**的 5 件（`jinzhu-round-a` / `xieshan-lower-eave-a` / `xieshan-upper-ridge-a` / `tile-field-cylinder` / `wudian-single-a`）**必须由整栋拆分（路线 B）产出，禁止另开 AI 直生**；判定同时卡复用比 3–15。
  这条同时**补上 §8 缺的那半句前提**：`BUILDING-DECOMPOSITION` §8 声称「主殿（7 开间）与配殿（5 开间）是同一模板的两个参数组合」，而这条收益**依赖 hero 独特件留在构件库里**（重檐必须是可引用的构件，`story_count` 参数才成立）。原先 §8 一字未提，读 §8 的人不知道它有这个前提 —— 已在 §8 补注。
  ⚠️ **实测纠偏**：「只被 hero 消费」的件是 **7** 件不是 5 件，另 2 件（`plinth-lotus-a` / `liang-seven-purlin`）**已随程序化入库**，不属 B 路。判据写成「未入库的 hero 专属件」，且该集合**由 `forms.js` 自动推导**（`heroExclusiveParts()`），不手填名单。
- **`forms.js` 的 `THRESHOLDS.hero` 从 `6` 改为 `null`**（代码不再自用一个文档没承认的数——那正是"两份真源并存"的事故形状）；`report.js` 的 hero 判定改走来源检查，量产仍卡 `≤3`。§9.3 的「⚠️ 待裁决」框与 §10.5(b) 的「⏳ hero 档阈值待裁决」注同步收敛为裁决记录。
- **§11 抬高了一条真实风险**：来源裁决让路线 B 从"顺手做局部"变成 **5 件 hero 构件的唯一来源**——拆分一失败，hero 就没有产物来源。故「整栋语义切分失败」那一行的对策改为**手工选择集切分 + 记录配方**，并写明**仍失败就回 §10.5(b) 重裁，不许在执行时自行放宽**。

### 已知红（★ 存量 · **非本版引入** · 发版时如实带过，未修）

- `node core/policy/test/router.smoke.js` → **24 通过 / 1 失败**：
  ```
  ✗ unreal：可用，但 MCP 实现未选择 → 给出引导警告
        应列出 3 个候选实现      4 !== 3
  ```
  **成因不在本次**：本次只动 `docs/` 与 `build/convergence/`，`core/` 与 `core/registry/` 一字未改（`git status --short core/` = 空）。
  失败是**上一笔已发布提交 `1a3d71f`「官方 Unreal MCP 进注册表」**把 unreal 的候选实现从 3 个加成 4 个，而用例断言（`router.smoke.js` L185，自初始骨架 `5a3180c` 起未再改动）仍写 3。
  **为什么不顺手改成 4**：断言值 3 是判据、不是计数器的返回值 —— 把它改成 4 等于**由发版方单方面认定"4 个候选是本来意图"**。若官方实现本不该进 unreal 候选集（或该有一条 `maturity: unknown` 被排除在外），改断言就把注册表错配洗成绿灯了。**要修就得连注册表一起判，须单开一卡。**
  ⇒ 本版**带红发版**，理由记在此处；`AGENTS.md` §4 的「router.smoke 全绿」前置**本版未满足**，不得被后人读成"当时是全绿的"。

### 变更
- §9.2 构件表补 5 件屋顶样式件（45→50 类）· 新增 §9.4 M4 槐阴村配比与 §9.5 生成队列 · hero 档改卡来源不卡件数 · 新增三方对账哨兵 reconcile.js · 删除万安城

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
