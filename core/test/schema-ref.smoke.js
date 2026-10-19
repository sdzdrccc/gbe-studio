#!/usr/bin/env node
'use strict';

/**
 * schema-ref.smoke.js —— `@gbe/schema` 解析器冒烟（`X-0053` S-4 补测）
 *
 * 为什么需要它：`core/schema-ref.js` 是**语法校验单源**的入口（硬性禁令 8：
 * 本仓不许带副本）。它此前零测试 —— 解析顺序改错、或悄悄 require 到别处，
 * 表现是"校验照样绿"，而不是报错。
 *
 * 判据：
 *   ① **解析到的是 gbe-assets 那一份**（`__resolved_from` 落在 GBE_ASSETS_REPO 或同级仓）
 *   ② API 面齐全（validate / checkPackage / gateSchemaVersion …）
 *   ③ **空对象必红**（不许"没有必填字段也算过"）
 *   ④ **真实 asset.json 必绿**（只读，不改资产）
 *   ⑤ **v1 包必拒**（ADR-0001：v1 契约废弃，`reject_v1_packages`）
 *
 * 用法：node core/test/schema-ref.smoke.js
 * 退出码：0 = 全过 / 1 = 有失败 / 2 = 找不到 gbe-assets（跳过 · NOT a pass）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ASSETS_ROOT = process.env.GBE_ASSETS_REPO || path.resolve(ROOT, '..', 'gbe-assets');

const failures = [];
const fail = (msg) => failures.push(msg);
const ok = (msg) => console.log(`  ✓ ${msg}`);

let schema;
try {
  schema = require(path.join(ROOT, 'core', 'schema-ref.js')).loadSchemaPackage();
} catch (e) {
  console.log('[schema-ref.smoke] 找不到 @gbe/schema → 跳过');
  console.log(`  ${e.message.split('\n')[0]}`);
  console.log('  ★ 跳过不是通过');
  process.exit(2);
}

// ① 解析来源
const from = schema.__resolved_from || '';
const inSibling = path.resolve(from).startsWith(path.resolve(ASSETS_ROOT));
if (!inSibling && from !== 'node_modules/@gbe/schema') {
  fail(`解析到了非预期位置：${from}（期望 ${ASSETS_ROOT}/packages/schema）`);
} else {
  ok(`解析到 ${inSibling ? 'gbe-assets 的单源实现' : 'node_modules（CI 安装形态）'}：${from}`);
}

// ② API 面
const NEED = ['validate', 'checkPackage', 'gateSchemaVersion', 'validateAsset', 'validateSource', 'validateAssembly'];
const missing = NEED.filter((k) => typeof schema[k] !== 'function');
if (missing.length) fail(`API 缺函数：${missing.join(', ')}`);
else ok(`${NEED.length} 个入口函数齐备`);

// ③ 空对象必红
const empty = schema.validate('asset', {});
if (empty.valid !== false || !empty.errors.some((e) => /schema_version/.test(e.message))) {
  fail('空 asset 未被拒（或未点到 schema_version）');
} else ok('空 asset → 必红（点中 schema_version）');

// ④ 真实资产必绿（取库里第一件；只读）
const kitAsset = [
  'kits/cn-ancient/components/base/curb-stone-straight/asset.json',
  'kits/cn-ancient/components/base/plinth-fupen-a/asset.json',
].map((p) => path.join(ASSETS_ROOT, p)).find((p) => fs.existsSync(p));
if (!kitAsset) {
  fail(`找不到可用于正向校验的 asset.json（${ASSETS_ROOT}）`);
} else {
  const data = JSON.parse(fs.readFileSync(kitAsset, 'utf8'));
  const r = schema.validate('asset', data);
  if (!r.valid) fail(`真实 asset 被判红：${r.errors[0] && r.errors[0].message}`);
  else ok(`真实 asset 通过：${path.relative(ASSETS_ROOT, kitAsset)}`);
}

// ⑤ v1 包必拒（ADR-0001）
const v1 = schema.gateSchemaVersion({ schema_version: '1' }, 'test');
if (v1.valid !== false) fail('schema_version="1" 未被拒 —— v1 闸门失效（ADR-0001）');
else ok('v1 包 → 必拒（ADR-0001 · 不静默兼容）');

console.log('\n[schema-ref.smoke] @gbe/schema 解析器 · 单源 / API / 正反例');
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length ? `\n  结果：不通过（${failures.length} 项）` : '\n  结果：通过（0 项失败）');
process.exit(failures.length ? 1 : 0);
