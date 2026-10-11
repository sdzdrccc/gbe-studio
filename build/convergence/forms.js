'use strict';

/**
 * 8 类形制的「理想构件集」—— §10.5(c) 纸面收敛分析的输入
 *
 * ⚠️ 本文件是**推定模型**，不是实测数据。
 *    用途：在造出任何一件构件之前，估算「每新增一个形制还需要多少全新构件」。
 *    权威真源是 docs/BUILDING-DECOMPOSITION.md §9.1（城邑形制配比）与 §9.2（**50 类**构件表）；
 *    构件短名 = asset.id 的第三段，**必须能在 §9.2 表里逐行找到**。
 *
 * ★ 同步纪律（2026-10-11 新增）：本文件与 §9.1 / §9.2 / kit.json 的 `coverage.*.planned` 四方对账，
 *    跑 `node build/convergence/reconcile.js`（漂移即非零退出）。历史上 §9.2 少 5 件屋顶样式件、
 *    本文件却独自持有它们，两份"真源"并存的后果是下游扫表的工作流系统性漏生成 —— 不再重演。
 *    旧的「屋顶件只活在本文件的 extra 字段里」机制已随 5 件并入 §9.2 而退役。
 *
 * 三档统计的口径见 §10.5(a)：
 *    ① 全新型       = 短名从未在任何已建形制中出现过
 *    ② 同型新尺寸   = 短名出现过，但尺寸签名是新的
 *    ③ 纯引用       = 短名与尺寸都已在库
 *
 * 本文件只声明「型」层面的需求（① 的判定依据）。② 的尺寸层面另见 `dims` 字段，
 * 目前仅对「线性件」（直墙 / 阶条石 / 枋 / 檩）显式声明——其余件默认一型一尺寸。
 *
 * ★ 场景口径：本文件的 `count` 是**远期城邑**配比（§9.1 · 28 栋）。
 *    M4 首批是**村落**（槐阴村 · §9.4），复用 `minju` / `lang` 两个形制的构件集、只改数量与材质，
 *    **不新增形制条目**；村落数量归场景 manifest（dalu 侧产生方），不在本文件。
 */

const forms = [
  {
    key: 'peidian',
    name: '配殿（歇山单檐）',
    batch: 2,
    count: 4,
    tier: 'mass',
    route: 'A + 模板',
    parts: [
      'podium-three-step-a',
      'curb-stone-straight',
      'stair-flight-a',
      'plinth-fupen-a',
      'yanzhu-round-a',
      'corner-round-a',
      'guazhu-a',
      'efang-group-a',
      'liang-five-purlin',
      'jiaoliang-carved',
      'zhutouke-a',
      'pingshenke-a',
      'zhuanjiaoke-a',
      'qiang-straight-a',
      'qiang-corner-a',
      'shanqiang-a',
      'door-geshan-a',
      'window-linghua-a',
      'xieshan-single-a',
      'tile-field-pantile',
      'eave-rafter-a',
      'flying-rafter-a',
      'purlin-round-a',
      'ridge-main-a',
      'ridge-vertical-a',
      'ridge-hip-a',
      'ridge-tile-cylinder',
      'gable-board-a',
      'balustrade-straight-a',
      'balustrade-corner-a',
      'chiwen-a',
      'qiaoji-a',
      'xuanyu-a',
      'ding-door',
    ],
  },
  {
    key: 'minju',
    name: '民居（硬山）',
    batch: 3,
    count: 8,
    tier: 'component',
    route: 'A + 模板',
    parts: [
      'curb-stone-straight',
      'plinth-fupen-a',
      'yanzhu-round-a',
      'guazhu-a',
      'efang-group-a',
      'liang-five-purlin',
      'qiang-straight-a',
      'qiang-corner-a',
      'shanqiang-a',
      'door-panel-double-a',
      'window-fan-lattice-a',
      'yingshan-single-a',
      'tile-field-pantile',
      'eave-rafter-a',
      'purlin-round-a',
      'ridge-main-a',
      'ridge-tile-cylinder',
      'ding-door',
    ],
  },
  {
    key: 'shangpu',
    name: '商铺（悬山带前廊）',
    batch: 3,
    count: 5,
    tier: 'mass',
    route: 'A + 模板',
    parts: [
      'curb-stone-straight',
      'plinth-fupen-a',
      'yanzhu-round-a',
      'guazhu-a',
      'efang-group-a',
      'liang-five-purlin',
      'qiang-straight-a',
      'qiang-corner-a',
      'door-panel-double-a',
      'door-geshan-a',
      'xuanshan-single-a',
      'tile-field-pantile',
      'eave-rafter-a',
      'flying-rafter-a',
      'purlin-round-a',
      'ridge-main-a',
      'ridge-tile-cylinder',
      'gable-board-a',
      'qiaoji-a',
      'ding-door',
    ],
  },
  {
    key: 'lang',
    name: '廊 / 连廊',
    batch: 3,
    count: 3,
    tier: 'component',
    route: 'A + 阵列（continue 插槽）',
    parts: [
      'curb-stone-straight',
      'plinth-fupen-a',
      'yanzhu-round-a',
      'guazhu-a',
      'efang-group-a',
      'liang-five-purlin',
      'tile-field-pantile',
      'eave-rafter-a',
      'purlin-round-a',
      'ridge-main-a',
      'ridge-tile-cylinder',
      'balustrade-straight-a',
      'balustrade-corner-a',
    ],
  },
  {
    key: 'ting',
    name: '亭（攒尖）',
    batch: 3,
    count: 3,
    tier: 'mass',
    route: 'A + 模板',
    parts: [
      'plinth-fupen-a',
      'yanzhu-round-a',
      'corner-round-a',
      'guazhu-a',
      'efang-group-a',
      'cuanjian-single-a',
      'tile-field-pantile',
      'eave-rafter-a',
      'flying-rafter-a',
      'purlin-round-a',
      'ridge-tile-cylinder',
      'balustrade-straight-a',
      'balustrade-corner-a',
      'taoshou-a',
      'jishou-walk-a',
    ],
  },
  {
    key: 'paifang',
    name: '牌坊',
    batch: 3,
    count: 2,
    tier: 'mass',
    route: 'B（整栋拆分）',
    parts: [
      'curb-stone-straight',
      'podium-three-step-a',
      'yanzhu-round-a',
      'corner-round-a',
      'efang-group-a',
      'caihua-fang-a',
      'luding-single-a',
      'tile-field-pantile',
      'ridge-main-a',
      'chiwen-a',
      'qiaoji-a',
      'ding-door',
    ],
  },
  {
    key: 'zhudian',
    name: '主殿（歇山重檐）',
    batch: 4,
    count: 1,
    tier: 'hero',
    route: 'B + 模板',
    parts: [
      'podium-three-step-a',
      'curb-stone-straight',
      'stair-flight-a',
      'plinth-fupen-a',
      'plinth-lotus-a',
      'yanzhu-round-a',
      'jinzhu-round-a',
      'corner-round-a',
      'guazhu-a',
      'efang-group-a',
      'caihua-fang-a',
      'liang-seven-purlin',
      'liang-five-purlin',
      'jiaoliang-carved',
      'zhutouke-a',
      'pingshenke-a',
      'zhuanjiaoke-a',
      'qiang-straight-a',
      'qiang-corner-a',
      'shanqiang-a',
      'door-geshan-a',
      'window-linghua-a',
      'xieshan-lower-eave-a',
      'xieshan-upper-ridge-a',
      'tile-field-pantile',
      'tile-field-cylinder',
      'eave-rafter-a',
      'flying-rafter-a',
      'purlin-round-a',
      'ridge-main-a',
      'ridge-vertical-a',
      'ridge-hip-a',
      'ridge-tile-cylinder',
      'gable-board-a',
      'balustrade-straight-a',
      'balustrade-corner-a',
      'chiwen-a',
      'taoshou-a',
      'qiaoji-a',
      'xuanyu-a',
      'jishou-walk-a',
      'ding-door',
    ],
  },
  {
    key: 'chengmenlou',
    name: '城门楼',
    batch: 4,
    count: 2,
    tier: 'hero',
    route: 'B + 模板',
    parts: [
      'podium-three-step-a',
      'curb-stone-straight',
      'stair-flight-a',
      'plinth-fupen-a',
      'yanzhu-round-a',
      'corner-round-a',
      'guazhu-a',
      'efang-group-a',
      'liang-seven-purlin',
      'jiaoliang-carved',
      'zhutouke-a',
      'pingshenke-a',
      'zhuanjiaoke-a',
      'qiang-straight-a',
      'qiang-corner-a',
      'door-panel-double-a',
      'ding-door',
      'wudian-single-a',
      'tile-field-pantile',
      'eave-rafter-a',
      'flying-rafter-a',
      'purlin-round-a',
      'ridge-main-a',
      'ridge-vertical-a',
      'ridge-hip-a',
      'ridge-tile-cylinder',
      'chiwen-a',
      'taoshou-a',
      'jishou-walk-a',
      'balustrade-straight-a',
      'balustrade-corner-a',
    ],
  },
];

// §10.5(b) 判定门槛（2026-10-11 随大人裁决改写）
const THRESHOLDS = {
  // 量产形制：终检全新型 ≤ 3 —— 这条是**真契约**（批 3 终检判失败以此为准）
  production: 3,
  // hero 形制：**不设件数门槛**。裁决 = 「卡来源、不卡件数」（§10.5(b)）。
  // 历史注：v0.5.1 的分析在这里自用过 `hero: 6`，而文档从未承认过 6 ——
  // 那正是「两份真源并存」的事故形状，本次连阈值一起删掉，改为下面的来源约束。
  hero: null,
};

// ★ hero 来源约束（§10.5(b) 已裁决）：只被 hero 形制消费的构件，必须由整栋拆分（路线 B）的
//   产物入库，**禁止为 hero 单开 AI 直生**。`report.js` 用它判定 hero 行，`reconcile.js`
//   用它核对 §9.2 的路线列。集合由本文件自动推导，不手填——手填就会再长出一份真源。
const HERO_SOURCE_RULE = 'hero-exclusive parts must come from route B (整栋拆分产物), never AI-direct';

/** 全部形制消费到的构件短名（去重 · 按 §9.2 表顺序无关） */
function allParts() {
  const set = new Set();
  for (const f of forms) for (const p of f.parts) set.add(p);
  return [...set].sort();
}

/**
 * 「只被 hero 形制消费」的构件短名 = 路线 B 的产物集（§10.5(b) 的来源裁决）。
 * 自动推导，不维护第二份名单。
 */
function heroExclusiveParts() {
  const hero = new Set();
  const nonHero = new Set();
  for (const f of forms) {
    for (const p of new Set(f.parts)) (f.tier === 'hero' ? hero : nonHero).add(p);
  }
  return [...hero].filter((p) => !nonHero.has(p)).sort();
}

module.exports = { forms, THRESHOLDS, HERO_SOURCE_RULE, allParts, heroExclusiveParts };
