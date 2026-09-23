'use strict';

/**
 * 形制收敛的纸面分析 —— 实现 BUILDING-DECOMPOSITION.md §10.5(c)
 *
 * 在造出任何一件构件之前，估算「每新增一个形制还需要多少件全新构件」。
 *
 * 用法：
 *   node build/convergence/report.js            # 人读报告
 *   node build/convergence/report.js --json     # 机器可读
 *   node build/convergence/report.js --quiet    # 只输出结论行
 *
 * ⚠️ 输出是**估算**，不是实测：它依赖 forms.js 的理想构件集（推定），
 *    且验不了「插槽真能对上」。用法严格限定见 §10.5(c)。
 */

const fs = require('fs');
const path = require('path');
const { forms, THRESHOLDS, EXTRA_NOTE } = require('./forms');

const KITS_COMPONENTS = path.resolve(__dirname, '../../../gbe-assets/kits/cn-ancient/components');

// ── 读取已入库的库基线 ─────────────────────────────────────────────────────
function readLibrary() {
  const ids = [];
  const shortOf = (id) => id.split('.')[2];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (fs.existsSync(path.join(p, 'asset.json'))) {
          ids.push(shortOf(JSON.parse(fs.readFileSync(path.join(p, 'asset.json'), 'utf8')).id));
        } else {
          walk(p);
        }
      }
    }
  })(KITS_COMPONENTS);
  return ids;
}

// ── 主分析 ─────────────────────────────────────────────────────────────────
function analyse(library) {
  const lib = new Set(library);
  const baseSize = lib.size;
  const ordered = forms.slice().sort((a, b) => a.batch - b.batch);

  const steps = [];
  for (const form of ordered) {
    const needed = [...new Set(form.parts)];
    const fresh = needed.filter((p) => !lib.has(p));
    const known = needed.length - fresh.length;
    const extraFresh = fresh.filter((p) => form.extra && form.extra[p]);

    steps.push({
      key: form.key,
      name: form.name,
      batch: form.batch,
      count: form.count,
      tier: form.tier,
      route: form.route,
      needed: needed.length,
      reused: known,
      fresh: fresh.length,
      freshList: fresh,
      extraFresh,
      libAfter: lib.size + fresh.length,
    });

    fresh.forEach((p) => lib.add(p));
  }

  // 判定：量产值取「同一批次内首个非 hero 形制之后的全部形制」为量产组，
  // hero 形制单列更宽阈值（阈值来源见 forms.js）。

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const limit = s.tier === 'hero' ? THRESHOLDS.hero : THRESHOLDS.production;
    // 第一栋是建库期，不参与判定（判据问的是"新建一栋"的边际成本）
    s.isBaseline = i === 0;
    s.limit = limit;
    s.pass = s.isBaseline ? null : s.fresh <= limit;
  }

  return { baseSize, steps };
}

// ── 输出 ───────────────────────────────────────────────────────────────────
function render(result, opts) {
  const { baseSize, steps } = result;
  const L = [];
  const bar = '─'.repeat(94);

  if (!opts.quiet) {
    L.push('');
    L.push('  形制收敛 · 纸面分析（BUILDING-DECOMPOSITION §10.5(c)）');
    L.push(`  库基线：${baseSize} 件（kits/cn-ancient/components）`);
    L.push(`  判定：量产形制 全新型 ≤ ${THRESHOLDS.production} · hero 形制 全新型 ≤ ${THRESHOLDS.hero}`);
    L.push(bar);
    L.push(
      '  #  ' +
        '形制'.padEnd(22) +
        '批'.padEnd(4) +
        '档'.padEnd(11) +
        '需要'.padEnd(6) +
        '复用'.padEnd(6) +
        '★全新'.padEnd(7) +
        '判定'.padEnd(6) +
        '库→'
    );
    L.push(bar);

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const verdict = s.isBaseline ? '建库' : s.pass ? '✓ 过' : '✗ 超';
      L.push(
        '  ' +
          String(i + 1).padEnd(3) +
          s.name.padEnd(22) +
          String(s.batch).padEnd(4) +
          s.tier.padEnd(11) +
          String(s.needed).padEnd(6) +
          String(s.reused).padEnd(6) +
          String(s.fresh).padEnd(7) +
          verdict.padEnd(6) +
          String(s.libAfter)
      );
    }
    L.push(bar);

    // 收敛曲线
    L.push('');
    L.push('  收敛曲线（全新型构件数，越靠右越说明"库已够用"）：');
    const maxFresh = Math.max(...steps.map((s) => s.fresh), 1);
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const w = Math.max(1, Math.round((s.fresh / maxFresh) * 42));
      const block = s.fresh === 0 ? '·' : '█'.repeat(w);
      L.push(`    ${s.name.padEnd(22)} ${String(s.fresh).padStart(3)}  ${block}`);
    }
    L.push('');

    // 新增件明细
    L.push('  新增件明细：');
    for (const s of steps) {
      if (!s.freshList.length) {
        L.push(`    ${s.name}：—（全部复用）`);
        continue;
      }
      const marks = s.freshList.map((p) => (s.extraFresh.includes(p) ? `${p} †` : p));
      L.push(`    ${s.name}：${marks.join(' · ')}`);
    }
    L.push('');
    L.push(`  † = 不在 §9.2 表中。来源：${EXTRA_NOTE}`);
  }

  // 结论
  const judged = steps.filter((s) => !s.isBaseline);
  const failed = judged.filter((s) => !s.pass);
  const maxAfterFirst = judged.length ? Math.max(...judged.map((s) => s.fresh)) : 0;
  const totalFresh = steps.reduce((a, s) => a + s.fresh, 0);
  const extraTotal = steps.reduce((a, s) => a + s.extraFresh.length, 0);

  L.push('');
  L.push(bar);
  L.push('  结论');
  L.push(bar);
  L.push(`  建库期（第 1 栋，配殿）全新型：${steps[0].fresh} 件  —— 这是不可摊薄的入场费`);
  L.push(`  其后各形制全新型：${judged.map((s) => s.fresh).join(' / ')}`);
  L.push(`  其后峰值：${maxAfterFirst} 件（${judged.find((s) => s.fresh === maxAfterFirst)?.name || '—'}）`);
  L.push(`  8 类形制累计新增：${totalFresh} 件（其中 ${extraTotal} 件是 §9.2 表未覆盖的屋顶样式件）`);
  L.push(`  最终库规模：${steps[steps.length - 1].libAfter} 件`);
  L.push('');
  if (failed.length === 0) {
    L.push(`  ✓ 全部 ${judged.length} 个形制通过门槛 —— 纸面收敛成立，值得真造。`);
  } else {
    L.push(`  ✗ ${failed.length} / ${judged.length} 个形制超门槛：`);
    for (const s of failed) {
      L.push(`      ${s.name}（${s.tier}）：${s.fresh} 件 > ${s.limit}  —— ${s.freshList.join(' · ')}`);
    }
  }
  L.push('');
  L.push('  ⚠️ 这是纸面估算，不是实测：验不了「插槽真能对上」，依赖理想构件集的准确性。');
  L.push('     用法限定（§10.5(c)）：纸面通过 → 才值得真造；纸面失败 → 直接回退。');
  L.push('');

  return L.join('\n');
}

function main(argv) {
  const opts = {
    json: argv.includes('--json'),
    quiet: argv.includes('--quiet'),
  };
  const outDir = path.resolve(__dirname, '../out');

  const library = readLibrary();
  if (library.length === 0) {
    console.error(`库为空或路径不存在：${KITS_COMPONENTS}`);
    return 1;
  }

  const result = analyse(library);

  if (opts.json) {
    const payload = { generated_at: new Date().toISOString(), thresholds: THRESHOLDS, ...result };
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, 'convergence-report.json');
    fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log(file);
    return 0;
  }

  console.log(render(result, opts));

  if (!opts.quiet) {
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, 'convergence-report.txt');
    fs.writeFileSync(file, render(result, { quiet: false }), 'utf8');
    console.log(`  报告已落盘：${file}`);
    console.log('');
  }
  return 0;
}

module.exports = { readLibrary, analyse, render };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
