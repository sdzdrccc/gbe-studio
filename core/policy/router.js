'use strict';

/**
 * Policy Router —— 平台选择策略（PLAN §5.2）。
 *
 * 设计约束（三条都来自 CONVENTIONS 禁令）：
 *   1. 平台名、优先级、成本、能力【全部读注册表与 capabilities.json】，代码里不写死任何一家（禁令 1）。
 *   2. 降级链只读 core/policy/fallback.json，改链条不改代码。
 *   3. primitive 构件不进 AI 队列 —— 这是拆分层最大的省钱杠杆（BUILDING-DECOMPOSITION §9.2）。
 *
 * 决策顺序：可用性 → 形态约束 → 优先表 → 成本闸门 → 降级链。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY_DIR = path.join(ROOT, 'core', 'registry');
const POLICY_DIR = path.join(ROOT, 'core', 'policy');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadAll() {
  const providers = readJson(path.join(REGISTRY_DIR, 'providers.json'));
  const engines = readJson(path.join(REGISTRY_DIR, 'engines.json'));
  const mcp = readJson(path.join(REGISTRY_DIR, 'mcp.json'));
  const fallback = readJson(path.join(POLICY_DIR, 'fallback.json'));
  const budget = readJson(path.join(POLICY_DIR, 'budget.json'));

  const capabilities = {};
  for (const p of providers.providers) {
    if (!p.capabilities) continue;
    const f = path.join(ROOT, p.capabilities);
    if (fs.existsSync(f)) capabilities[p.id] = readJson(f);
  }
  return { providers, engines, mcp, fallback, budget, capabilities };
}

// ---------------------------------------------------------------------------

function estimateCost(cap, tier) {
  if (!cap || !cap.cost || !cap.cost.credit_by_tier) return null;
  const v = cap.cost.credit_by_tier[tier];
  return v === undefined ? null : v;
}

/**
 * 多通道平台选通道（ADR-0003）。通道差异只在这里与 providers/<id>/ 内处理。
 * @returns {{channel: string|null, reason: string}}
 */
function resolveChannel(prov, cap, job) {
  const channels = prov.channels || [];
  if (channels.length <= 1) {
    return { channel: channels[0] || 'default', reason: '单通道平台' };
  }
  const cm = (cap && cap.channel_matrix) || {};
  const order = (cap && cap.channel_probe_order) || channels;
  const needGeo = !!(job.constraints && job.constraints.geometry_only);
  const runtimeCh = (job.runtime_channels || {});

  const skipped = [];
  for (const ch of order) {
    const m = cm[ch];
    if (!m) { skipped.push(`${ch}: 未声明能力`); continue; }
    if (needGeo && !(m.supports && m.supports.geometry_only)) {
      skipped.push(`${ch}: 不支持 geometry_only`);
      continue;
    }
    if (runtimeCh[ch] === false) { skipped.push(`${ch}: 运行时标记不可用`); continue; }
    return {
      channel: ch,
      reason: needGeo
        ? `需要 geometry_only 白模 → 选中通道 ${ch}（${m.gate}门槛）`
        : `按探测顺序选中通道 ${ch}${m.recommended ? '（推荐默认）' : ''}`,
      skipped,
    };
  }
  return { channel: null, reason: `无可用通道（${skipped.join('；')}）` };
}

// ---------------------------------------------------------------------------

/**
 * 路由一件生成任务。
 * @param {object} job
 * @param {object} [ctx] 可注入的注册表/运行时状态（便于测试）
 * @returns {object} 决策结果
 */
function route(job, ctx) {
  const reg = ctx || loadAll();
  const warnings = [];
  const errors = [];
  const considered = [];

  const tier = job.tier || job.intent || 'component';
  const constraints = job.constraints || {};
  const budgetPerAsset = (reg.budget.per_asset_max || {})[tier];

  // ── 0. primitive 短路：程序化生成，0 成本，不调任何平台
  if (tier === 'primitive') {
    return {
      ok: true,
      provider: 'procedural',
      channel: null,
      cost_estimate: 0,
      reason: 'tier=primitive → 程序化生成（0 成本）。这类构件（柱础/直墙段/阶条石/踏跺/栏杆转角…）不进 AI 队列，是预算利用率最大的杠杆。',
      considered,
      warnings,
      errors,
    };
  }

  // ── 1. 可用性过滤
  const runtimes = job.runtime || {};
  let candidates = [];
  for (const p of reg.providers.providers) {
    if (!p.enabled) {
      considered.push({ provider: p.id, ok: false, why: `已禁用（${p.disabled_reason || '未启用'}）` });
      continue;
    }
    const cap = reg.capabilities[p.id];
    if (!cap) {
      considered.push({ provider: p.id, ok: false, why: '缺少 capabilities.json' });
      warnings.push(`${p.id}: 无 capabilities，跳过`);
      continue;
    }
    const rt = runtimes[p.id] || {};
    if (rt.region_blocked) {
      considered.push({ provider: p.id, ok: false, why: '区域封锁' });
      continue;
    }
    if (rt.authenticated === false) {
      considered.push({ provider: p.id, ok: false, why: '未登录 / 无凭证' });
      continue;
    }
    const cost = estimateCost(cap, tier);
    if (typeof rt.balance === 'number' && typeof cost === 'number' && rt.balance < cost) {
      considered.push({ provider: p.id, ok: false, why: `余额 ${rt.balance} < 预估成本 ${cost}` });
      continue;
    }

    // ── 2. 形态约束
    const sup = cap.supports || {};
    if (constraints.topology === 'quad' && !sup.quad) {
      considered.push({ provider: p.id, ok: false, why: '不支持 quad 拓扑' });
      continue;
    }
    if (constraints.geometry_only && !sup.geometry_only) {
      considered.push({ provider: p.id, ok: false, why: '不支持 geometry_only 白模' });
      continue;
    }
    if (constraints.pbr && sup.pbr === false) {
      considered.push({ provider: p.id, ok: false, why: '不支持 PBR' });
      continue;
    }
    if (job.mode && Array.isArray(cap.modes) && !cap.modes.includes(job.mode)) {
      considered.push({ provider: p.id, ok: false, why: `不支持模式 ${job.mode}` });
      continue;
    }
    if (constraints.face_limit && typeof constraints.face_limit === 'number') {
      const maxFaces = cap.limits && cap.limits.max_faces;
      if (typeof maxFaces === 'number' && constraints.face_limit > maxFaces) {
        considered.push({ provider: p.id, ok: false, why: `面数上限 ${maxFaces} < 要求 ${constraints.face_limit}` });
        continue;
      }
    }

    // ── 通道解析（多通道平台）
    const ch = resolveChannel(p, cap, job);
    if (!ch.channel) {
      considered.push({ provider: p.id, ok: false, why: ch.reason });
      continue;
    }

    considered.push({
      provider: p.id,
      ok: true,
      why: `通过（tier=${tier}，通道=${ch.channel}，预估 ${cost} ${reg.budget.unit}）`,
    });
    candidates.push({ prov: p, cap, cost, channel: ch.channel, channelReason: ch.reason });
  }

  if (candidates.length === 0) {
    const hint = [];
    if (constraints.topology === 'quad') {
      const anyQuad = reg.providers.providers
        .filter((p) => p.enabled)
        .some((p) => (reg.capabilities[p.id] || {}).supports?.quad);
      if (!anyQuad) {
        hint.push('无平台原生支持 quad 拓扑（ADR-0002 移除 Rodin 后）。请改走 Blender 重拓扑：在 RefineRecipe 里加 {"op":"retopo","method":"quadriflow"}。');
      }
    }
    if (constraints.geometry_only) {
      hint.push('geometry_only 白模目前仅 hunyuan3d 的 tencentcloud 通道支持 —— 请确认该通道凭证与网络。');
    }
    return {
      ok: false,
      provider: null,
      channel: null,
      cost_estimate: null,
      reason: '无可用平台：所有候选都被可用性或形态约束剔除。',
      hint,
      considered,
      warnings,
      errors: errors.concat(['无可用平台']),
    };
  }

  // ── 3. 优先表：tier_preference 命中优先，其次 priority 数值小者优先
  const scored = candidates.map((c) => ({
    ...c,
    tierHit: Array.isArray(c.prov.tier_preference) && c.prov.tier_preference.includes(tier) ? 0 : 1,
  }));
  scored.sort((a, b) => (a.tierHit - b.tierHit) || (a.prov.priority - b.prov.priority));

  // ── provider_hint：显式指定优先（在可用候选内）
  let chosen = null;
  const hint = job.provider_hint;
  if (hint && hint !== 'auto') {
    const hit = scored.find((c) => c.prov.id === hint);
    if (hit) {
      chosen = hit;
    } else {
      warnings.push(`provider_hint="${hint}" 不可用，已回退到优先表首位 ${scored[0].prov.id}`);
      chosen = scored[0];
    }
  } else {
    chosen = scored[0];
  }

  // ── 4. 成本闸门（单件）
  if (typeof budgetPerAsset === 'number' && typeof chosen.cost === 'number' && chosen.cost > budgetPerAsset) {
    const cheaper = scored.find((c) => typeof c.cost === 'number' && c.cost <= budgetPerAsset);
    if (cheaper) {
      warnings.push(
        `${chosen.prov.id} 预估 ${chosen.cost} 超出 tier "${tier}" 单件预算 ${budgetPerAsset}，降档为 ${cheaper.prov.id}（${cheaper.cost}）`
      );
      chosen = cheaper;
    } else {
      errors.push(`所有可用平台的预估成本都超出 tier "${tier}" 的单件预算 ${budgetPerAsset}`);
      return { ok: false, provider: null, channel: null, cost_estimate: null, reason: '成本闸门未通过', considered, warnings, errors };
    }
  }

  // 批次预算（若给了）
  const batchMax = reg.budget.per_batch_max;
  if (job.batch_estimate && typeof batchMax === 'number' && job.batch_estimate > batchMax) {
    warnings.push(`批次预估 ${job.batch_estimate} 超出批次预算 ${batchMax}，需要人工确认（require_confirm_over=${reg.budget.require_confirm_over}）`);
  }

  // ── 5. 降级链（供上层在失败时使用）
  const chain = (reg.fallback.chain || []).filter((id) => scored.some((c) => c.prov.id === id));

  const reasoning = [];
  reasoning.push(`tier=${tier}${job.granularity_target ? `，granularity=${job.granularity_target}` : ''}`);
  reasoning.push(chosen.channelReason);
  reasoning.push(`优先表命中依据：${chosen.tierHit === 0 ? `tier_preference 含 "${tier}"` : 'tier 未命中，按 priority 排序'}`);
  reasoning.push(`降级链：${[chosen.prov.id, ...chain.filter((x) => x !== chosen.prov.id)].join(' → ')}`);

  return {
    ok: true,
    provider: chosen.prov.id,
    channel: chosen.channel,
    cost_estimate: chosen.cost,
    reason: reasoning.join('；'),
    downgrade_chain: chain,
    considered,
    warnings,
    errors,
  };
}

// ---------------------------------------------------------------------------
// 引擎解析（含 deferred 引擎的明确报错，ADR-0004）
// ---------------------------------------------------------------------------

function resolveEngine(engineId, ctx) {
  const reg = ctx || loadAll();
  const engine = reg.engines.engines.find((e) => e.id === engineId);
  if (!engine) {
    return { ok: false, errors: [`未知引擎：${engineId}`], warnings: [] };
  }
  if (engine.status === 'deferred') {
    return {
      ok: false,
      engine,
      errors: [engine.error_message || `引擎未启用：${engineId}（${engine.deferred_reason || 'deferred'}）`],
      warnings: [],
    };
  }

  const warnings = [];
  const mcpEntry = reg.mcp.engines[engineId];
  let mcpImpl = null;
  if (mcpEntry) {
    if (!mcpEntry.active) {
      warnings.push(
        `${engineId}: MCP 实现尚未选择（active=null）。运行 \`gbe-engine mcp use ${engineId} <impl-id>\` 从 ${mcpEntry.implementations.length} 个候选中选择。`
      );
    } else {
      mcpImpl = mcpEntry.implementations.find((i) => i.id === mcpEntry.active) || null;
      if (!mcpImpl) {
        warnings.push(`${engineId}: 注册表的 active="${mcpEntry.active}" 在 implementations 中不存在 —— 请重新选择。`);
      } else {
        const missing = reg.engines.semantic_actions.filter((a) => !(mcpImpl.supports || []).includes(a));
        if (missing.length) {
          warnings.push(`${engineId}/${mcpImpl.id}: 缺少语义动作 ${missing.join(', ')} —— 相关流程会明确报告能力缺失并给替代路径。`);
        }
      }
    }
  }

  return {
    ok: true,
    engine,
    mcp_impl: mcpImpl,
    mcp_candidates: mcpEntry ? mcpEntry.implementations.map((i) => i.id) : [],
    semantic_actions: reg.engines.semantic_actions,
    warnings,
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const cmd = argv[0];
  if (cmd === 'route') {
    const job = JSON.parse(argv[1] || '{}');
    const r = route(job);
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }
  if (cmd === 'engine') {
    const r = resolveEngine(argv[1]);
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }
  console.log('用法：');
  console.log('  node core/policy/router.js route \'{"tier":"component","mode":"text"}\'');
  console.log('  node core/policy/router.js engine unreal');
  return 2;
}

module.exports = { loadAll, route, resolveEngine, resolveChannel, estimateCost };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
