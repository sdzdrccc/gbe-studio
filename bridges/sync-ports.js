'use strict';

/**
 * 端口视图同步器（CONVENTIONS §18）。
 *
 * 真源 = gbe-assets/catalog/ports.json
 * 本仓 bridges/registry.json = 从真源生成 / 校验的【只读视图】。
 *
 * 用法：
 *   node bridges/sync-ports.js            # 重新生成 registry.json
 *   node bridges/sync-ports.js --check    # 校验：① 视图与真源一致 ② mcp.json / engines.json 的端口副本与真源交叉一致（CI 用；不一致退出码 1）
 *   node bridges/sync-ports.js --probe    # 生成后探测各端口占用情况
 *
 * 纪律：**不要手改 bridges/registry.json** —— 它会被覆盖；改端口请改真源。
 */

const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 真源位置解析顺序与 core/schema-ref.js 同款：① 环境变量 GBE_ASSETS_REPO ② 缺省回退同级目录（开发期默认）
const SOURCE = process.env.GBE_ASSETS_REPO
  ? path.join(process.env.GBE_ASSETS_REPO, 'catalog', 'ports.json')
  : path.resolve(ROOT, '..', 'gbe-assets', 'catalog', 'ports.json');
const TARGET = path.join(ROOT, 'bridges', 'registry.json');
const MCP_REGISTRY = path.join(ROOT, 'core', 'registry', 'mcp.json');
const ENGINES_REGISTRY = path.join(ROOT, 'core', 'registry', 'engines.json');

function readSource() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`✗ 找不到端口真源：${SOURCE}`);
    console.error('  端口真源在 gbe-assets 仓库；若两仓不在同级目录，请用 GBE_ASSETS_REPO 环境变量指定。');
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
}

function buildView(source) {
  const mine = source.ports.filter((p) => p.owner === 'gbe-studio');
  const others = source.ports.filter((p) => p.owner !== 'gbe-studio');
  // 三类状态（ADR-0007）：
  //   无 status  = 已启用
  //   reserved   = 已登记但未启用（如官方 MCP 的 8000）—— 保留占位以免被他人占用
  //   deferred   = 整个引擎延后（ADR-0004 Unity）
  const active = mine.filter((p) => !p.status);
  const reserved = mine.filter((p) => p.status === 'reserved');
  const deferred = mine.filter((p) => p.status === 'deferred');

  return {
    $comment:
      '★ 只读视图 —— 由 bridges/sync-ports.js 从 gbe-assets/catalog/ports.json 生成。' +
      '请勿手工编辑（会被覆盖）；改端口请改真源后重跑 sync-ports.js。',
    generated_from: '../gbe-assets/catalog/ports.json',
    generated_by: 'bridges/sync-ports.js',
    source_updated_at: source.updated_at,
    ports_version: source.ports_version,
    authority: 'gbe-assets/catalog/ports.json',

    summary: {
      total: source.ports.length,
      owned_by_studio: mine.length,
      active: active.length,
      reserved: reserved.length,
      deferred: deferred.length,
      owned_by_assets: others.length,
    },

    // 本仓【已启用】的端口（按 id 索引，便于 health.js / install-mcp.js 查）
    studio_ports: Object.fromEntries(active.map((p) => [p.id, { port: p.port, protocol: p.protocol, purpose: p.purpose, required: !!p.required }])),

    // 已登记但【未启用】的端口（如官方 MCP 的 8000，ADR-0007）—— 保留占位以免被他人占用
    reserved_ports: Object.fromEntries(
      reserved.map((p) => [
        p.id,
        { port: p.port, protocol: p.protocol, purpose: p.purpose, required: !!p.required, status: p.status, note: p.note || null },
      ])
    ),

    // 延后占用（Unity MCP 8080 等）—— 保留以免将来冲突
    deferred_ports: Object.fromEntries(
      deferred.map((p) => [p.id, { port: p.port, protocol: p.protocol, purpose: p.purpose, note: p.note || null }])
    ),

    // 非本仓占用（assets 服务端口）—— 只读参考，启动前也需避让
    reserved_by_others: Object.fromEntries(others.map((p) => [p.id, { port: p.port, owner: p.owner, purpose: p.purpose }])),

    // 按引擎维度的端口分组：回答「切到该引擎的某个实现时，哪些端口必须让开」
    // 引擎维度从端口记录自身派生（id 第一段，如 unreal-mcp-official → unreal），
    // 不写死引擎家族名单 —— 新引擎登记进 ports.json 即自动出现在这里（X-0032 S-4）。
    // 分组口径 = 该引擎名下的全部端口：active 正占用；reserved / deferred 保留避让，
    // 一旦被选为 active 就要占用 —— 与既有视图一致（unreal 含 active+reserved、
    // blender/godot 取 active、unity 取 deferred，它们名下本就只有这些状态）。
    // 键的顺序 = 展示序（已知引擎在前，未列名引擎按名缀后），组内序 = active → reserved → deferred。
    by_engine: buildByEngine(active, reserved, deferred),
  };
}

// 展示序：仅决定键的先后，不决定成员 —— 成员完全由端口记录派生
const ENGINE_DISPLAY_ORDER = ['blender', 'godot', 'unreal', 'unity'];

function buildByEngine(active, reserved, deferred) {
  const groups = new Map(); // engine -> number[]（组内序即插入序）
  for (const p of [...active, ...reserved, ...deferred]) {
    const engine = p.id.split('-')[0];
    if (!groups.has(engine)) groups.set(engine, []);
    groups.get(engine).push(p.port);
  }
  const extra = [...groups.keys()].filter((e) => !ENGINE_DISPLAY_ORDER.includes(e)).sort();
  const ordered = {};
  for (const engine of [...ENGINE_DISPLAY_ORDER.filter((e) => groups.has(e)), ...extra]) {
    ordered[engine] = groups.get(engine);
  }
  return ordered;
}

/**
 * 端口三份副本的交叉校验（X-0032 S-3）—— `--check` 专用。
 *
 * 端口在仓内有三个副本，此前各自维护、互不交叉校验：
 *   真源        gbe-assets/catalog/ports.json（端口记录，含 id / port / status）
 *   副本一      core/registry/mcp.json 各 implementation.ports（裸端口数字）
 *   副本二      core/registry/engines.json 各引擎 ports（端口 ID 字符串数组）
 *   只读视图    bridges/registry.json（由本脚本从真源生成，上面已比对）
 * 本函数补上「副本 ↔ 真源」的两向校验，任一不一致即返回明细（调用方据此退出 1）。
 *
 * @returns {string[]} 不一致明细（空数组 = 全部一致）
 */
function crossCheckRegistries(source) {
  const errors = [];
  // 真源端口清单：active / reserved / deferred / others（他仓占用）全算
  const knownPorts = new Set(source.ports.map((p) => p.port));
  const knownIds = new Set(source.ports.map((p) => p.id));

  const readRegistry = (file, label) => {
    if (!fs.existsSync(file)) {
      errors.push(`${label} 不存在：${path.relative(ROOT, file)}`);
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      errors.push(`${label} 解析失败：${e.message}`);
      return null;
    }
  };

  // ① mcp.json：每个 implementation 的每个端口数字，必须能在 ports.json 找到同号条目
  const mcp = readRegistry(MCP_REGISTRY, 'core/registry/mcp.json');
  if (mcp) {
    for (const [engineId, entry] of Object.entries(mcp.engines || {})) {
      for (const impl of entry.implementations || []) {
        for (const port of impl.ports || []) {
          if (!knownPorts.has(port)) {
            errors.push(
              `mcp.json ${engineId}/${impl.id} 声明端口 ${port}，但 ports.json 无同号条目（端口真源不同步）`
            );
          }
        }
      }
    }
  }

  // ② engines.json：每个引擎 ports 数组里的每个端口 ID，必须能在 ports.json 找到同 id 条目
  const engines = readRegistry(ENGINES_REGISTRY, 'core/registry/engines.json');
  if (engines) {
    for (const eng of engines.engines || []) {
      for (const portId of eng.ports || []) {
        if (!knownIds.has(portId)) {
          errors.push(
            `engines.json ${eng.id}.ports 声明端口 ID ${portId}，但 ports.json 无此 id（端口真源不同步）`
          );
        }
      }
    }
  }

  return errors;
}

function tryConnect(port, protocol) {
  return new Promise((resolve) => {
    if (protocol === 'udp') return resolve('unknown'); // UDP 无法用 connect 探测
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (state) => {
      sock.destroy();
      resolve(state);
    };
    sock.setTimeout(400);
    sock.once('connect', () => done('listening'));
    sock.once('timeout', () => done('free'));
    sock.once('error', (e) => done(e.code === 'ECONNREFUSED' ? 'free' : 'unknown'));
  });
}

async function probe(view) {
  console.log('\n端口占用探测（仅本仓端口；UDP 无法探测，标 unknown）：');
  for (const [id, info] of Object.entries(view.studio_ports)) {
    const state = await tryConnect(info.port, info.protocol);
    const mark = state === 'listening' ? '● 已占用' : state === 'free' ? '○ 空闲' : '- 未知';
    console.log(`  ${String(info.port).padStart(5)}  ${id.padEnd(32)} ${mark}`);
  }
  const reserved = Object.entries(view.reserved_ports || {});
  if (reserved.length) {
    console.log('  预留（未启用；一旦选为 active 就必须空闲，故现在也要避让）：');
    for (const [id, info] of reserved) {
      const state = await tryConnect(info.port, info.protocol);
      const mark = state === 'listening' ? '● 已被占用 ← 启用前需解决' : state === 'free' ? '○ 空闲' : '- 未知';
      console.log(`  ${String(info.port).padStart(5)}  ${id.padEnd(32)} ${mark}`);
    }
  }
}

async function main(argv) {
  const check = argv.includes('--check');
  const doProbe = argv.includes('--probe');

  const source = readSource();
  const view = buildView(source);
  const serialized = JSON.stringify(view, null, 2) + '\n';

  if (check) {
    if (!fs.existsSync(TARGET)) {
      console.error('✗ bridges/registry.json 不存在 —— 请先运行 node bridges/sync-ports.js');
      return 1;
    }
    const current = fs.readFileSync(TARGET, 'utf8');
    if (current !== serialized) {
      console.error('✗ bridges/registry.json 与端口真源不一致 —— 视图已过期。');
      console.error('  这通常意味着有人改了真源但没同步视图，或有人手改了视图。');
      console.error('  修复：node bridges/sync-ports.js');
      return 1;
    }
    console.log('✓ bridges/registry.json 与 gbe-assets/catalog/ports.json 一致');

    // 三份副本交叉校验：mcp.json 的端口数字 / engines.json 的端口 ID 都必须能在真源找到
    const crossErrors = crossCheckRegistries(source);
    if (crossErrors.length > 0) {
      console.error('✗ 端口副本与真源交叉校验失败：');
      for (const e of crossErrors) console.error(`    ${e}`);
      console.error('  修复：以 gbe-assets/catalog/ports.json 为准改真源或改副本，再跑 node bridges/sync-ports.js');
      return 1;
    }
    console.log('✓ mcp.json / engines.json 的端口声明与 ports.json 真源交叉一致');
    return 0;
  }

  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, serialized);
  console.log(`✓ 已从真源生成 ${path.relative(ROOT, TARGET)}`);
  console.log(`  真源：gbe-assets/catalog/ports.json（updated_at=${source.updated_at}）`);
  console.log(
    `  本仓启用端口 ${view.summary.active} 个，预留(未启用) ${view.summary.reserved} 个，延后 ${view.summary.deferred} 个，避让他仓 ${view.summary.owned_by_assets} 个`
  );

  if (doProbe) {
    await probe(view);
  } else {
    console.log('  提示：加 --probe 可探测端口占用；加 --check 可在 CI 校验视图未过期。');
  }
  return 0;
}

module.exports = { readSource, buildView, buildByEngine, crossCheckRegistries, SOURCE, TARGET };

if (require.main === module) {
  // main 可能是 async（--probe 分支）—— 必须等它，不能直接 process.exit(返回值)。
  // 旧写法 `process.exit(main(...))` 会在异步探测完成前就杀掉进程，导致 --probe 静默无输出。
  Promise.resolve(main(process.argv.slice(2))).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`✗ sync-ports 失败：${err && err.stack ? err.stack : err}`);
      process.exit(2);
    }
  );
}
