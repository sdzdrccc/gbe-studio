'use strict';

/**
 * Policy Router 冒烟测试 —— node core/policy/test/router.smoke.js
 * 覆盖：primitive 短路 · tier 优先表 · 多通道解析 · 降级链 · 成本闸门 · 平台禁用 · 引擎 deferred。
 */

const assert = require('assert');
const rt = require('../router');

const REG = rt.loadAll();

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
  assert.deepStrictEqual(r.downgrade_chain, ['meshy', 'fal', 'hunyuan3d']);
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
  assert.strictEqual(r.mcp_candidates.length, 3, '应列出 3 个候选实现');
});

ok('godot：可用，MCP 候选 1 个', () => {
  const r = rt.resolveEngine('godot', REG);
  assert.ok(r.ok);
  assert.strictEqual(r.mcp_candidates.length, 1);
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
  assert.strictEqual(REG.engines.semantic_actions.length, 8);
  assert.ok(REG.engines.semantic_actions.includes('viewport_capture') === false);
  assert.ok(REG.engines.semantic_actions.includes('importAsset'));
});

// ---------------------------------------------------------------------------
console.log('\n[7] 注册表一致性（禁止第二份真源）');
// ---------------------------------------------------------------------------

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
