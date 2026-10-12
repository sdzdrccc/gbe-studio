'use strict';

/**
 * Policy Router 冒烟测试 —— node core/policy/test/router.smoke.js
 * 覆盖：primitive 短路 · tier 优先表 · 多通道解析 · 降级链 · 成本闸门 · 平台禁用 · 引擎 deferred。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rt = require('../router');

const REG = rt.loadAll();

// ---------------------------------------------------------------------------
// ★ 期望值一律从**真源**派生，不写死数字（X-0032 的 S-1 / S-7）。
//   本文件的职责是验**接线**：路由器是否把注册表的内容如实端出来 —— 而不是把
//   注册表某一天的快照复述成断言。写死值在注册表更新那天就会变成假红或假绿：
//   `1a3180c` 之后 `1a3d71f` 加了第 4 个 unreal 实现、漏同步这里，就是实录
//   （v0.6.0 的 CHANGELOG「已知红」节记着这件事）。
//   ★ 唯一**故意**保留的字面量是语义动作数 `8`：那是 `AGENTS.md` 的契约数字，
//     派生掉它 = 注册表擅自加第 9 个动作时没人报警。**契约要的是 tripwire，不是同步。**
// ---------------------------------------------------------------------------

const providerIds = () => REG.providers.providers.map((p) => p.id);
/** 某引擎在 mcp.json 里登记的实现 id 列表（顺序即注册表顺序） */
const mcpImplIds = (engineId) =>
  (((REG.mcp.engines || {})[engineId] || {}).implementations || []).map((i) => i.id);
/** 有 semantic_map.json 的引擎目录 */
const enginesWithSemanticMap = () =>
  fs
    .readdirSync(path.join(__dirname, '../../../engines'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => fs.existsSync(path.join(__dirname, '../../../engines', n, 'semantic_map.json')));

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n      ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n[1] primitive 短路（拆分层最大的省钱杠杆）');
// ---------------------------------------------------------------------------

ok('tier=primitive 不进 AI 队列，成本 0', () => {
  const r = rt.route({ tier: 'primitive', mode: 'text' }, REG);
  assert.ok(r.ok);
  assert.strictEqual(r.provider, 'procedural');
  assert.strictEqual(r.cost_estimate, 0);
});

ok('程序化构件不会路由到任何付费平台', () => {
  for (const tier of ['primitive']) {
    for (const id of ['tripo', 'meshy', 'hunyuan3d', 'fal']) {
      const r = rt.route({ tier, mode: 'text', provider_hint: id }, REG);
      assert.notStrictEqual(r.provider, id, `primitive 不应路由到 ${id}`);
    }
  }
});

// ---------------------------------------------------------------------------
console.log('\n[2] tier 优先表');
// ---------------------------------------------------------------------------

ok('component → tripo（默认主力）', () => {
  const r = rt.route({ tier: 'component', mode: 'text', granularity_target: 'L2' }, REG);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.strictEqual(r.provider, 'tripo');
});

ok('hero → meshy（tier_preference 命中）', () => {
  const r = rt.route({ tier: 'hero', mode: 'text' }, REG);
  assert.ok(r.ok);
  assert.strictEqual(r.provider, 'meshy');
});

ok('mass → tripo（tier_preference 含 mass，priority 更小）', () => {
  const r = rt.route({ tier: 'mass', mode: 'text' }, REG);
  assert.ok(r.ok);
  assert.strictEqual(r.provider, 'tripo');
});

// ---------------------------------------------------------------------------
console.log('\n[3] 多通道解析（ADR-0003）');
// ---------------------------------------------------------------------------

ok('hunyuan3d 默认走 tokenhub 通道', () => {
  const r = rt.route({ tier: 'component', mode: 'text', provider_hint: 'hunyuan3d' }, REG);
  assert.ok(r.ok);
  assert.strictEqual(r.provider, 'hunyuan3d');
  assert.strictEqual(r.channel, 'tokenhub');
});

ok('需要 geometry_only 白模 → 自动切到 tencentcloud 通道', () => {
  const r = rt.route({
    tier: 'component',
    mode: 'text',
    provider_hint: 'hunyuan3d',
    constraints: { geometry_only: true },
  }, REG);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.strictEqual(r.provider, 'hunyuan3d');
  assert.strictEqual(r.channel, 'tencentcloud');
  assert.ok(/geometry_only/.test(r.reason));
});

ok('geometry_only 请求会剔除不支持白模的平台（tripo/meshy/fal）', () => {
  const r = rt.route({ tier: 'component', mode: 'text', constraints: { geometry_only: true } }, REG);
  assert.ok(r.ok);
  assert.strictEqual(r.provider, 'hunyuan3d');
  const rejected = r.considered.filter((c) => !c.ok).map((c) => c.provider);
  assert.ok(rejected.includes('tripo') && rejected.includes('meshy') && rejected.includes('fal'));
});

// ---------------------------------------------------------------------------
console.log('\n[4] 平台禁用与降级');
// ---------------------------------------------------------------------------

ok('rodin 已禁用，永不被选中（ADR-0002）', () => {
  const r = rt.route({ tier: 'hero', mode: 'text' }, REG);
  assert.notStrictEqual(r.provider, 'rodin');
  const rodin = r.considered.find((c) => c.provider === 'rodin');
  assert.ok(rodin && !rodin.ok);
});

ok('provider_hint=rodin 时降级并给出警告', () => {
  const r = rt.route({ tier: 'hero', mode: 'text', provider_hint: 'rodin' }, REG);
  assert.ok(r.ok);
  assert.notStrictEqual(r.provider, 'rodin');
  assert.ok(r.warnings.some((w) => /rodin/.test(w)));
});

ok('降级链读自 fallback.json，且不含 rodin', () => {
  const r = rt.route({ tier: 'component', mode: 'text' }, REG);
  // 路由器只按「在册」过滤，不按 enabled 过滤（L254）⇒ 期望值就是这份派生集
  const expected = REG.fallback.chain.filter((id) => providerIds().includes(id));
  assert.deepStrictEqual(r.downgrade_chain, expected, '降级链必须等于 fallback.json 声明的链（改链只改那个文件）');
  assert.ok(!r.downgrade_chain.includes('rodin'), 'rodin 不得进链（ADR-0002）');
  // ★「链中平台必须 enabled」已由 [7] 的同名用例守，这里**不再重复一遍**（同一事实不写两处）
});

ok('tripo 未登录 → 回退到 hunyuan3d', () => {
  const r = rt.route({
    tier: 'component',
    mode: 'text',
    runtime: { tripo: { authenticated: false } },
  }, REG);
  assert.ok(r.ok);
  assert.strictEqual(r.provider, 'hunyuan3d');
});

ok('tripo 区域封锁 → 剔除', () => {
  const r = rt.route({
    tier: 'component',
    mode: 'text',
    runtime: { tripo: { region_blocked: true } },
  }, REG);
  assert.ok(r.ok);
  assert.notStrictEqual(r.provider, 'tripo');
  assert.ok(r.considered.find((c) => c.provider === 'tripo' && !c.ok));
});

// ---------------------------------------------------------------------------
console.log('\n[5] 形态约束与成本闸门');
// ---------------------------------------------------------------------------

ok('quad 拓扑：无平台支持 → 失败并给出重拓扑替代路径', () => {
  const r = rt.route({ tier: 'hero', mode: 'text', constraints: { topology: 'quad' } }, REG);
  assert.ok(!r.ok);
  assert.ok(r.hint.join('').includes('retopo'), '应提示改走 Blender 重拓扑');
});

ok('面数超各平台上限 → 失败', () => {
  const r = rt.route({ tier: 'hero', mode: 'text', constraints: { face_limit: 500000 } }, REG);
  assert.ok(!r.ok);
});

ok('成本闸门：所有平台超预算 → 拒绝出包', () => {
  const cheapReg = JSON.parse(JSON.stringify(REG));
  cheapReg.budget.per_asset_max.component = 1;
  const r = rt.route({ tier: 'component', mode: 'text' }, cheapReg);
  assert.ok(!r.ok);
  assert.ok(/成本闸门/.test(r.reason) || r.errors.length > 0);
});

ok('余额低于预估成本 → 该平台被剔除', () => {
  const r = rt.route({
    tier: 'component',
    mode: 'text',
    runtime: { tripo: { balance: 5 } },
  }, REG);
  assert.ok(r.ok);
  assert.notStrictEqual(r.provider, 'tripo');
});

// ---------------------------------------------------------------------------
console.log('\n[6] 引擎解析（含 deferred 明确报错，ADR-0004）');
// ---------------------------------------------------------------------------

ok('unreal：可用，但 MCP 实现未选择 → 给出引导警告', () => {
  const r = rt.resolveEngine('unreal', REG);
  assert.ok(r.ok);
  assert.strictEqual(r.mcp_impl, null);
  assert.ok(r.warnings.some((w) => /MCP 实现尚未选择/.test(w)));
  // ★ 不写数量：候选必须**逐 id 等于** mcp.json 里 unreal 的实现表（注册表加/删/改名都会在这里被发现）
  assert.deepStrictEqual(r.mcp_candidates, mcpImplIds('unreal'), '候选须与 mcp.json 的实现表逐 id 相等');
  assert.ok(r.mcp_candidates.length >= 1, 'unreal 至少要有一个候选');
});

ok('godot：可用，MCP 候选与注册表一致', () => {
  const r = rt.resolveEngine('godot', REG);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.mcp_candidates, mcpImplIds('godot'), '候选须与 mcp.json 的实现表逐 id 相等');
});

ok('unity：deferred → 明确报错，不静默跳过', () => {
  const r = rt.resolveEngine('unity', REG);
  assert.ok(!r.ok);
  assert.ok(/引擎未启用/.test(r.errors[0]));
  assert.ok(/延后/.test(r.errors[0]));
});

ok('未知引擎 → 报错', () => {
  const r = rt.resolveEngine('cryengine', REG);
  assert.ok(!r.ok);
});

ok('8 个语义动作是引擎适配层的稳定接口', () => {
  // ★ 这个 8 是 **AGENTS.md 的契约数字**（`engines/base.js` 的 8 个语义动作），**故意不从注册表派生**：
  //   派生掉它，注册表哪天加了第 9 个动作就没人报警。要改这个数，得先改 AGENTS.md，不是改这里。
  assert.strictEqual(REG.engines.semantic_actions.length, 8, '语义动作数 = 8（契约 · 改动须先动 AGENTS.md）');
  assert.ok(REG.engines.semantic_actions.includes('importAsset'));
  // 反向：适配层侧每个有 semantic_map 的引擎，动作集必须与注册表**完全相等**（少一个 = 未映射，多一个 = 私造）
  for (const name of enginesWithSemanticMap()) {
    const map = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../../engines', name, 'semantic_map.json'), 'utf8')
    );
    const actions = Object.keys(map.actions || {});
    assert.deepStrictEqual(
      [...actions].sort(),
      [...REG.engines.semantic_actions].sort(),
      `engines/${name}/semantic_map.json 的动作集与注册表不一致`
    );
  }
});

// ---------------------------------------------------------------------------
console.log('\n[7] 注册表一致性（禁止第二份真源）');
// ---------------------------------------------------------------------------

ok('mcp.json 每个实现都声明 ADR-0007 的三维度（**缺键非法，null / unknown 合法**）', () => {
  // ★ 这条是「派生化之后」补回来的报警：候选数量不再写死，所以注册表**内容**层面的偷工减料
  //   得有地方拦。判据只认「键在不在」——`CONVENTIONS.md §20.3` 明写 `null = 未核实`、
  //   `unknown = 未核实，不允许猜一个体面的值`，**省键**与**写 null** 是两回事：前者是逃过声明。
  const REQUIRED = ['source', 'engine_version_range', 'maturity'];
  const SOURCE = ['first-party', 'community'];
  const MATURITY = ['experimental', 'beta', 'stable', 'unknown'];
  for (const [engineId, entry] of Object.entries(REG.mcp.engines)) {
    for (const impl of entry.implementations || []) {
      for (const k of REQUIRED) {
        assert.ok(k in impl, `${engineId}/${impl.id} 缺键 \`${k}\`（未核实要写 null / unknown，不许省）`);
      }
      assert.ok(SOURCE.includes(impl.source), `${impl.id} 的 source 取值非法：${impl.source}`);
      assert.ok(MATURITY.includes(impl.maturity), `${impl.id} 的 maturity 取值非法：${impl.maturity}`);
    }
  }
});

ok('注册表中 enabled 的平台都有 capabilities.json', () => {
  for (const p of REG.providers.providers) {
    if (p.enabled && p.capabilities) {
      assert.ok(REG.capabilities[p.id], `${p.id} 缺少 capabilities`);
    }
  }
});

ok('fallback 链中的平台都是 enabled', () => {
  const enabledIds = REG.providers.providers.filter((p) => p.enabled).map((p) => p.id);
  for (const id of REG.fallback.chain) {
    assert.ok(enabledIds.includes(id), `降级链中的 ${id} 未启用`);
  }
});

ok('mcp.json 中每个实现声明的端口都在期望范围内', () => {
  const seen = new Set();
  for (const [engine, entry] of Object.entries(REG.mcp.engines)) {
    for (const impl of entry.implementations) {
      for (const port of impl.ports || []) {
        assert.ok(port > 1024 && port < 65536, `${engine}/${impl.id} 端口非法：${port}`);
        const key = `${engine}:${port}`;
        assert.ok(!seen.has(key), `端口重复：${key}`);
        seen.add(key);
      }
    }
  }
});

// ---------------------------------------------------------------------------
console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`);
process.exit(failed === 0 ? 0 : 1);
