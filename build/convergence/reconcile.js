'use strict';

/**
 * 构件清单的三方对账哨兵 —— BUILDING-DECOMPOSITION §9.1 / §9.2 ↔ forms.js ↔ kit.json
 *
 * 为什么需要这个脚本（历史事故）：
 *   §9.2 曾把 5 件屋顶样式件（硬山 / 悬山 / 攒尖 / 庑殿 / 盝顶）留在**勘误文字**里而没有落成表内行，
 *   那 5 件只存在于本目录 `forms.js` 的 `parts`。后果实测为：`§0`/`§1.2`/`§9.2` 标题/预算行、
 *   `kit.json` 的 `planned` 加总全部停在 45，而只 grep §9.2 的下游工作流（生成队列、
 *   `qiuyuan-guild/reviews/X-0030.md`）系统性漏读这 5 件。**两份真源并存，迟早不一致**。
 *   2026-10-11 把 5 件并入 §9.2（45 → 50 类）后，用本脚本把"表 = 代码 = 覆盖度分母"钉成机器可验。
 *
 * 用法：
 *   node build/convergence/reconcile.js          # 人读；漂移即 exit 1
 *   node build/convergence/reconcile.js --json   # 机器可读（CI / 门禁用）
 *
 * 它只管**一致性**，不管**对错**：三方互相吻合但设计错了，本脚本看不见。
 */

const fs = require('fs');
const path = require('path');
const { forms, allParts, heroExclusiveParts, THRESHOLDS } = require('./forms');
const { readLibrary } = require('./report');

const DOC = path.resolve(__dirname, '../../docs/BUILDING-DECOMPOSITION.md');
const KIT = path.resolve(__dirname, '../../../gbe-assets/kits/cn-ancient/kit.json');

// ── 解析 markdown 表格 ─────────────────────────────────────────────────────
function section(text, startRe, endRe) {
  const s = text.search(startRe);
  if (s < 0) throw new Error(`找不到节标题：${startRe}`);
  const rest = text.slice(s + text.match(startRe)[0].length);
  const e = rest.search(endRe);
  return e < 0 ? rest : rest.slice(0, e);
}

/** §9.2 构件表 → [{ n, id, cat, name, gran, tier, route, leaf }] */
function parseComponentTable(docText) {
  const seg = section(docText, /^### 9\.2 .*$/m, /^### 9\.3 /m);
  const rows = [];
  for (const line of seg.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const c = line.split('|').map((x) => x.trim());
    if (!/^\d+$/.test(c[1] || '')) continue; // 跳过表头 / 分隔行 / 类别小标题
    const m = /^`cn-ancient\.([a-z-]+)\.([a-z0-9-]+)`$/.exec(c[2] || '');
    if (!m) continue;
    rows.push({
      n: Number(c[1]),
      id: c[2].replace(/`/g, ''),
      cat: m[1],
      leaf: m[2],
      label: c[3],
      gran: c[4],
      tier: c[5],
      route: (c[6] || '').replace(/\*/g, ''),
    });
  }
  return rows;
}

/** §9.1 城邑形制配比 → Map(形制名 → 数量) */
function parseFormCounts(docText) {
  const seg = section(docText, /^### 9\.1 .*$/m, /^### 9\.2 /m);
  const out = new Map();
  for (const line of seg.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const c = line.split('|').map((x) => x.trim());
    if (!/^\d+$/.test(c[1] || '')) continue;
    out.set(c[2], Number(c[3]));
  }
  return out;
}

// ── 对账 ───────────────────────────────────────────────────────────────────
function reconcile() {
  const docText = fs.readFileSync(DOC, 'utf8');
  const table = parseComponentTable(docText);
  const docCounts = parseFormCounts(docText);
  const kit = JSON.parse(fs.readFileSync(KIT, 'utf8'));
  const library = new Set(readLibrary());

  const tableLeaves = new Set(table.map((r) => r.leaf));
  const codeLeaves = new Set(allParts());
  const heroOnly = new Set(heroExclusiveParts());
  const heroPending = [...heroOnly].filter((p) => !library.has(p));
  const dupN = table.length - new Set(table.map((r) => r.n)).size;

  const fails = [];
  const push = (label, detail) => fails.push({ label, detail });

  // 1) 代码要的件，表里必须有（这次的事故就是这么漏的）
  const missingInTable = [...codeLeaves].filter((p) => !tableLeaves.has(p));
  if (missingInTable.length) push('forms.js 要的件不在 §9.2 表内', missingInTable);

  // 2) 表里的行必须真有人用（孤儿行 = 白造）
  const orphanRows = table.filter((r) => !codeLeaves.has(r.leaf)).map((r) => r.leaf);
  if (orphanRows.length) push('§9.2 有行无人消费（孤儿件）', orphanRows);

  // 3) 已入库的件必须都在表内（入库后忘了登记 = coverage 与表脱钩）
  const unlistedStock = [...library].filter((p) => !tableLeaves.has(p));
  if (unlistedStock.length) push('已入库但 §9.2 未登记', unlistedStock);

  // 4) 来源裁决（§10.5(b)）的机器形式，两个**单调**方向：
  //    · 标 B 的行必须真的只被 hero 消费（否则该件不能靠 hero 拆分供给）
  //    · 尚未入库的 hero 专属件必须全部标 B（否则会被当成可直生件，绕过裁决）
  //    ★ 刻意不写等号：hero 件一旦随拆分入库，「未入库的 hero 专属件」就会缩小，
  //      等号判据会开始**误报** —— 会狼来了的门禁最后等于没有门禁。
  const tableB = table.filter((r) => r.route === 'B').map((r) => r.leaf).sort();
  const bNotExclusive = tableB.filter((p) => !heroOnly.has(p));
  if (bNotExclusive.length) push('§9.2 标 B 的件并非 hero 专属（量产也在用，不能只靠拆分）', bNotExclusive);
  const pendingNotB = heroPending.filter((p) => !tableB.includes(p));
  if (pendingNotB.length) push('未入库的 hero 专属件未标 B（会被当成可直生件）', pendingNotB);

  // 5) 程序化 P 行的两个单调方向：
  //    · 标 P 的行应当已在库（P = 0 成本确定性生成，长期"计划了却没生成"= 排期谎言）
  //    · 已入库的件若不在 P 行里，**是正常的**（A / B 件陆续入库），只核对它仍是 §9.2 的行（上面第 3 项已管）
  const tableP = table.filter((r) => r.route === 'P').map((r) => r.leaf).sort();
  const pMissing = tableP.filter((p) => !library.has(p));
  if (pMissing.length) push('§9.2 标 P 的件尚未入库（程序化件不该有生成债）', pMissing);

  // 6) kit.json 的 planned（分母）逐类别 == §9.2 表行数
  const planned = kit.coverage || {};
  const cats = [...new Set(table.map((r) => r.cat))];
  for (const cat of cats) {
    const key = `components/${cat}`;
    if (!planned[key]) {
      push('kit.json coverage 缺该类别', key);
      continue;
    }
    const inTable = table.filter((x) => x.cat === cat).length;
    if (planned[key].planned !== inTable) {
      push(`coverage.${key}.planned ≠ §9.2 该类行数`, { planned: planned[key].planned, 表: inTable });
    }
  }
  const plannedSum = cats.reduce((a, cat) => a + ((planned[`components/${cat}`] || {}).planned || 0), 0);
  if (plannedSum !== table.length) push('planned 加总 ≠ §9.2 总行数', { plannedSum, 表: table.length });

  // 7) §9.1 数量列 == forms.js 的 count（一个数不许写两处）
  for (const f of forms) {
    if (!docCounts.has(f.name)) {
      push('forms.js 的形制在 §9.1 找不到同名行', f.name);
      continue;
    }
    if (docCounts.get(f.name) !== f.count) {
      push(`§9.1「${f.name}」数量 ≠ forms.count`, { 文档: docCounts.get(f.name), 代码: f.count });
    }
  }
  const asmPlanned = planned['assemblies/building'] && planned['assemblies/building'].planned;
  if (asmPlanned !== docCounts.size) push('assemblies 规划数 ≠ §9.1 形制数', { coverage: asmPlanned, 文档: docCounts.size });

  // 8) 行号连续（防止插入件后编号重排漏改）
  const nums = table.map((r) => r.n);
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      push('§9.2 行号不连续', { 位置: i + 1, 实际: nums[i] });
      break;
    }
  }
  if (dupN) push('§9.2 行号重复', dupN);

  return {
    ok: fails.length === 0,
    counts: {
      表行数: table.length,
      代码并集: codeLeaves.size,
      已入库: library.size,
      待生成: table.length - library.size,
      路线P: tableP.length,
      路线A: table.filter((r) => r.route === 'A').length,
      路线B: tableB.length,
      hero专属: heroOnly.size,
      hero未入库走B: heroPending.length,
      形制数: docCounts.size,
      城邑栋数合计: [...docCounts.values()].reduce((a, v) => a + v, 0),
      planned加总: plannedSum,
    },
    thresholds: THRESHOLDS,
    fails,
  };
}

function main() {
  const asJson = process.argv.includes('--json');
  let res;
  try {
    res = reconcile();
  } catch (e) {
    console.error(`对账无法执行：${e.message}`);
    return 2;
  }
  if (asJson) {
    console.log(JSON.stringify(res, null, 2));
    return res.ok ? 0 : 1;
  }
  console.log('\n  §9.2 ↔ forms.js ↔ kit.json 三方对账');
  console.log('  ' + '─'.repeat(72));
  for (const [k, v] of Object.entries(res.counts)) console.log(`    ${k.padEnd(16)} ${v}`);
  console.log('  ' + '─'.repeat(72));
  if (res.ok) {
    console.log(`  ✓ 全绿：${res.counts.表行数} 类构件，三方逐类别吻合，路线标注与来源裁决一致。\n`);
    return 0;
  }
  console.log(`  ✗ ${res.fails.length} 处漂移：`);
  for (const f of res.fails) console.log(`    · ${f.label} → ${JSON.stringify(f.detail)}`);
  console.log('\n     修法：改**真源**（§9.2 表），再同步 forms.js 与 kit.json；别只改镜像。\n');
  return 1;
}

if (require.main === module) process.exit(main());

module.exports = { reconcile, parseComponentTable, parseFormCounts };
