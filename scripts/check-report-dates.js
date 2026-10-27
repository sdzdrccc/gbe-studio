#!/usr/bin/env node
'use strict';

/**
 * check-report-dates.js —— 批次报告日期不得晚于它的**首次提交日**（2026-10-27 · X-0063）。
 *
 * 病：v0.9.1 的提交日是 **2026-10-24 18:43**，却装了 `PILOT-2026-10-25/26` 两份报告 ——
 *     文件名日期 / CHANGELOG 日期 / git 提交时间三者至少一处不真。
 * 判据：`pipeline/reports/PILOT-YYYY-MM-DD.md` 的**文件名日期 ≤ 该文件首次入库的提交日**。
 *     ★ 报告只能记录**已经发生**的批次；日期晚于提交日 = 预写 / 日期写错。
 *
 * 历史例外：`PILOT-2026-10-25/26` 是 v0.9.1 那批的历史标签，已在 CHANGELOG 订正说明；
 *     登记在 `WAIVED`，只报不红（豁免项消失时**不**报 stale —— 历史事实不要求被“修好”）。
 *
 * 用法：node scripts/check-report-dates.js [--self-test]
 * 退出码：0 通过（含显式跳过）/ 1 有报告日期晚于提交日
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'pipeline', 'reports');

const WAIVED = {
  'PILOT-2026-10-25.md': 'v0.9.1 历史批次日标签（提交日 2026-10-24）；见 CHANGELOG [0.9.1] 订正',
  'PILOT-2026-10-26.md': 'v0.9.1 历史批次日标签（提交日 2026-10-24）；见 CHANGELOG [0.9.1] 订正',
};

/** 纯函数：ISO 日期串比较（`2026-10-26 <= 2026-10-27`）。 */
function dateLe(a, b) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return false;
  return a <= b;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function selfTest() {
  const cases = [];
  const eq = (name, got, want) => cases.push([name, got === want, `得 ${JSON.stringify(got)} / 期 ${JSON.stringify(want)}`]);
  eq('同日 → 不晚', dateLe('2026-10-26', '2026-10-26'), true);
  eq('早于提交 → 通过', dateLe('2026-10-24', '2026-10-26'), true);
  eq('晚于提交 → 必抓', dateLe('2026-10-26', '2026-10-24'), false);
  eq('坏日期 → 视为不通过', dateLe('十一份', '2026-10-24'), false);
  let bad = 0;
  console.log('[check-report-dates] 反向测试（--self-test）');
  for (const [name, ok, detail] of cases) {
    console.log(`  ${ok ? '✔' : '✘'} ${name.padEnd(24)} ${detail}`);
    if (!ok) bad++;
  }
  console.log(`  结果：${bad ? '不通过（' + bad + '）' : '通过（' + cases.length + ' / ' + cases.length + '）'}`);
  process.exit(bad ? 1 : 0);
}

if (process.argv.includes('--self-test')) selfTest();

const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => /^PILOT-\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort()
  : [];
if (files.length === 0) {
  console.error('[check-report-dates] pipeline/reports 下没有 PILOT-*.md —— 扫描范围写错了（禁止空集真空通过）');
  process.exit(1);
}

const errors = [];
const warns = [];
for (const f of files) {
  const reportDate = f.slice(6, 16);
  const first = git(['log', '--diff-filter=A', '--format=%ad', '--date=short', '--', path.join('pipeline', 'reports', f)]);
  if (!first) {
    warns.push(`${f}：未入库 / 取不到首次提交日 → 跳过（NOT a pass）`);
    continue;
  }
  const commitDate = first.split(/\r?\n/)[0];
  if (!dateLe(reportDate, commitDate)) {
    const line = `${f}：报告日期 ${reportDate} 晚于首次提交日 ${commitDate}`;
    if (WAIVED[f]) warns.push(`[历史豁免] ${line} —— ${WAIVED[f]}`);
    else errors.push(line);
  }
}

console.log(`[check-report-dates] 批报日期 ≤ 首次提交日（${files.length} 份）`);
console.log('─'.repeat(64));
warns.forEach((w) => console.log(`  ⚠ ${w}`));
errors.forEach((e) => console.log(`  ✗ ${e}`));
console.log('─'.repeat(64));
console.log(`  结果：${errors.length ? '不通过（' + errors.length + ' 份日期不真）' : '通过（' + files.length + ' 份 · 警告 ' + warns.length + '）'}`);
process.exit(errors.length ? 1 : 0);
