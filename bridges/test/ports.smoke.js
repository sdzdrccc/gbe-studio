#!/usr/bin/env node
'use strict';

/**
 * ports.smoke.js —— 端口交叉校验的反向测试（`X-0053` S-2 的"必红"侧）
 *
 * 为什么需要它：`sync-ports.js --check` 曾经**在真漂移上显示绿** ——
 * unity 预留位真源已挪 8090，`mcp.json` / `engines.json` / README / PLAN 四份副本仍写 8080，
 * 而 `--check` 只判「这个号在 ports.json 里存在」（8080 确实存在，只是**归 qiuyuan-game-ws**）。
 *
 * 本测试用**合成数据**证明新判据能抓到那一次真漂移，而不是等下一次真的漂了才知道。
 *
 * 用法：node bridges/test/ports.smoke.js
 * 退出码：0 = 全过 / 1 = 有失败
 */

const path = require('path');
const { crossCheckRegistries } = require(path.resolve(__dirname, '..', 'sync-ports.js'));

const cases = [];
const t = (name, got, want) => cases.push({ name, ok: got === want, got, want });

// 合成真源：unity 预留已是 8090；8080 被 qiuyuan-game-ws 征用
const source = {
  ports: [
    { id: 'unity-mcp', port: 8090, status: 'deferred' },
    { id: 'qiuyuan-game-ws', port: 8080, owner: 'qiuyuan-dalu' },
    { id: 'unreal-mcp-alt-chir24', port: 8091 },
  ],
};
const engines = { engines: [{ id: 'unity', ports: ['unity-mcp'] }, { id: 'unreal', ports: ['unreal-mcp-alt-chir24'] }] };

// ① 旧漂移（unity 候选仍写 8080）→ 必报
const drifted = {
  engines: {
    unity: { implementations: [], candidates_for_future: [{ id: 'coplaydev-unity-mcp', port: 8080 }] },
  },
};
const e1 = crossCheckRegistries(source, { mcp: drifted, engines });
t('★ 旧漂移（candidate 8080 属他仓）→ 必报', e1.length, 1);
t('★ 报错须点名归属', /qiuyuan-game-ws/.test(e1[0] || ''), true);

// ② 修正后（8090）→ 不得误报
const fixed = {
  engines: { unity: { implementations: [], candidates_for_future: [{ id: 'coplaydev-unity-mcp', port: 8090 }] } },
};
t('★ 修正后 → 不得误报', crossCheckRegistries(source, { mcp: fixed, engines }).length, 0);

// ③ 真源里根本没有的号 → 必报
const ghost = {
  engines: { unreal: { implementations: [{ id: 'x', ports: [9999] }] } },
};
t('★ 真源无此号 → 必报', crossCheckRegistries(source, { mcp: ghost, engines }).length, 1);

// ④ 未定端口（null）→ 合法
const nullable = {
  engines: { unity: { implementations: [], candidates_for_future: [{ id: 'official', port: null }] } },
};
t('★ port=null（未定）→ 不得误报', crossCheckRegistries(source, { mcp: nullable, engines }).length, 0);

// ⑤ engines.json 声明了真源没有的端口 ID → 必报
const badEngines = { engines: [{ id: 'unity', ports: ['no-such-port'] }] };
t('★ engines.json 的未知端口 ID → 必报', crossCheckRegistries(source, { mcp: { engines: {} }, engines: badEngines }).length, 1);

const failed = cases.filter((c) => !c.ok);
console.log('[ports.smoke] 端口交叉校验 · 反向测试');
for (const c of cases) {
  console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : `  → 实际 ${JSON.stringify(c.got)} · 期望 ${JSON.stringify(c.want)}`}`);
}
console.log(failed.length ? `\n  结果：不通过（${failed.length} / ${cases.length}）` : `\n  结果：通过（${cases.length} / ${cases.length}）`);
process.exit(failed.length ? 1 : 0);
