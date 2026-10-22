#!/usr/bin/env node
'use strict';

/**
 * procedural.smoke.js —— 程序化构件生成器的冒烟测试（`X-0053` S-4 补测）
 *
 * 为什么需要它：`build/procedural/*` 是**没有 AI 成本、却直接写入资产库**的那条路
 * （40 件程序化资产、0 credit）。它此前**零测试** —— 几何内核改坏了，没有任何红。
 *
 * 判据（每条都对应一个"改坏了不会报错"的地方）：
 *   ① 40 件全部 `ok`（自检错误为 0）
 *   ② **确定性**：同参数两次生成，GLB **逐字节相同**（recipe_hash 的承诺）
 *   ③ 插槽落定位网格 `snap_m = 0.5`（CONVENTIONS §19.2 硬约束；attach 豁免）
 *   ④ 面数不超该件的 `tier` 预算（`kit.budgets`）
 *   ⑤ GLB 能被自家解析器读回（写出去的东西得读得回来）
 *
 * 用法：node build/procedural/test/procedural.smoke.js
 * 退出码：0 = 全过 / 1 = 有失败
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ASSETS_ROOT = process.env.GBE_ASSETS_REPO || path.resolve(ROOT, '..', 'gbe-assets');

const { buildOne, loadMaterialColors } = require(path.join(ROOT, 'build', 'procedural', 'generate.js'));
const { components } = require(path.join(ROOT, 'build', 'procedural', 'components.js'));
const { parseGlb } = require(path.join(ROOT, 'build', 'procedural', 'gltf.js'));

const failures = [];
const notes = [];
const fail = (id, msg) => failures.push(`${id}: ${msg}`);

function readBudgets() {
  const kitFile = path.join(ASSETS_ROOT, 'kits', 'cn-ancient', 'kit.json');
  if (fs.existsSync(kitFile)) return JSON.parse(fs.readFileSync(kitFile, 'utf8')).budgets || {};
  const cfgFile = path.join(ASSETS_ROOT, 'catalog.config.json');
  if (fs.existsSync(cfgFile)) return JSON.parse(fs.readFileSync(cfgFile, 'utf8')).budgets || {};
  return null;
}

const budgets = readBudgets();
if (!budgets) {
  console.log('[procedural.smoke] 找不到 gbe-assets（kit.json / catalog.config.json）→ 跳过');
  console.log('  ★ 跳过不是通过（用 GBE_ASSETS_REPO 指路）');
  process.exit(2);
}

const opts = {
  budgets,
  matColors: loadMaterialColors(),
  kernelDigest: 'smoke',
  preview: { size_px: 64, yaw_deg: 45, pitch_deg: 30, focal_mm_equiv: 50 },
  noPreview: true,
  ss: 1,
  now: '2026-01-01T00:00:00.000Z', // ★ 固定时间戳：确定性判据不能被 created_at 干扰
};

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

let counted = 0;
for (const spec of components) {
  const id = spec.name;
  const a = buildOne(spec, opts);
  const b = buildOne(spec, opts);

  // ① 自检
  if (!a.ok) { fail(id, `自检未过：${a.errors[0]}`); continue; }
  counted++;

  // ② 确定性
  if (a.built.glbBytes === 0) fail(id, 'GLB 为空');
  else if (sha(a.built.glb) !== sha(b.built.glb)) fail(id, '★ 两次生成 GLB 不一致（确定性破了）');

  // ③ 插槽网格
  for (const s of a.asset.sockets || []) {
    if (s.type === 'attach' || !Array.isArray(s.position_m)) continue;
    for (const v of s.position_m) {
      if (Math.abs(v / 0.5 - Math.round(v / 0.5)) > 1e-6) {
        fail(id, `插槽 ${s.slot} 的 ${v} 未落 0.5 网格`);
        break;
      }
    }
  }

  // ④ 面数预算（budgets 是 tier → 三角面上限）
  const limit = budgets[spec.tier];
  if (typeof limit === 'number' && a.built.polycount > limit) {
    fail(id, `面数 ${a.built.polycount} 超 ${spec.tier} 预算 ${limit}`);
  }

  // ⑤ GLB 读回
  try {
    const back = parseGlb(a.built.glb);
    if (!back || !back.json) fail(id, 'GLB 读回失败');
  } catch (e) {
    fail(id, `GLB 读回抛错：${e.message}`);
  }
}

// 覆盖自证：不许"0 件也算过"
if (counted === 0) fail('*', '一件都没跑成 —— 禁止空集通过');
if (components.length !== 40) notes.push(`构件数 ${components.length}（方案表记 40 —— ★ 变了要同步文档）`);

console.log('[procedural.smoke] 40 件程序化资产 · 生成 → 复现 → 网格 → 预算 → 读回');
console.log(`  构件 ${components.length} 件 · 通过自检 ${counted} 件`);
for (const n of notes) console.log(`  ⚠ ${n}`);
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length ? `\n  结果：不通过（${failures.length} 项）` : '\n  结果：通过（0 项失败）');
process.exit(failures.length ? 1 : 0);
