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
const { forms, THRESHOLDS, heroExclusiveParts } = require('./forms');

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
  const baseline = new Set(lib); // 循环会改写 lib，基线另存一份
  const ordered = forms.slice().sort((a, b) => a.batch - b.batch);
  const heroOnly = new Set(heroExclusiveParts()); // 只被 hero 形制消费 = 路线 B 的产物集

  const steps = [];
  for (const form of ordered) {
    const needed = [...new Set(form.parts)];
    const fresh = needed.filter((p) => !lib.has(p));
    const known = needed.length - fresh.length;
    const bFresh = fresh.filter((p) => heroOnly.has(p)); // 该形制里须走拆分的件

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
      bFresh,
      aFresh: fresh.length - bFresh.length,
      libAfter: lib.size + fresh.length,
    });

    fresh.forEach((p) => lib.add(p));
  }

  // 判定（§10.5(b) 2026-10-11 改写）：
  //   · 量产形制 —— 卡**件数**：全新型 ≤ THRESHOLDS.production
  //   · hero 形制 —— **不卡件数，卡来源**：其全新型必须全部落进 hero-exclusive 集（= 由整栋拆分产出）
  //     一旦某件 hero 全新型同时被量产形制消费，它就不能只从 hero 拆分里拿，来源约束即被打破。
  // 第一栋是建库期，不参与判定（判据问的是"新建一栋"的边际成本）。

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const isHero = s.tier === 'hero';
    s.isHero = isHero;
    s.isBaseline = i === 0;
    s.limit = isHero ? null : THRESHOLDS.production;
    s.pass = s.isBaseline
      ? null
      : isHero
        ? s.freshList.every((p) => heroOnly.has(p))
        : s.fresh <= THRESHOLDS.production;
  }

  return {
    baseSize,
    steps,
    heroOnly: [...heroOnly],
    // 「只被 hero 消费」不等于「要走 B」：其中已有 2 件由程序化路线入库（P · 0 成本、已在库），
    // 来源裁决只管**尚未入库**的那部分 —— 混着说会把已入库件误标成待产出。
    heroInStock: [...heroOnly].filter((p) => baseline.has(p)),
    heroPending: [...heroOnly].filter((p) => !baseline.has(p)),
  };
}

// ── 输出 ───────────────────────────────────────────────────────────────────
function render(result, opts) {
  const { baseSize, steps, heroOnly, heroInStock, heroPending } = result;
  const L = [];
  const bar = '─'.repeat(94);

  if (!opts.quiet) {
    L.push('');
    L.push('  形制收敛 · 纸面分析（BUILDING-DECOMPOSITION §10.5(c)）');
    L.push(`  库基线：${baseSize} 件（kits/cn-ancient/components）`);
    L.push(`  判定：量产形制 全新型 ≤ ${THRESHOLDS.production} · hero 形制 不卡件数、卡来源（§10.5(b) 2026-10-11 裁决）`);
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
      const verdict = s.isBaseline
        ? '建库'
        : s.isHero
          ? s.pass
            ? 'B源✓'
            : '混源✗'
          : s.pass
            ? '✓ 过'
            : '✗ 超';
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
      const marks = s.freshList.map((p) => (heroOnly.includes(p) ? `${p} ⛓` : p));
      L.push(`    ${s.name}：${marks.join(' · ')}`);
    }
    L.push('');
    L.push(`  ⛓ = 只被 hero 形制消费的件，共 ${heroOnly.length} 件：已入库 ${heroInStock.length} 件（P · 0 成本）＝${heroInStock.join(' · ') || '—'}`);
    L.push(`      未入库 ${heroPending.length} 件 → 必须由整栋拆分（路线 B）产出，禁止另开 AI 直生（§10.5(b) 裁决）＝${heroPending.join(' · ')}`);
    L.push('  ★ 所有短名都应在 BUILDING-DECOMPOSITION §9.2 表内逐行存在；对账跑 `node build/convergence/reconcile.js`。');
  }

  // 结论
  const judged = steps.filter((s) => !s.isBaseline);
  const failed = judged.filter((s) => !s.pass);
  const maxAfterFirst = judged.length ? Math.max(...judged.map((s) => s.fresh)) : 0;
  const totalFresh = steps.reduce((a, s) => a + s.fresh, 0);
  const bTotal = steps.reduce((a, s) => a + s.bFresh.length, 0);

  L.push('');
  L.push(bar);
  L.push('  结论');
  L.push(bar);
  L.push(`  建库期（第 1 栋，配殿）全新型：${steps[0].fresh} 件  —— 这是不可摊薄的入场费`);
  L.push(`  其后各形制全新型：${judged.map((s) => s.fresh).join(' / ')}`);
  L.push(`  其后峰值：${maxAfterFirst} 件（${judged.find((s) => s.fresh === maxAfterFirst)?.name || '—'}）`);
  L.push(`  8 类形制累计新增：${totalFresh} 件（其中 ${bTotal} 件属路线 B = hero 拆分产物，不另付生成费）`);
  L.push(`  最终库规模：${steps[steps.length - 1].libAfter} 件  —— 必须等于 BUILDING-DECOMPOSITION §9.2 的行数`);
  L.push('');
  const prodFail = failed.filter((s) => !s.isHero);
  const heroFail = failed.filter((s) => s.isHero);
  if (failed.length === 0) {
    const heroCnt = judged.filter((s) => s.isHero).length;
    L.push(
      `  ✓ 量产 ${judged.length - heroCnt} 个形制 ≤ ${THRESHOLDS.production} 件 · ` +
        `hero ${heroCnt} 个形制来源约束成立 —— 纸面收敛成立，值得真造。`
    );
  } else {
    L.push(`  ✗ ${failed.length} / ${judged.length} 个形制不成立：`);
    for (const s of prodFail) {
      L.push(`      [件数] ${s.name}（${s.tier}）：${s.fresh} 件 > ${s.limit}  —— ${s.freshList.join(' · ')}`);
    }
    for (const s of heroFail) {
      const off = s.freshList.filter((p) => !heroOnly.includes(p));
      L.push(`      [来源] ${s.name}：${off.join(' · ')} 同时被量产形制消费 → 不能只靠 hero 拆分产出`);
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
