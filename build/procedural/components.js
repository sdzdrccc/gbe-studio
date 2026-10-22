'use strict';

/**
 * components.js —— 程序化构件的定义（BUILDING-DECOMPOSITION §9.2 中标记为 P 的全部）
 *
 * 这 40 件是整套资产线里**性价比最高的一笔**：0 credit、确定性可重建、
 * 不依赖任何平台与网络。其中 24 件是建筑构件（承重链 / 围护 / 民居六件灰模），
 * 16 件是村落皮肤与道具（地面 / 老槐 / 山石 / 草木 / 街具 / 家具 / 法器 / 照明）。
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

// ── 插槽工厂（把 mate_types 的约定收在一处，免得 40 件各写一遍写岔）─────────────
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
    name: 'yanzhu-round-a',
    title: '檐柱（圆柱）',
    category: 'components/pillar',
    tier: 'component',
    granularity: 'L2',
    tags: ['pillar', 'column', 'eave', 'timber', '程序化'],
    summary:
      '民居檐柱：高 3.0 m（story_heights_m[0]）、柱身径 0.4 m，下粗上细 0.2→0.18 —— 收分是木柱的做法。' +
      '柱脚加 0.5 m 见方的木套箍（0.1 m 高），既保护柱脚，也让整体尺寸落 0.5 造型网格。' +
      '底面落柱础 top，柱头顶额枋 / 梁。',
    collision: 'box',
    slots: [
      { slot: 'pillar', ref: 'timber/ben-se' },
      { slot: 'trim', ref: 'timber/hei-qi' },
    ],
    sockets: [
      sock.foot([0, 0, 0], '坐在柱础顶面（plinth-fupen-a 的 top）'),
      sock.top([0, 3.0, 0], '柱头承额枋 / 梁'),
    ],
    build(M) {
      addBox(M, { size: [0.5, 0.1, 0.5], at: [0, 0.05, 0], slot: 'trim' });
      addCylinder(M, {
        r1: 0.2,
        r2: 0.18,
        h: 2.9,
        seg: 12,
        at: [0, 0.1, 0],
        slot: 'pillar',
      });
    },
  },

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

  {
    name: 'shanqiang-a',
    title: '山墙（硬山 · 7 m 段）',
    category: 'components/wall',
    tier: 'component',
    granularity: 'L2',
    tags: ['wall', 'shanqiang', 'gable', '程序化'],
    summary:
      '硬山民居的侧墙：长 7.0 m（= 屋面总进深）、高 3.0 m、厚 0.5 m，石勒脚 + 土坯墙身 + 压顶。' +
      '本地坐标沿 X 展开，装配时绕 Y 转 90° 落在房屋两端；屋顶的平底面直接压住它的顶。' +
      '山墙的三角部分由硬山屋面自身封板表达，本件只做墙身 —— 灰模先把承重与围护分开。',
    collision: 'box',
    slots: [
      { slot: 'wall', ref: 'earth/hang-tu' },
      { slot: 'trim', ref: 'stone/qing-shi' },
    ],
    sockets: [
      sock.foot([0, 0, 0], '承重基准点（轴心）'),
      sock.top([0, 3.0, 0], '墙顶承屋面'),
      {
        name: 'roof-seat',
        type: 'roof-seat',
        direction: '+y',
        position_m: [0, 3.0, 0],
        mate_types: ['ground-foot', 'stack-up'],
        grid_locked: true,
        note: '硬山整体屋面的 bottom 落此面',
      },
      sock.west([-3.5, 0, 0], '与前后墙 / 转角件续接'),
      sock.east([3.5, 0, 0], '与前后墙 / 转角件续接'),
      sock.run([3.5, 0, 0], '+x', 3.5, '同轴续接时按 3.5 m 步距（半跨）'),
    ],
    build(M) {
      addBox(M, { size: [7.0, 0.3, 0.5], at: [0, 0.15, 0], slot: 'trim' });
      addBox(M, { size: [7.0, 2.55, 0.5], at: [0, 1.575, 0], slot: 'wall' });
      addBox(M, { size: [7.0, 0.15, 0.5], at: [0, 2.925, 0], slot: 'trim' });
    },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // 门窗 components/door-window
  // ═════════════════════════════════════════════════════════════════════════

  {
    name: 'door-panel-double-a',
    title: '双扇板门',
    category: 'components/door-window',
    tier: 'component',
    granularity: 'L2',
    tags: ['door', 'gate', 'timber', '程序化'],
    summary:
      '民居双扇板门：洞口 2.0 × 2.4 m、厚 0.25 m。门槛 + 左右门框 + 上槛 + 两扇门板，' +
      '中间留 0.05 m 门缝。它是“填充件”，装配时贴在墙洞位置；bottom 只用于落地定位，' +
      '真正的宿主是墙的 wall-line / attach。',
    collision: 'box',
    slots: [
      { slot: 'door', ref: 'timber/zhu-hong' },
      { slot: 'trim', ref: 'timber/hei-qi' },
    ],
    sockets: [
      sock.foot([0, 0, 0], '落地定位；装配时通常由墙洞承接'),
      sock.west([-1.0, 0, 0], '左侧门框，接墙洞'),
      sock.east([1.0, 0, 0], '右侧门框，接墙洞'),
      sock.mount([0, 1.2, 0], '-z', '背贴墙面（attach 单向挂接）'),
    ],
    build(M) {
      // 门槛
      addBox(M, { size: [2.0, 0.1, 0.25], at: [0, 0.05, 0], slot: 'trim' });
      // 左右门框
      addBox(M, { size: [0.15, 2.3, 0.25], at: [-0.925, 1.25, 0], slot: 'trim' });
      addBox(M, { size: [0.15, 2.3, 0.25], at: [0.925, 1.25, 0], slot: 'trim' });
      // 上槛
      addBox(M, { size: [2.0, 0.2, 0.25], at: [0, 2.3, 0], slot: 'trim' });
      // 两扇门板（留 0.05 门缝）
      addBox(M, { size: [0.82, 2.05, 0.1], at: [-0.435, 1.125, 0], slot: 'door' });
      addBox(M, { size: [0.82, 2.05, 0.1], at: [0.435, 1.125, 0], slot: 'door' });
      // 门板横向压条（最省面的“板门”细节）
      for (const y of [0.55, 1.25, 1.95]) {
        addBox(M, { size: [0.82, 0.08, 0.04], at: [-0.435, y, 0.07], slot: 'trim' });
        addBox(M, { size: [0.82, 0.08, 0.04], at: [0.435, y, 0.07], slot: 'trim' });
      }
    },
  },

  {
    name: 'window-fan-lattice-a',
    title: '扇形格扇窗',
    category: 'components/door-window',
    tier: 'mass',
    granularity: 'L2',
    tags: ['window', 'lattice', 'fan', '程序化'],
    summary:
      '民居扇形格扇窗：洞口 2.0 × 1.5 m、厚 0.25 m。下部竖棂 + 上部放射状扇骨，' +
      '用 7 根绕 Z 旋转的薄盒拼出扇形，0 成本且可参数化。窗是填充件，装配时贴墙洞。',
    collision: 'box',
    slots: [
      { slot: 'window', ref: 'timber/ben-se' },
      { slot: 'trim', ref: 'timber/hei-qi' },
    ],
    sockets: [
      sock.foot([0, 0, 0], '落地定位；装配时通常由墙洞承接'),
      sock.west([-1.0, 0, 0], '左侧窗框，接墙洞'),
      sock.east([1.0, 0, 0], '右侧窗框，接墙洞'),
      sock.mount([0, 0.75, 0], '-z', '背贴墙面（attach 单向挂接）'),
    ],
    build(M) {
      // 外框
      addBox(M, { size: [0.12, 1.5, 0.25], at: [-0.94, 0.75, 0], slot: 'trim' });
      addBox(M, { size: [0.12, 1.5, 0.25], at: [0.94, 0.75, 0], slot: 'trim' });
      addBox(M, { size: [2.0, 0.12, 0.25], at: [0, 0.06, 0], slot: 'trim' });
      addBox(M, { size: [2.0, 0.12, 0.25], at: [0, 1.44, 0], slot: 'trim' });

      // 下部竖棂：5 根，居中排开
      for (let i = 0; i < 5; i++) {
        const x = -0.6 + i * 0.3;
        addBox(M, { size: [0.08, 0.9, 0.08], at: [x, 0.58, 0], slot: 'window' });
      }

      // 上部扇形：中心 (0,0.75)，7 根放射棂
      const cx = 0;
      const cy = 0.75;
      const fanR = 0.58;
      for (let i = 0; i < 7; i++) {
        const a = (Math.PI / 6) + (i * Math.PI) / 9; // 30°..150°
        const rMid = fanR * 0.5;
        addBox(M, {
          size: [0.06, fanR, 0.08],
          at: [cx + Math.cos(a) * rMid, cy + Math.sin(a) * rMid, 0],
          rot: [0, 0, a - Math.PI / 2],
          slot: 'window',
        });
      }
      // 扇心
      addBox(M, { size: [0.16, 0.16, 0.1], at: [cx, cy, 0], slot: 'trim' });
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

  {
    name: 'ridge-main-a',
    title: '正脊（10 m 段）',
    category: 'components/roof',
    tier: 'component',
    granularity: 'L2',
    tags: ['roof', 'ridge', 'main', '程序化'],
    summary:
      '硬山正脊：长 10.0 m（与屋面脊长一致）、宽 0.5 m、高 0.5 m。三层收分（底座 → 脊身 → 脊顶），' +
      '两端留 ridge-point 供垂脊 / 脊兽续接；bottom 坐在硬山屋面的 ridge-seat 上。',
    collision: 'box',
    slots: [{ slot: 'roof', ref: 'roof-tile/qingwa' }],
    sockets: [
      sock.foot([0, 0, 0], '坐在硬山屋面的 ridge-seat 上'),
      sock.ridge('ridge-west', [-5.0, 0, 0], '-x', '正脊西端，接垂脊 / 脊兽'),
      sock.ridge('ridge-east', [5.0, 0, 0], '+x', '正脊东端，接垂脊 / 脊兽'),
      sock.top([0, 0.5, 0], '脊顶，后续可挂脊饰'),
    ],
    build(M) {
      addBox(M, { size: [10.0, 0.2, 0.5], at: [0, 0.1, 0], slot: 'roof' });
      addBox(M, { size: [10.0, 0.2, 0.36], at: [0, 0.3, 0], slot: 'roof' });
      addBox(M, { size: [10.0, 0.1, 0.24], at: [0, 0.45, 0], slot: 'roof' });
    },
  },

  /**
   * ★ 2026-10-21 试点：硬山单檐整体屋顶（灰模）。
   *
   * 这是 GBE 程序化路线第一次做「整体屋面」，不是瓦片 / 椽 / 檩那种零件。
   * 为什么先做它：民居是 M4 槐阴村的唯一建筑形制，屋顶是六件必备构件里最难的一件；
   * 它若能用现有几何内核做出来，剩下的柱 / 脊 / 山墙 / 门 / 窗都是同一套做法。
   *
   * 形制口径（硬山）：
   *   · 两坡，屋脊与两山墙齐平（不出山），所以 X 向不做悬挑；
   *   · 本件只做「两坡整体 + 山面封板」，正脊是独立件 `ridge-main-a`，不烘进来；
   *   · 底面是平的——灰模按「整体屋面体」处理，屋架 / 檩条在内部，不在本件表达；
   *     这样它能直接坐在墙顶 / 檐檩上，装配校验也只看这一条承重链。
   *
   * 尺寸（先取民居三开间的一组整数，落 0.5 定位网格 / 0.25 造型网格）：
   *   · 脊长 10.0 m（含两端与山墙齐平）
   *   · 总进深 7.0 m（含前后各 0.5 m 檐口）
   *   · 底面 y=0，脊顶 y=2.0
   *
   * 几何做法：在 XY 平面画「五边形两坡」的闭合剖面（底边平），沿 Z 挤出 10 m，
   * 再绕 Y 转 90° ⇒ 挤出方向变成面阔 X，剖面变成进深 Z。这样一次挤出就是
   * 一个封闭的两坡体，山面自带封板，不需要再拼两块斜板。
   */
  {
    name: 'yingshan-single-a',
    title: '硬山单檐（整体 · 灰模）',
    category: 'components/roof',
    tier: 'mass',
    granularity: 'L1',
    tags: ['roof', 'yingshan', 'hard-mtn', '程序化', '灰模'],
    summary:
      '硬山两坡整体屋面：脊长 10 m、总进深 7 m、脊高 2 m。一次挤出成封闭两坡体，山面自带封板；' +
      '正脊另件（ridge-main-a）。本件是灰模试点，用来验证「整体屋面能否程序化」，不是最终美术件。',
    collision: 'box',
    slots: [{ slot: 'roof', ref: 'roof-tile/qingwa' }],
    sockets: [
      sock.foot([0, 0, 0], '坐在檐檩 / 墙顶；硬山两山与山墙齐平，X 向不悬挑'),
      sock.ridge('ridge-west', [-5.0, 2.0, 0], '-x', '正脊西端（与山墙齐平）'),
      sock.ridge('ridge-east', [5.0, 2.0, 0], '+x', '正脊东端（与山墙齐平）'),
      {
        name: 'ridge-seat',
        type: 'roof-seat',
        direction: '+y',
        position_m: [0, 2.0, 0],
        mate_types: ['ground-foot', 'stack-up'],
        grid_locked: true,
        note: '正脊落此面（ridge-main-a 的 bottom 接这里）',
      },
    ],
    build(M) {
      // 五边形剖面：檐口底 → 檐口顶 → 脊顶 → 另一侧檐口顶 → 檐口底。
      // 最低点 y=0，归位偏移为 0 ⇒ 插槽坐标可以按世界尺度直接写。
      const profile = [
        [-3.5, 0.0],
        [-3.5, 0.25],
        [0.0, 2.0],
        [3.5, 0.25],
        [3.5, 0.0],
      ];
      // 挤出长度 10 m 沿局部 Z；绕 Y 转 +90° 后，局部 Z → 世界 X，剖面 X → 世界 -Z。
      // at 的 -5 把挤出段从 0..10 挪到 -5..5，使屋顶在 X 上居中。
      addExtrude(M, {
        profile,
        length: 10.0,
        at: [-5.0, 0, 0],
        rot: [0, Math.PI / 2, 0],
        slot: 'roof',
      });
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

  // ═════════════════════════════════════════════════════════════════════════
  // 地面 terrain/ground-tile（2026-10-22 村落皮肤第一批）
  // ═════════════════════════════════════════════════════════════════════════

  {
    name: 'dirt-a',
    title: '地面·土（2 m 块）',
    category: 'terrain/ground-tile',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['terrain', 'ground', 'dirt', '程序化'],
    summary: '2 × 2 m 土面块，厚 0.1 m，底在 y=0。沿 X / Z 各留一个 continue 插槽，步距 2 m，可直接铺成片。',
    collision: 'box',
    slots: [{ slot: 'ground', ref: 'earth/hang-tu' }],
    sockets: [
      sock.foot([0, 0, 0], '地面基准'),
      sock.run([1, 0, 0], '+x', 2.0, '沿 X 铺块'),
      sock.run([0, 0, 1], '+z', 2.0, '沿 Z 铺块'),
    ],
    build(M) {
      addBox(M, { size: [2.0, 0.1, 2.0], at: [0, 0.05, 0], slot: 'ground' });
    },
  },

  {
    name: 'grass-a',
    title: '地面·草（2 m 块）',
    category: 'terrain/ground-tile',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['terrain', 'ground', 'grass', '程序化'],
    summary: '2 × 2 m 草面块，厚 0.1 m。与土块同模数、同插槽，只换材质。',
    collision: 'box',
    slots: [{ slot: 'ground', ref: 'plant/cao-lv' }],
    sockets: [
      sock.foot([0, 0, 0], '地面基准'),
      sock.run([1, 0, 0], '+x', 2.0, '沿 X 铺块'),
      sock.run([0, 0, 1], '+z', 2.0, '沿 Z 铺块'),
    ],
    build(M) {
      addBox(M, { size: [2.0, 0.1, 2.0], at: [0, 0.05, 0], slot: 'ground' });
    },
  },

  {
    name: 'road-a',
    title: '地面·土路（2 m 块）',
    category: 'terrain/ground-tile',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['terrain', 'ground', 'road', '程序化'],
    summary: '2 × 2 m 土路块，厚 0.1 m；用青砖色与土/草区分。铺村道时按行铺即可。',
    collision: 'box',
    slots: [{ slot: 'ground', ref: 'earth/qing-zhuan' }],
    sockets: [
      sock.foot([0, 0, 0], '地面基准'),
      sock.run([1, 0, 0], '+x', 2.0, '沿 X 铺块'),
      sock.run([0, 0, 1], '+z', 2.0, '沿 Z 铺块'),
    ],
    build(M) {
      addBox(M, { size: [2.0, 0.1, 2.0], at: [0, 0.05, 0], slot: 'ground' });
    },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // 植被 nature/tree · nature/rock · nature/plant
  // ═════════════════════════════════════════════════════════════════════════

  {
    name: 'old-locust-a',
    title: '村口老槐（灰模）',
    category: 'nature/tree',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['nature', 'tree', 'locust', '程序化', '灰模'],
    summary:
      '村口老槐：4 m 主干（下粗上细）＋ 4 根斜枝 ＋ 5 团树冠，冠幅约 4 × 4 m、总高约 5.8 m。' +
      '按设定「不知年岁的老槐」做灰模，枝叶用半球团，不追求最终树形。',
    collision: 'box',
    slots: [
      { slot: 'trim', ref: 'timber/ben-se' },
      { slot: 'ornament', ref: 'plant/ye-lu' },
    ],
    sockets: [sock.foot([0, 0, 0], '树根落地')],
    build(M) {
      // 根部土台，压住树脚
      addBox(M, { size: [1.5, 0.2, 1.5], at: [0, 0.1, 0], slot: 'trim' });
      // 主干：下粗上细
      addCylinder(M, { r1: 0.55, r2: 0.35, h: 4.0, seg: 9, at: [0, 0, 0], slot: 'trim' });
      // 四根斜枝
      addCylinder(M, { r1: 0.18, r2: 0.08, h: 2.0, seg: 7, at: [0.2, 3.4, 0], rot: [0, 0, -0.5], slot: 'trim' });
      addCylinder(M, { r1: 0.18, r2: 0.08, h: 2.0, seg: 7, at: [-0.2, 3.4, 0], rot: [0, 0, 0.5], slot: 'trim' });
      addCylinder(M, { r1: 0.16, r2: 0.07, h: 1.8, seg: 7, at: [0, 3.3, 0.2], rot: [0.5, 0, 0], slot: 'trim' });
      addCylinder(M, { r1: 0.16, r2: 0.07, h: 1.8, seg: 7, at: [0, 3.3, -0.2], rot: [-0.5, 0, 0], slot: 'trim' });
      // 树冠：单个大冠，冠幅 4 × 4 m。
      // 不叠小半球 —— 两团相交处会露出内壁，俯视时是一块块黑洞；
      // 灰模阶段宁可要一个干净的整冠，等真树模型再补枝冠层次。
      addDome(M, { r: 2.0, h: 1.4, seg: 12, rings: 3, at: [0, 4.2, 0], slot: 'ornament' });
      // 半球顶的扇形收口在软件光栅里会露一圈内壁；加一块小圆盖封顶。
      addCylinder(M, { r1: 1.05, r2: 1.05, h: 0.25, seg: 12, at: [0, 5.4, 0], slot: 'ornament' });
    },
  },

  {
    name: 'rock-a',
    title: '山石·大（灰模）',
    category: 'nature/rock',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['nature', 'rock', 'stone', '程序化', '灰模'],
    summary: '大块山石：六棱石身 + 石顶，约 2.0 × 1.2 × 2.0 m。用低段数换棱角感，不做噪声起伏。',
    collision: 'box',
    slots: [{ slot: 'base', ref: 'stone/qing-shi' }],
    sockets: [sock.foot([0, 0, 0], '落地')],
    build(M) {
      addCylinder(M, { r1: 1.0, r2: 0.65, h: 0.8, seg: 8, at: [0, 0, 0], slot: 'base' });
      addDome(M, { r: 0.8, h: 0.4, seg: 8, rings: 2, at: [0, 0.8, 0], slot: 'base' });
    },
  },

  {
    name: 'rock-b',
    title: '山石·小（灰模）',
    category: 'nature/rock',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['nature', 'rock', 'stone', '程序化', '灰模'],
    summary: '小块山石：约 1.25 × 0.8 × 1.25 m，白石色；与大石同配方不同参数。',
    collision: 'box',
    slots: [{ slot: 'base', ref: 'stone/bai-shi' }],
    sockets: [sock.foot([0, 0, 0], '落地')],
    build(M) {
      addCylinder(M, { r1: 0.625, r2: 0.4, h: 0.5, seg: 8, at: [0, 0, 0], slot: 'base' });
      addDome(M, { r: 0.5, h: 0.3, seg: 8, rings: 2, at: [0, 0.5, 0], slot: 'base' });
    },
  },

  {
    name: 'grass-tuft-a',
    title: '草丛（灰模）',
    category: 'nature/plant',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['nature', 'plant', 'grass', '程序化', '灰模'],
    summary: '一丛草：0.75 × 0.65 × 0.75 m，7 片斜叶 + 土色底座。沿村路与墙根撒，成本 0。',
    collision: 'box',
    slots: [
      { slot: 'trim', ref: 'earth/hang-tu' },
      { slot: 'ornament', ref: 'plant/cao-lv' },
    ],
    sockets: [sock.foot([0, 0, 0], '落地')],
    build(M) {
      addBox(M, { size: [0.75, 0.05, 0.75], at: [0, 0.025, 0], slot: 'trim' });
      const blades = [
        [-0.2, 0, 0, 0.25],
        [0.2, 0, 0, -0.25],
        [0, -0.2, 0.25, 0],
        [0, 0.2, -0.25, 0],
        [-0.1, -0.1, 0.15, 0.15],
        [0.1, 0.1, -0.15, -0.15],
        [0, 0, 0, 0],
      ];
      for (const [x, z, rx, rz] of blades) {
        addBox(M, { size: [0.05, 0.6, 0.05], at: [x, 0.35, z], rot: [rx, 0, rz], slot: 'ornament' });
      }
    },
  },

  {
    name: 'herb-a',
    title: '药草（灰模）',
    category: 'nature/plant',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['nature', 'plant', 'herb', '程序化', '灰模'],
    summary: '一株药草：0.75 × 0.8 × 0.75 m，三茎 + 四片叶 + 土色底座。给药圃与屋角用。',
    collision: 'box',
    slots: [
      { slot: 'trim', ref: 'earth/hang-tu' },
      { slot: 'ornament', ref: 'plant/ye-lu' },
    ],
    sockets: [sock.foot([0, 0, 0], '落地')],
    build(M) {
      addBox(M, { size: [0.75, 0.05, 0.75], at: [0, 0.025, 0], slot: 'trim' });
      addBox(M, { size: [0.05, 0.7, 0.05], at: [-0.15, 0.4, 0], rot: [0, 0, 0.15], slot: 'ornament' });
      addBox(M, { size: [0.05, 0.8, 0.05], at: [0, 0.45, 0], slot: 'ornament' });
      addBox(M, { size: [0.05, 0.65, 0.05], at: [0.15, 0.375, 0], rot: [0, 0, -0.15], slot: 'ornament' });
      addBox(M, { size: [0.22, 0.06, 0.12], at: [-0.1, 0.45, 0.08], rot: [0, 0.5, 0.2], slot: 'ornament' });
      addBox(M, { size: [0.22, 0.06, 0.12], at: [0.1, 0.55, -0.08], rot: [0, -0.5, -0.2], slot: 'ornament' });
      addBox(M, { size: [0.18, 0.05, 0.1], at: [0.12, 0.35, 0.1], rot: [0, 0.7, 0], slot: 'ornament' });
      addBox(M, { size: [0.18, 0.05, 0.1], at: [-0.12, 0.3, -0.1], rot: [0, -0.7, 0], slot: 'ornament' });
    },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // 生活道具 props/*（2026-10-22 村落皮肤第二批）
  // ═════════════════════════════════════════════════════════════════════════

  {
    name: 'woodpile-a',
    title: '柴堆（灰模）',
    category: 'props/street',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['props', 'street', 'woodpile', 'firewood', '程序化'],
    summary: '六根圆木堆成的小柴堆：1.5 × 0.75 × 1.25 m。三底、两中、一顶，给村屋墙根与灶房用。',
    collision: 'box',
    slots: [{ slot: 'trim', ref: 'timber/ben-se' }],
    sockets: [sock.foot([0, 0, 0], '落地')],
    build(M) {
      const log = (x, y, z) => addCylinder(M, { r1: 0.125, r2: 0.125, h: 1.5, seg: 8, at: [x, y, z], rot: [0, 0, -Math.PI / 2], slot: 'trim' });
      log(-0.75, 0.125, -0.5);
      log(-0.75, 0.125, 0);
      log(-0.75, 0.125, 0.5);
      log(-0.75, 0.375, -0.25);
      log(-0.75, 0.375, 0.25);
      log(-0.75, 0.625, 0);
    },
  },

  {
    name: 'drying-rack-a',
    title: '晒架（灰模）',
    category: 'props/street',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['props', 'street', 'rack', 'drying', '程序化'],
    summary: '两柱两横杆的晒架：2.0 × 2.0 × 0.25 m，中间加一层竹席。晒药、晒谷、晒衣都可用。',
    collision: 'box',
    slots: [{ slot: 'trim', ref: 'timber/ben-se' }],
    sockets: [sock.foot([0, 0, 0], '落地')],
    build(M) {
      addBox(M, { size: [0.25, 2.0, 0.25], at: [-0.875, 1.0, 0], slot: 'trim' });
      addBox(M, { size: [0.25, 2.0, 0.25], at: [0.875, 1.0, 0], slot: 'trim' });
      addBox(M, { size: [2.0, 0.15, 0.25], at: [0, 1.9, 0], slot: 'trim' });
      addBox(M, { size: [2.0, 0.15, 0.25], at: [0, 1.0, 0], slot: 'trim' });
      addBox(M, { size: [1.75, 0.05, 0.25], at: [0, 1.08, 0], slot: 'trim' });
    },
  },

  {
    name: 'fence-a',
    title: '篱笆（2 m 段）',
    category: 'props/street',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['props', 'street', 'fence', '程序化'],
    summary: '五桩两横的木篱笆：2.0 × 1.0 × 0.25 m，留 continue 插槽，步距 2 m 可连成长院墙。',
    collision: 'box',
    slots: [{ slot: 'trim', ref: 'timber/ben-se' }],
    sockets: [
      sock.foot([0, 0, 0], '落地'),
      sock.run([1.0, 0, 0], '+x', 2.0, '沿院墙续接'),
    ],
    build(M) {
      for (const x of [-0.8, -0.4, 0, 0.4, 0.8]) {
        addBox(M, { size: [0.25, 1.0, 0.25], at: [x, 0.5, 0], slot: 'trim' });
      }
      addBox(M, { size: [2.0, 0.12, 0.25], at: [0, 0.3, 0], slot: 'trim' });
      addBox(M, { size: [2.0, 0.12, 0.25], at: [0, 0.7, 0], slot: 'trim' });
    },
  },

  {
    name: 'stone-mill-a',
    title: '石碾（灰模）',
    category: 'props/street',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['props', 'street', 'mill', 'stone', '程序化'],
    summary: '圆盘石碾：盘径 1.5 m、中柱 + 横辊 + 木推杆。给村口或场院用，是“以农为生”的可见道具。',
    collision: 'box',
    slots: [
      { slot: 'base', ref: 'stone/qing-shi' },
      { slot: 'trim', ref: 'timber/ben-se' },
    ],
    sockets: [sock.foot([0, 0, 0], '落地')],
    build(M) {
      addCylinder(M, { r1: 0.75, r2: 0.75, h: 0.2, seg: 12, at: [0, 0, 0], slot: 'base' });
      addCylinder(M, { r1: 0.1, r2: 0.1, h: 0.8, seg: 8, at: [0, 0.2, 0], slot: 'trim' });
      addCylinder(M, { r1: 0.3, r2: 0.3, h: 0.6, seg: 10, at: [-0.3, 0.5, 0], rot: [0, 0, -Math.PI / 2], slot: 'base' });
      addBox(M, { size: [1.2, 0.08, 0.08], at: [0, 0.8, 0], slot: 'trim' });
    },
  },

  {
    name: 'herb-basket-a',
    title: '药篓（灰模）',
    category: 'props/furniture',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['props', 'furniture', 'basket', 'herb', '程序化'],
    summary: '敞口药篓：1.0 × 0.7 × 1.0 m，上宽下窄 + 弓形提手。给药圃、屋角与采药人用。',
    collision: 'box',
    slots: [{ slot: 'trim', ref: 'timber/ben-se' }],
    sockets: [sock.foot([0, 0, 0], '落地')],
    build(M) {
      addCylinder(M, { r1: 0.4, r2: 0.5, h: 0.45, seg: 12, at: [0, 0, 0], slot: 'trim', capTop: false });
      addBox(M, { size: [0.06, 0.3, 0.06], at: [-0.32, 0.55, 0], slot: 'trim' });
      addBox(M, { size: [0.06, 0.3, 0.06], at: [0.32, 0.55, 0], slot: 'trim' });
      addBox(M, { size: [0.7, 0.06, 0.06], at: [0, 0.7, 0], slot: 'trim' });
    },
  },

  {
    name: 'farm-tools-a',
    title: '农具（灰模）',
    category: 'props/furniture',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['props', 'furniture', 'tools', 'farm', '程序化'],
    summary: '木架上一把锄头 + 一把镰刀：1.0 × 1.2 × 0.5 m。锄刃与镰刃用铁色，木柄本色。',
    collision: 'box',
    slots: [
      { slot: 'trim', ref: 'timber/ben-se' },
      { slot: 'ornament', ref: 'metal/tie-hei' },
    ],
    sockets: [sock.foot([0, 0, 0], '落地')],
    build(M) {
      addBox(M, { size: [1.0, 0.05, 0.5], at: [0, 0.025, 0], slot: 'trim' });
      addBox(M, { size: [0.08, 1.1, 0.08], at: [-0.2, 0.6, 0], rot: [0, 0, 0.15], slot: 'trim' });
      addBox(M, { size: [0.28, 0.15, 0.06], at: [-0.32, 0.15, 0.1], rot: [0, 0, 0.15], slot: 'ornament' });
      addBox(M, { size: [0.06, 0.9, 0.06], at: [0.22, 0.5, -0.1], rot: [0, 0, -0.1], slot: 'trim' });
      addBox(M, { size: [0.22, 0.05, 0.08], at: [0.32, 0.9, -0.1], rot: [0, 0, 0.4], slot: 'ornament' });
    },
  },

  {
    name: 'spirit-plate-a',
    title: '八系测灵盘（灰模）',
    category: 'props/ritual',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['props', 'ritual', 'spirit-root', 'plate', '程序化'],
    summary:
      '开场演出用的八系测灵盘：1.25 × 0.86 × 1.25 m，木座 + 铜盘 + 八道放射刻线。' +
      '刻线只做方向示意，真正的灵根判定仍在服务端（本件是道具，不是 UI）。',
    collision: 'box',
    slots: [
      { slot: 'trim', ref: 'timber/ben-se' },
      { slot: 'base', ref: 'metal/tong-liu-jin' },
      { slot: 'ornament', ref: 'metal/tie-hei' },
    ],
    sockets: [sock.foot([0, 0, 0], '落地')],
    build(M) {
      addCylinder(M, { r1: 0.4, r2: 0.4, h: 0.15, seg: 12, at: [0, 0, 0], slot: 'trim' });
      addCylinder(M, { r1: 0.08, r2: 0.08, h: 0.6, seg: 8, at: [0, 0.15, 0], slot: 'trim' });
      addCylinder(M, { r1: 0.625, r2: 0.625, h: 0.08, seg: 16, at: [0, 0.75, 0], slot: 'base' });
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        addBox(M, {
          size: [0.25, 0.03, 0.06],
          at: [Math.cos(a) * 0.35, 0.83, Math.sin(a) * 0.35],
          rot: [0, a, 0],
          slot: 'ornament',
        });
      }
    },
  },

  {
    name: 'lantern-a',
    title: '灯笼杆（灰模）',
    category: 'props/lighting',
    tier: 'primitive',
    granularity: 'L1',
    tags: ['props', 'lighting', 'lantern', '程序化'],
    summary: '村口/院门灯笼杆：0.75 × 2.2 × 0.5 m，木杆 + 横臂 + 红纸灯笼。夜里给一点人气。',
    collision: 'box',
    slots: [
      { slot: 'trim', ref: 'timber/ben-se' },
      { slot: 'ornament', ref: 'textile/zhu-lian' },
      { slot: 'base', ref: 'metal/tie-hei' },
    ],
    sockets: [sock.foot([0, 0, 0], '落地')],
    build(M) {
      addBox(M, { size: [0.75, 0.1, 0.5], at: [0, 0.05, 0], slot: 'trim' });
      addBox(M, { size: [0.15, 2.2, 0.15], at: [-0.2, 1.1, 0], slot: 'trim' });
      addBox(M, { size: [0.6, 0.1, 0.1], at: [-0.025, 2.1, 0], slot: 'trim' });
      addCylinder(M, { r1: 0.22, r2: 0.22, h: 0.4, seg: 12, at: [0.125, 1.65, 0], slot: 'ornament' });
      addCylinder(M, { r1: 0.25, r2: 0.25, h: 0.05, seg: 12, at: [0.125, 2.05, 0], slot: 'base' });
      addCylinder(M, { r1: 0.25, r2: 0.25, h: 0.05, seg: 12, at: [0.125, 1.6, 0], slot: 'base' });
    },
  },
];

module.exports = { components, VERSION: V, LICENSE: LIC };
