'use strict';

/**
 * components.js —— 18 件程序化构件的定义（BUILDING-DECOMPOSITION §9.2 中标记为 P 的全部）
 *
 * 这 18 件是整套构件化方案里**性价比最高的一笔**：0 credit、确定性可重建、
 * 不依赖任何平台与网络。它们撑起了承重链的下半截（台基 → 柱础 → 柱 → 枋 → 梁 → 屋面）
 * 与围护的骨架（阶条石 / 墙段 / 转角墙 / 栏杆）。
 *
 * ── 三条硬纪律（写在定义里，也由 generate.js 逐件复验）──
 *  ① 插槽位置**必须落 snap_m = 0.5 m 定位网格**（attach 类除外）。定位一松，跨批次拼装就散了。
 *  ② 水平尺寸（x 宽 / z 深）**落 0.25 m 造型网格**。这是"细部尺寸归整"的软约束，
 *     但本批刻意全部满足 —— 细部构件守住造型网格，装配才不会出现 3 cm 的错缝。
 *  ③ ground-foot 插槽**固定落在局部原点**。L 形构件（转角墙 / 栏杆转角）的底面重心
 *     落不到网格上，所以统一以"轴心即承重基准点"为准 —— 简单、可判定、无歧义。
 *
 * ── 局部坐标（写定义时的心智模型，generate.js 会统一归位到 bottom-center）──
 *   · 一律**底面在 y = 0** 起手，高度向上长
 *   · 一律**水平居中**（L 形件除外，见各件注释里的 offset 推导）
 */

const { addBox, addCylinder, addDome, addExtrude, addSweptBeam, troughProfile } = require('./geom');

const V = '1.0.0';
const LIC = 'CC0-1.0';

// ── 插槽工厂（把 mate_types 的约定收在一处，免得 18 件各写一遍写岔）─────────────
const MATE = {
  foot: ['stack-up', 'roof-seat'], // 底面：坐在别人的顶面上
  top: ['ground-foot'], // 顶面：接住别人的底面
  rest: ['stack-up', 'roof-seat'], // 底面（梁类）：坐在别人的顶面上
  line: ['wall-line'],
  cont: ['continue'],
  ridge: ['ridge-point'],
  attach: ['attach', 'wall-line', 'stack-up', 'roof-seat', 'ridge-point', 'continue'],
};

const sock = {
  foot: (p = [0, 0, 0], note) => ({
    name: 'bottom',
    type: 'ground-foot',
    direction: '-y',
    position_m: p,
    mate_types: MATE.foot,
    grid_locked: true,
    note,
  }),
  top: (p, note) => ({
    name: 'top',
    type: 'stack-up',
    direction: '+y',
    position_m: p,
    mate_types: MATE.top,
    grid_locked: true,
    note,
  }),
  rest: (name, p, note) => ({
    name,
    type: 'stack-up',
    direction: '-y',
    position_m: p,
    mate_types: MATE.rest,
    grid_locked: true,
    note,
  }),
  west: (p, note) => ({
    name: 'end-west',
    type: 'wall-line',
    direction: '-x',
    position_m: p,
    mate_types: MATE.line,
    grid_locked: true,
    note,
  }),
  east: (p, note) => ({
    name: 'end-east',
    type: 'wall-line',
    direction: '+x',
    position_m: p,
    mate_types: MATE.line,
    grid_locked: true,
    note,
  }),
  south: (p, note) => ({
    name: 'end-south',
    type: 'wall-line',
    direction: '-z',
    position_m: p,
    mate_types: MATE.line,
    grid_locked: true,
    note,
  }),
  north: (p, note) => ({
    name: 'end-north',
    type: 'wall-line',
    direction: '+z',
    position_m: p,
    mate_types: MATE.line,
    grid_locked: true,
    note,
  }),
  run: (p, dir, step, note) => ({
    name: dir === '-x' || dir === '+x' ? 'run-east' : 'run-south',
    type: 'continue',
    direction: dir,
    position_m: p,
    step_m: step,
    mate_types: MATE.cont,
    grid_locked: true,
    note,
  }),
  ridge: (name, p, dir, note) => ({
    name,
    type: 'ridge-point',
    direction: dir,
    position_m: p,
    mate_types: MATE.ridge,
    grid_locked: true,
    note,
  }),
  mount: (p, dir, note) => ({
    name: 'mount',
    type: 'attach',
    direction: dir,
    position_m: p,
    mate_types: MATE.attach,
    note,
  }),
};

// ═══════════════════════════════════════════════════════════════════════════
// 台基 components/base
// ═══════════════════════════════════════════════════════════════════════════

const components = [
  {
    name: 'curb-stone-straight',
    title: '阶条石（直段）',
    category: 'components/base',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['base', 'curb', 'stone', '程序化'],
    summary: '台基 / 院墙的压边石，2 m 定型段。底面留 0.06 m 收进形成"落堂"阴影线，是石活最省面的做法。',
    collision: 'box',
    slots: [{ slot: 'base', ref: 'stone/qing-shi' }],
    sockets: [
      sock.foot([0, 0, 0], '承重基准点（轴心）'),
      sock.top([0, 0.5, 0], '上承墙身 / 栏板'),
      sock.west([-1.0, 0, 0]),
      sock.east([1.0, 0, 0]),
      sock.run([1.0, 0, 0], '+x', 2.0, '沿墙线重复，步距 = wall_module_m'),
    ],
    build(M) {
      addBox(M, { size: [2.0, 0.44, 0.5], at: [0, 0.28, 0], slot: 'base' });
      addBox(M, { size: [1.9, 0.06, 0.4], at: [0, 0.03, 0], slot: 'base' });
    },
  },

  {
    name: 'stair-flight-a',
    title: '踏跺（御路）',
    category: 'components/base',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['base', 'stair', 'stone', '程序化'],
    summary: '四级踏步，总高 1.0 m 与三层须弥座台基齐平；中央 1.0 m 宽御路斜置。踏步高取 0.25（造型网格），总高取 0.5 的整数倍以保顶面落定位网格。',
    collision: 'box',
    slots: [
      { slot: 'base', ref: 'stone/qing-shi' },
      { slot: 'trim', ref: 'stone/han-bai-yu' },
    ],
    sockets: [
      sock.foot([0, 0, 0]),
      {
        name: 'top',
        type: 'roof-seat',
        direction: '+y',
        position_m: [0, 1.0, 0],
        mate_types: ['ground-foot', 'stack-up'],
        grid_locked: true,
        note: '踏步顶面与台基面齐平，承接上层构件',
      },
      sock.west([-1.5, 0, 0]),
      sock.east([1.5, 0, 0]),
    ],
    build(M) {
      const steps = 4;
      const rise = 0.25;
      const tread = 0.5;
      for (let i = 0; i < steps; i++) {
        const h = rise * (i + 1);
        const d = 2.0 - tread * i;
        addBox(M, { size: [3.0, h, d], at: [0, h / 2, (tread * i) / 2], slot: 'base' });
      }
      // 御路：底沿贴合踏步鼻线（-1.0,0.25 → 0.5,1.0），绕 X 转 -26.57°
      addBox(M, { size: [1.0, 0.06, 1.5], at: [0, 0.62, -0.25], rot: [-0.4636, 0, 0], slot: 'trim' });
    },
  },

  {
    name: 'plinth-fupen-a',
    title: '柱础·覆盆式',
    category: 'components/base',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['base', 'plinth', 'stone', '程序化'],
    summary: '方座 0.75 见方 + 双段覆盆（0.6 见方）。高度取 0.5 m（不是 0.25/0.3）—— 参与竖向堆叠的构件，顶面必须落定位网格，所以柱础高度只能从 {0.5, 1.0} 取值（§3.3）。',
    collision: 'box',
    slots: [
      { slot: 'base', ref: 'stone/bai-shi' },
      { slot: 'trim', ref: 'stone/qing-shi' },
    ],
    sockets: [sock.foot([0, 0, 0]), sock.top([0, 0.5, 0], '柱脚落此面')],
    build(M) {
      addBox(M, { size: [0.75, 0.15, 0.75], at: [0, 0.075, 0], slot: 'trim' });
      addCylinder(M, { r1: 0.3, r2: 0.24, h: 0.15, seg: 16, at: [0, 0.15, 0], slot: 'base', capTop: false });
      addCylinder(M, { r1: 0.24, r2: 0.14, h: 0.2, seg: 16, at: [0, 0.3, 0], slot: 'base' });
    },
  },

  {
    name: 'plinth-lotus-a',
    title: '柱础·莲瓣式',
    category: 'components/base',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['base', 'plinth', 'lotus', '程序化'],
    summary: '八角方座 + 八瓣莲座 + 覆盆顶。莲瓣用 8 片旋转薄盒，是"程序化做装饰"的示范：0 成本、可比 AI 更规整。同样 0.5 m 高。',
    collision: 'box',
    slots: [
      { slot: 'base', ref: 'stone/bai-shi' },
      { slot: 'trim', ref: 'stone/qing-shi' },
    ],
    sockets: [sock.foot([0, 0, 0]), sock.top([0, 0.5, 0], '柱脚落此面')],
    build(M) {
      addCylinder(M, { r1: 0.375, r2: 0.375, h: 0.15, seg: 8, at: [0, 0, 0], slot: 'trim' });
      addCylinder(M, { r1: 0.3, r2: 0.28, h: 0.2, seg: 16, at: [0, 0.15, 0], slot: 'base', capTop: false });
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        addBox(M, {
          size: [0.06, 0.2, 0.16],
          at: [Math.cos(a) * 0.3, 0.25, Math.sin(a) * 0.3],
          rot: [0, -a, 0],
          slot: 'base',
        });
      }
      addCylinder(M, { r1: 0.24, r2: 0.18, h: 0.15, seg: 16, at: [0, 0.35, 0], slot: 'base' });
    },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // 柱网 components/pillar
  // ═════════════════════════════════════════════════════════════════════════

  {
    name: 'guazhu-a',
    title: '瓜柱',
    category: 'components/pillar',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['pillar', 'post', 'timber', '程序化'],
    summary: '梁上短柱，径 0.5、高 1.0，两端收细中段饱满（"瓜"形）。上下都是 stack-up —— 它只做竖向传递，不落地。',
    collision: 'box',
    slots: [{ slot: 'pillar', ref: 'timber/hong-mu' }],
    sockets: [
      sock.foot([0, 0, 0], '坐在下层梁背'),
      sock.top([0, 1.0, 0], '承接上层梁'),
    ],
    build(M) {
      addCylinder(M, { r1: 0.175, r2: 0.25, h: 0.3, seg: 12, at: [0, 0, 0], slot: 'pillar', capTop: false });
      addCylinder(M, { r1: 0.25, r2: 0.25, h: 0.4, seg: 12, at: [0, 0.3, 0], slot: 'pillar', capTop: false, capBottom: false });
      addCylinder(M, { r1: 0.25, r2: 0.175, h: 0.3, seg: 12, at: [0, 0.7, 0], slot: 'pillar' });
    },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // 梁架 components/beam
  // ═════════════════════════════════════════════════════════════════════════

  {
    name: 'efang-group-a',
    title: '额枋组（额枋 + 平板枋）',
    category: 'components/beam',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['beam', 'efang', 'timber', '程序化'],
    summary: '按粒度判据 4 合并的成果：额枋与平板枋永远同时出现、不会被单独替换，拆开只会增加装配复杂度。长 4.0 m = pillar_spacing_m 整数倍。',
    collision: 'box',
    slots: [
      { slot: 'beam', ref: 'timber/zhu-hong' },
      { slot: 'trim', ref: 'timber/hei-qi' },
    ],
    sockets: [
      sock.west([-2.0, 0, 0]),
      sock.east([2.0, 0, 0]),
      sock.foot([0, 0, 0], '两端搭柱头，但底面中心亦须可承接'),
      sock.top([0, 0.5, 0], '平板枋顶承斗拱'),
      sock.run([2.0, 0, 0], '+x', 4.0, '沿柱网重复，步距 = pillar_spacing_m 4 m'),
    ],
    build(M) {
      addBox(M, { size: [4.0, 0.3, 0.3], at: [0, 0.15, 0], slot: 'beam' });
      addBox(M, { size: [4.0, 0.2, 0.5], at: [0, 0.4, 0], slot: 'trim' });
    },
  },

  {
    name: 'liang-seven-purlin',
    title: '七架梁',
    category: 'components/beam',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['beam', 'liang', 'timber', '程序化'],
    summary: '七檩大梁，0.5 宽 × 8 m 跨。**起拱 0.06 m**：两端底面落 0（坐柱头）、中间上凸，顶面恰好 0.50 m 落定位网格 —— 起拱是形状，不是可以牺牲掉的精度。',
    collision: 'box',
    slots: [{ slot: 'beam', ref: 'timber/hong-mu' }],
    sockets: [
      sock.rest('bearing-west', [0, 0, -4.0], '西端梁头坐柱/檩'),
      sock.rest('bearing-east', [0, 0, 4.0], '东端梁头坐柱/檩'),
      sock.top([0, 0.5, 0], '梁背承瓜柱（取梁中最上点）'),
    ],
    build(M) {
      addSweptBeam(M, { w: 0.5, h: 0.44, len: 8.0, seg: 8, camber: 0.06, at: [0, 0, 0], slot: 'beam' });
    },
  },

  {
    name: 'liang-five-purlin',
    title: '五架梁',
    category: 'components/beam',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['beam', 'liang', 'timber', '程序化'],
    summary: '五檩梁，6 m 跨，起拱 0.05 m。与七架梁同配方不同参数 —— 这正是"参数化胜过逐个建模"的最小例子。',
    collision: 'box',
    slots: [{ slot: 'beam', ref: 'timber/hong-mu' }],
    sockets: [
      sock.rest('bearing-west', [0, 0, -3.0], '西端梁头坐柱/檩'),
      sock.rest('bearing-east', [0, 0, 3.0], '东端梁头坐柱/檩'),
      sock.top([0, 0.5, 0], '梁背承瓜柱'),
    ],
    build(M) {
      addSweptBeam(M, { w: 0.5, h: 0.45, len: 6.0, seg: 6, camber: 0.05, at: [0, 0, 0], slot: 'beam' });
    },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // 屋身 components/wall
  // ═════════════════════════════════════════════════════════════════════════

  {
    name: 'qiang-straight-a',
    title: '直墙段（2 m 模数）',
    category: 'components/wall',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['wall', 'qiang', 'brick', '程序化'],
    summary: '石勒脚 + 收进墙身 + 压顶，三段式。长 2.0 m = wall_module_m，高 3.0 m = story_heights_m[0]。墙身收进 0.05 m 换一条影子线，比贴图便宜。',
    collision: 'box',
    slots: [
      { slot: 'wall', ref: 'earth/qing-zhuan' },
      { slot: 'trim', ref: 'stone/qing-shi' },
    ],
    sockets: [
      sock.foot([0, 0, 0]),
      sock.top([0, 3.0, 0], '墙顶可承檩 / 压顶'),
      sock.west([-1.0, 0, 0]),
      sock.east([1.0, 0, 0]),
      sock.run([1.0, 0, 0], '+x', 2.0, '沿墙线重复，步距 = wall_module_m'),
    ],
    build(M) {
      addBox(M, { size: [2.0, 0.3, 0.5], at: [0, 0.15, 0], slot: 'trim' });
      addBox(M, { size: [2.0, 2.55, 0.4], at: [0, 1.575, 0], slot: 'wall' });
      addBox(M, { size: [2.0, 0.15, 0.5], at: [0, 2.925, 0], slot: 'wall' });
    },
  },

  {
    name: 'qiang-corner-a',
    title: '转角墙墩（角墩）',
    category: 'components/wall',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['wall', 'corner', 'pier', '程序化'],
    summary:
      '枢轴式角墩，0.75 见方、3 m 高，比墙身略凸出（0.125）成壁柱感；四面各 1 个 wall-line 插槽，' +
      '**插槽落在轴心而非表面**。' +
      '设计说明：方案原写的是「L 形转角墙」，但实现时发现它在「底面中心轴心 + 插槽落 0.5 网格」' +
      '两条约束下**不可自洽** —— 两翼中心线无法同时穿过原点、而外接盒中心又要落网格（要求 ' +
      'x_lo ≡ 0 与 x_lo ≡ -0.25 同时成立，矛盾）。改为「角墩 + 装配清单表达 L 形」，' +
      '这反而更符合本方案的分工：**L 形是装配结果，不是构件**（粒度判据 2「结构可分离」）。' +
      '墙段的端面因壁厚 0.5 落在轴心处，形成 0.375 的暗榫 —— 榫接是石活常态，不是穿插错误。',
    collision: 'box',
    slots: [
      { slot: 'wall', ref: 'earth/qing-zhuan' },
      { slot: 'trim', ref: 'stone/qing-shi' },
    ],
    sockets: [
      sock.foot([0, 0, 0], '承重基准点（轴心）'),
      sock.top([0, 3.0, 0]),
      sock.west([0, 0, 0], '落轴心：四向墙段皆以本墩轴线为续接基准'),
      sock.east([0, 0, 0], '落轴心'),
      sock.south([0, 0, 0], '落轴心'),
      sock.north([0, 0, 0], '落轴心'),
    ],
    build(M) {
      addBox(M, { size: [0.75, 0.3, 0.75], at: [0, 0.15, 0], slot: 'trim' });
      addBox(M, { size: [0.65, 2.55, 0.65], at: [0, 1.575, 0], slot: 'wall' });
      addBox(M, { size: [0.75, 0.15, 0.75], at: [0, 2.925, 0], slot: 'wall' });
    },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // 屋顶 components/roof
  // ═════════════════════════════════════════════════════════════════════════

  {
    name: 'tile-field-pantile',
    title: '瓦面·板瓦',
    category: 'components/roof',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['roof', 'tile', 'pantile', '程序化'],
    summary: '单块板瓦：凹槽剖面（瓦心最低、两沿翘起），剖面挤出 0.25 m。瓦宽取 0.25 = 造型网格 —— 真实板瓦约 0.2–0.3 m，这个取舍既真实、又让整批零软警告。',
    collision: 'box',
    slots: [{ slot: 'roof', ref: 'roof-tile/qingwa' }],
    sockets: [
      sock.run([0, 0, 0], '+x', 0.25, '沿檐口方向重复，步距 = 瓦宽'),
      sock.rest('seat', [0, 0, 0], '瓦背坐在望板 / 椽上'),
    ],
    build(M) {
      // at 的 z 取 -0.125 = 半长，让瓦块**在 Z 上居中** —— 否则归位偏移量会是 0.125，
      // 把插槽坐标一起推离 0.5 定位网格。
      addExtrude(M, { profile: troughProfile(0.25, 0.05, 0.02, 5), length: 0.25, at: [0, 0, -0.125], slot: 'roof' });
    },
  },

  {
    name: 'eave-rafter-a',
    title: '檐椽',
    category: 'components/roof',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['roof', 'rafter', 'timber', '程序化'],
    summary: '圆椽，径 0.25（造型网格）、长 2.0 m（定位网格），沿斜坡（Z 向）。段数取 8 而非 16 —— 椽径小、截面看不出多边形，省一半面。',
    collision: 'box',
    slots: [{ slot: 'beam', ref: 'timber/ben-se' }],
    sockets: [
      sock.run([0, 0, 0], '+x', 0.5, '沿檐口阵列，步距 = 椽档'),
      sock.rest('tail-seat', [0, 0, -1.0], '尾端搭檐檩'),
      sock.rest('head-seat', [0, 0, 1.0], '头端探出檐口'),
    ],
    build(M) {
      addCylinder(M, {
        r1: 0.125,
        r2: 0.125,
        h: 2.0,
        seg: 8,
        at: [0, 0.125, -1.0],
        rot: [Math.PI / 2, 0, 0],
        slot: 'beam',
      });
    },
  },

  {
    name: 'flying-rafter-a',
    title: '飞椽',
    category: 'components/roof',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['roof', 'rafter', 'flying', '程序化'],
    summary: '方椽（飞椽是方的，不是圆的），0.25 见方、长 1.0 m。压在檐椽之上挑出，是屋檐"飞"起来的来源。',
    collision: 'box',
    slots: [{ slot: 'beam', ref: 'timber/ben-se' }],
    sockets: [
      sock.run([0, 0, 0], '+x', 0.5, '与檐椽同档位'),
      sock.rest('tail-seat', [0, 0, -0.5], '尾端压檐椽'),
      sock.rest('head-seat', [0, 0, 0.5], '头端挑出'),
    ],
    build(M) {
      addBox(M, { size: [0.25, 0.25, 1.0], at: [0, 0.125, 0], slot: 'beam' });
    },
  },

  {
    name: 'purlin-round-a',
    title: '檩条（圆檩）',
    category: 'components/roof',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['roof', 'purlin', 'timber', '程序化'],
    summary: '圆檩，径 0.25、长 2.0 m，沿面阔（X 向）。12 段已足够圆，且它的"顶面"就是椽子的落点 —— top 插槽用 roof-seat 声明。',
    collision: 'box',
    slots: [{ slot: 'beam', ref: 'timber/ben-se' }],
    sockets: [
      sock.run([0, 0, 0], '+x', 2.0, '沿面阔重复，步距 = 柱距'),
      sock.west([-1.0, 0, 0]),
      sock.east([1.0, 0, 0]),
      {
        name: 'seat',
        type: 'roof-seat',
        direction: '+y',
        position_m: [0, 0, 0],
        mate_types: ['ground-foot', 'stack-up'],
        grid_locked: true,
        note: '椽 / 望板落此面。坐标取**轴心**（0,0,0）而非顶面切点 0.25 —— 圆檩的定位基准本就是轴心线，且 0.25 落不到 0.5 定位网格',
      },
    ],
    build(M) {
      addCylinder(M, {
        r1: 0.125,
        r2: 0.125,
        h: 2.0,
        seg: 12,
        at: [-1.0, 0.125, 0],
        rot: [0, 0, -Math.PI / 2],
        slot: 'beam',
      });
    },
  },

  {
    name: 'ridge-tile-cylinder',
    title: '脊筒',
    category: 'components/roof',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['roof', 'ridge', 'tile', '程序化'],
    summary: '正脊 / 垂脊上顺脊排列的筒形脊件，0.5 m 一段。它把"脊"从一整根做成可重复单元，脊长改了就多排两段而已。',
    collision: 'box',
    slots: [{ slot: 'roof', ref: 'roof-tile/qingwa' }],
    sockets: [
      sock.run([0, 0, 0], '+x', 0.5, '顺脊重复，步距 = 段长'),
      sock.rest('seat', [0, 0, 0], '坐在脊背上'),
    ],
    build(M) {
      addCylinder(M, {
        r1: 0.125,
        r2: 0.125,
        h: 0.5,
        seg: 12,
        at: [-0.25, 0.125, 0],
        rot: [0, 0, -Math.PI / 2],
        slot: 'roof',
      });
    },
  },

  {
    name: 'gable-board-a',
    title: '博风板',
    category: 'components/roof',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['roof', 'gable', 'board', '程序化'],
    summary: '悬山 / 歇山山面封檐板，2 m 一段。板厚 0.1 m **刻意不吸附 0.25 造型网格**：薄板类构件的厚度天然在网格分辨率之下，门禁给软警告正合适 —— 与其把板做厚到 0.25 去骗一个"零警告"，不如让约束如实报告。',
    collision: 'box',
    slots: [{ slot: 'trim', ref: 'timber/ben-se' }],
    sockets: [
      sock.mount([0, 0.25, 0], '-z', '挂在山面檩头外侧'),
      sock.run([1.0, 0, 0], '+x', 2.0, '沿山面斜坡分段'),
    ],
    build(M) {
      addBox(M, { size: [2.0, 0.5, 0.1], at: [0, 0.25, 0], slot: 'trim' });
    },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // 栏杆 components/railing
  // ═════════════════════════════════════════════════════════════════════════

  {
    name: 'balustrade-corner-a',
    title: '望柱（转角逐）',
    category: 'components/railing',
    tier: 'primitive',
    granularity: 'L2',
    tags: ['railing', 'post', 'stone', '程序化'],
    summary:
      '枢轴式转角望柱：柱身 0.5 见方 + 柱颈收进 + 柱头，高 1.0 m。四面 wall-line、foot 全部落**轴心**。' +
      '与角墩同理：转角栏杆由「望柱 + 直段栏板」在装配清单里接成，望柱只负责枢轴。' +
      '栏板端面顶到柱心形成榫接（真实石栏杆本就是栏板榫入望柱），不是穿插错误。',
    collision: 'box',
    slots: [
      { slot: 'railing', ref: 'stone/bai-shi' },
      { slot: 'trim', ref: 'stone/qing-shi' },
    ],
    sockets: [
      sock.foot([0, 0, 0], '承重基准点（轴心）'),
      sock.west([0, 0, 0], '落轴心：栏板直段以本柱轴线为续接基准'),
      sock.east([0, 0, 0], '落轴心'),
      sock.south([0, 0, 0], '落轴心'),
      sock.north([0, 0, 0], '落轴心'),
    ],
    build(M) {
      addBox(M, { size: [0.5, 0.8, 0.5], at: [0, 0.4, 0], slot: 'railing' });
      addBox(M, { size: [0.35, 0.05, 0.35], at: [0, 0.825, 0], slot: 'trim' });
      addBox(M, { size: [0.5, 0.15, 0.5], at: [0, 0.925, 0], slot: 'railing' });
    },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // 装饰 components/ornament
  // ═════════════════════════════════════════════════════════════════════════

  {
    name: 'ding-door',
    title: '门钉',
    category: 'components/ornament',
    tier: 'primitive',
    granularity: 'L3',
    tags: ['ornament', 'nail', 'metal', '程序化'],
    summary: '宫门门钉，垫圈 + 半球钉帽，径 0.25（造型网格）。L3 装饰件只有一个 attach 插槽：单向挂接、不参与结构对齐、不承载重链。',
    collision: 'none',
    slots: [{ slot: 'ornament', ref: 'metal/tong-liu-jin' }],
    sockets: [sock.mount([0, 0, 0], '-y', '贴在门板上，允许非网格落点')],
    build(M) {
      addCylinder(M, { r1: 0.125, r2: 0.125, h: 0.04, seg: 16, at: [0, 0, 0], slot: 'ornament' });
      addDome(M, { r: 0.125, h: 0.06, seg: 16, rings: 3, at: [0, 0.04, 0], slot: 'ornament' });
    },
  },
];

module.exports = { components, VERSION: V, LICENSE: LIC };
