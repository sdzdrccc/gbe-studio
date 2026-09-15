'use strict';

/**
 * 引擎适配器基类（ADR-0005）。
 *
 * 设计要点：适配器**只依赖 8 个语义动作**，不依赖任何具体 MCP 的工具名。
 * 具体工具名由 `engines/<engine>/semantic_map.json` 提供 —— 换实现 = 换一份映射表 + 改注册表 active，
 * **不需要改动本文件或任何上层流程**。
 *
 * 用法：
 *   node engines/base.js list godot
 *   node engines/base.js validate unreal
 */

const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY = path.join(ROOT, 'core', 'registry');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadEngineRegistry() {
  return readJson(path.join(REGISTRY, 'engines.json'));
}

function loadMcpRegistry() {
  return readJson(path.join(REGISTRY, 'mcp.json'));
}

/**
 * 创建一个引擎适配器实例。
 * @param {string} engineId
 * @param {object} [opts] { implOverride: 指定实现 id }
 */
function createAdapter(engineId, opts = {}) {
  const engines = loadEngineRegistry();
  const mcp = loadMcpRegistry();

  const engine = engines.engines.find((e) => e.id === engineId);
  if (!engine) throw new Error(`未知引擎：${engineId}`);

  if (engine.status === 'deferred') {
    const err = new Error(
      engine.error_message || `引擎未启用：${engineId}（${engine.deferred_reason || 'deferred'}）`
    );
    err.code = 'ENGINE_DEFERRED';
    throw err;
  }

  const entry = mcp.engines[engineId];
  const implId = opts.implOverride || (entry && entry.active) || null;

  if (!implId) {
    const err = new Error(
      `${engineId}: MCP 实现尚未选择（active=null）。可用候选：` +
        (entry ? entry.implementations.map((i) => i.id).join(', ') : '（无）') +
        `\n  选择命令：gbe-engine mcp use ${engineId} <impl-id>`
    );
    err.code = 'MCP_NOT_SELECTED';
    throw err;
  }

  const impl = entry && entry.implementations.find((i) => i.id === implId);
  if (!impl) throw new Error(`${engineId}: 注册表中找不到实现 "${implId}"`);

  // 语义映射：优先 <impl-id>.semantic_map.json，其次 semantic_map.json
  const mapDir = path.join(ROOT, 'engines', engineId);
  const candidates = [path.join(mapDir, `${implId}.semantic_map.json`), path.join(mapDir, 'semantic_map.json')];
  let semanticMap = null;
  for (const f of candidates) {
    if (fs.existsSync(f)) {
      const m = readJson(f);
      if (m.implementation === implId) {
        semanticMap = m;
        break;
      }
    }
  }

  const actions = {};

  /** 语义动作分发器：未映射时给出明确的能力缺失报告，不静默失败。 */
  function invoke(action, args) {
    if (!engines.semantic_actions.includes(action)) {
      throw new Error(`未知语义动作：${action}（合法动作：${engines.semantic_actions.join(', ')}）`);
    }
    if (!impl.supports.includes(action)) {
      const err = new Error(
        `能力缺失：实现 "${implId}" 未声明支持语义动作 "${action}"。` +
          `\n  替代路径：请切换实现（gbe-engine mcp use ${engineId} <impl-id>），或改用原生 MCP 逃生舱。`
      );
      err.code = 'CAPABILITY_MISSING';
      throw err;
    }
    if (!semanticMap || semanticMap.status !== 'mapped') {
      const err = new Error(
        `语义映射未填写：engines/${engineId}/semantic_map.json 的 status 仍为 "${semanticMap ? semanticMap.status : 'missing'}"。` +
          `\n  请先列出该 MCP 的实际工具清单并逐条对应（见文件内 how_to_fill），再重试。` +
          `\n  提示：验证命令 node engines/base.js validate ${engineId}`
      );
      err.code = 'SEMANTIC_MAP_UNMAPPED';
      throw err;
    }
    const spec = semanticMap.actions[action];
    if (!spec || !spec.tool) {
      const err = new Error(`语义动作 "${action}" 未映射到具体工具。`);
      err.code = 'SEMANTIC_MAP_INCOMPLETE';
      throw err;
    }
    return { action, tool: spec.tool, args: { ...(spec.args || {}), ...(args || {}) } };
  }

  return {
    engineId,
    engine,
    implId,
    impl,
    semanticMap,
    semanticActions: engines.semantic_actions,
    invoke,

    /** probe 可以在未映射时也工作：直接探端口。 */
    async probePorts() {
      const results = {};
      for (const port of impl.ports || []) {
        results[port] = await probePort(port, impl.transport);
      }
      return results;
    },

    /** 报告映射完成度。 */
    mappingStatus() {
      const missing = engines.semantic_actions.filter(
        (a) => !semanticMap || !semanticMap.actions[a] || !semanticMap.actions[a].tool
      );
      return {
        implementation: implId,
        status: semanticMap ? semanticMap.status : 'missing',
        mapped: engines.semantic_actions.length - missing.length,
        total: engines.semantic_actions.length,
        missing,
        unsupported: engines.semantic_actions.filter((a) => !impl.supports.includes(a)),
      };
    },
  };
}

function probePort(port, transport) {
  return new Promise((resolve) => {
    if (transport === 'udp') return resolve('unknown'); // UDP 无法用 connect 探测
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.setTimeout(500);
    const done = (s) => {
      sock.destroy();
      resolve(s);
    };
    sock.once('connect', () => done('listening'));
    sock.once('timeout', () => done('free'));
    sock.once('error', (e) => done(e.code === 'ECONNREFUSED' ? 'free' : 'unknown'));
  });
}

// ---------------------------------------------------------------------------

function main(argv) {
  const [cmd, engineId] = argv;
  if (cmd === 'list') {
    const engines = loadEngineRegistry();
    const mcp = loadMcpRegistry();
    for (const e of engines.engines) {
      const entry = mcp.engines[e.id] || { implementations: [] };
      const mark = e.status === 'deferred' ? '⏸ deferred' : '● enabled';
      console.log(`\n${e.display_name} (${e.id})  ${mark}`);
      console.log(`  语义动作：${engines.semantic_actions.length} 个`);
      console.log(`  端口：${(e.ports || []).join(', ') || '—'}`);
      console.log(`  实现候选：${entry.implementations.length ? entry.implementations.map((i) => i.id).join(', ') : '（无）'}`);
      if (e.status === 'deferred') console.log(`  说明：${e.deferred_reason}`);
    }
    console.log('');
    return 0;
  }

  if (cmd === 'validate') {
    if (!engineId) {
      console.error('用法：node engines/base.js validate <engine>');
      return 2;
    }
    try {
      const adapter = createAdapter(engineId);
      const st = adapter.mappingStatus();
      console.log(`\n实现：${st.implementation}  映射状态：${st.status}`);
      console.log(`语义动作覆盖：${st.mapped}/${st.total}`);
      if (st.unsupported.length) console.log(`实现不支持：${st.unsupported.join(', ')}`);
      console.log(st.missing.length ? `尚未映射：${st.missing.join(', ')}` : '✓ 8 个语义动作全部已映射');
      console.log('');
      return st.missing.length ? 1 : 0;
    } catch (e) {
      console.error(`✗ ${e.message}`);
      return 1;
    }
  }

  if (cmd === 'probe') {
    if (!engineId) {
      console.error('用法：node engines/base.js probe <engine>');
      return 2;
    }
    try {
      const adapter = createAdapter(engineId);
      adapter.probePorts().then((r) => {
        console.log(`\n${engineId}/${adapter.implId} 端口探测：`);
        for (const [p, s] of Object.entries(r)) {
          console.log(`  ${String(p).padStart(5)}  ${s === 'listening' ? '● 已监听' : s === 'free' ? '○ 未监听' : '- 未知'}`);
        }
      });
      return 0;
    } catch (e) {
      console.error(`✗ ${e.message}`);
      return 1;
    }
  }

  console.log('用法：');
  console.log('  node engines/base.js list');
  console.log('  node engines/base.js validate <engine>');
  console.log('  node engines/base.js probe <engine>');
  return 2;
}

module.exports = { createAdapter, probePort };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
