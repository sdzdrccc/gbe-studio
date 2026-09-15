'use strict';

/**
 * 端口视图同步器（CONVENTIONS §18）。
 *
 * 真源 = gbe-assets/catalog/ports.json
 * 本仓 bridges/registry.json = 从真源生成 / 校验的【只读视图】。
 *
 * 用法：
 *   node bridges/sync-ports.js            # 重新生成 registry.json
 *   node bridges/sync-ports.js --check    # 只校验是否与真源一致（CI 用；不一致退出码 1）
 *   node bridges/sync-ports.js --probe    # 生成后探测各端口占用情况
 *
 * 纪律：**不要手改 bridges/registry.json** —— 它会被覆盖；改端口请改真源。
 */

const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.resolve(ROOT, '..', 'gbe-assets', 'catalog', 'ports.json');
const TARGET = path.join(ROOT, 'bridges', 'registry.json');

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
  const active = mine.filter((p) => p.status !== 'deferred');
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
      deferred: deferred.length,
      owned_by_assets: others.length,
    },

    // 本仓占用的端口（按 id 索引，便于 health.js / install-mcp.js 查）
    studio_ports: Object.fromEntries(active.map((p) => [p.id, { port: p.port, protocol: p.protocol, purpose: p.purpose, required: !!p.required }])),

    // 延后占用（Unity MCP 8080 等）—— 保留以免将来冲突
    deferred_ports: Object.fromEntries(
      deferred.map((p) => [p.id, { port: p.port, protocol: p.protocol, purpose: p.purpose, note: p.note || null }])
    ),

    // 非本仓占用（assets 服务端口）—— 只读参考，启动前也需避让
    reserved_by_others: Object.fromEntries(others.map((p) => [p.id, { port: p.port, owner: p.owner, purpose: p.purpose }])),

    // 按引擎维度的端口分组，供 MCP 切换时复检
    by_engine: {
      blender: active.filter((p) => p.id === 'blender-mcp').map((p) => p.port),
      godot: active.filter((p) => p.id === 'godot-mcp').map((p) => p.port),
      unreal: active.filter((p) => p.id.startsWith('unreal')).map((p) => p.port),
      unity: deferred.filter((p) => p.id === 'unity-mcp').map((p) => p.port),
    },
  };
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
}

function main(argv) {
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
    return 0;
  }

  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, serialized);
  console.log(`✓ 已从真源生成 ${path.relative(ROOT, TARGET)}`);
  console.log(`  真源：gbe-assets/catalog/ports.json（updated_at=${source.updated_at}）`);
  console.log(`  本仓启用端口 ${view.summary.active} 个，延后 ${view.summary.deferred} 个，避让他仓 ${view.summary.owned_by_assets} 个`);

  if (doProbe) {
    probe(view).then(() => process.exit(0));
  } else {
    console.log('  提示：加 --probe 可探测端口占用；加 --check 可在 CI 校验视图未过期。');
  }
  return 0;
}

module.exports = { readSource, buildView, SOURCE, TARGET };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
