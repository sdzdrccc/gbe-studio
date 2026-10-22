'use strict';

/**
 * assemble.js —— 用纯程序化构件拼一条 L0 装配清单，并跑 §19.5 装配校验
 *
 * 这是 BUILDING-DECOMPOSITION §10.4 的端到端 DoD 的兑现：
 *   「至少 1 件构件具备完整 `sockets[]` 且通过网格对齐校验，并可被一条装配清单引用成功装配。」
 * 院墙转角示范做到了 4 种构件 / 6 个实例装配成功、8 条判据全绿。
 * ★ 2026-10-21 起支持 `--recipe`：默认仍是院墙转角；新增「硬山屋顶试装」用于验证整体屋面。
 *
 * ── 三条设计纪律 ──────────────────────────────────────────────────────────
 *  ① **不硬编码坐标**：除首件（基准件）外，每个实例的位置都由「与宿主件的哪个插槽对接」
 *     解出来（`position = 宿主插槽世界坐标 − R·本件插槽局部坐标`）。硬写坐标等于把
 *     手工推导的算术错误固化进契约——让求解器算，算完再断言落网格。
 *  ② **插槽定义从库里读**，不从 components.js 读：清单引用的是**已入库的实体**（§19.4）。
 *     顺手也验证了 intake 落盘无误。
 *  ③ **rotation 单位 = 弧度**（契约沉默处由本批定死，见 assembly.js 顶部注释）。
 *     recipe 里写角度（人读），清单里写弧度（机读），转换只在一处。
 *
 * 用法：
 *   node build/procedural/assemble.js                          # 默认院墙转角：生成 + 校验 + 写盘
 *   node build/procedural/assemble.js --recipe yingshan-roof-test-a  # 硬山屋顶试装
 *   node build/procedural/assemble.js --recipe minju-hard-mountain-a # 首栋完整民居（24 实例）
 *   node build/procedural/assemble.js --dry-run                # 只算不写
 *   node build/procedural/assemble.js --json                   # 额外打印清单全文
 */

const fs = require('fs');
const path = require('path');
const gbe = require('../../core/schema-ref').loadSchemaPackage();

const PI = Math.PI;
const ASSETS_ROOT = gbe.REPO_ROOT;
const ASM_DIR = path.join(ASSETS_ROOT, 'assemblies');

const DEG = PI / 180;

// ---------------------------------------------------------------------------
// 骨架：从已入库的构件里取插槽（真源 = kits/，不是生成器内存里的定义）
// ---------------------------------------------------------------------------

function loadComponents() {
  const lib = gbe.assembly.loadLibrary(ASSETS_ROOT);
  const pick = (id) => {
    const hit = gbe.assembly.resolveAsset(lib, id, '^1.0.0');
    if (hit.error) throw new Error(`${hit.error}\n（程序化构件需要先入库：node ../gbe-assets/tools/intake.js）`);
    return hit;
  };
  return { lib, pick };
}

function rotY(deg) {
  return [0, deg * DEG, 0];
}

function rotXYZ(v, rot) {
  let [x, y, z] = v;
  const [rx, ry, rz] = rot;
  if (rx) {
    const c = Math.cos(rx);
    const s = Math.sin(rx);
    const ny = y * c - z * s;
    const nz = y * s + z * c;
    y = ny;
    z = nz;
  }
  if (ry) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const nx = x * c + z * s;
    const nz = -x * s + z * c;
    x = nx;
    z = nz;
  }
  if (rz) {
    const c = Math.cos(rz);
    const s = Math.sin(rz);
    const nx = x * c - y * s;
    const ny = x * s + y * c;
    x = nx;
    y = ny;
  }
  return [x, y, z];
}

const DIR_VEC = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
};

function socketOf(asset, name) {
  const s = (asset.sockets || []).find((x) => x.name === name);
  if (!s) {
    throw new Error(`${asset.id} 没有插槽 "${name}"（可用：${(asset.sockets || []).map((x) => x.name).join(', ')}）`);
  }
  return s;
}

// ---------------------------------------------------------------------------
// 装配配方（人读形态：只说"谁插谁"，不说坐标）
//
// 物件选择：院墙转角 —— 一墩 + 两向直墙 + 墙上望柱 + 一枚装饰钉。
// 这套组合刻意把 8 条判据全部踩到：
//   ① 引用              —— 4 种构件的 published 版本
//   ② mate_types 互认   —— wall-line↔wall-line（对称）+ attach↔wall-line（单向例外）
//   ③ direction 反向    —— 三处 ±x / ±z / ±y 全部反向
//   ④ position 重合     —— 由求解器保证（断言 < 1e-9）
//   ⑤ 网格对齐          —— 每件插槽落 0.5 定位网格
//   ⑥ 无几何穿插        —— 直墙↔直墙在角墩体内互嵌（收容式），不报穿插
//   ⑦ 承重链落地闭合    —— 墙墩是种子；望柱经 +y/−y 继承；门钉无 ground-foot，
//                          作为纯装饰件由宿主承接（否则它必然"悬空"）
//   ⑧ 场景预算          —— 声明 §10.3 的三级预算并比对 LOD0
// ---------------------------------------------------------------------------

const RECIPE = {
  id: 'cn-ancient.assembly.wanan-wall-corner-a',
  name: '万安城·院墙转角（示范装配）',
  kit: 'cn-ancient',
  category: 'assemblies/building',
  params: {
    note: '§10.4 端到端 DoD 示范件：程序化构件的第一次成套引用。此处是"墙角片段"而非完整建筑——完整性不是本次要证明的东西，可装配性才是。',
    wall_module_m: 2,
    story_height_m: 3,
    // ★ 2026-10-21 修正：清单实有 6 个实例（墩 + 3 墙 + 望柱 + 门钉），原写 5
    //   是旧账；装配校验的派生计数判据会当场拦下（X-0032 A-7）。
    instance_count: 6,
  },
  scene_budget: { lod0: 350000, lod1: 90000, proxy: 12000 },

  steps: [
    // ── 基准件：转角墙墩坐地，轴心即承重基准点 ──────────────────────────────
    { instance_id: 'pier-01', asset: 'cn-ancient.wall.qiang-corner-a', at: [0, 0, 0], yaw_deg: 0 },

    // ── 东向墙线：两段 2 m 直墙，逐段续接 ────────────────────────────────────
    {
      instance_id: 'wall-x-01',
      asset: 'cn-ancient.wall.qiang-straight-a',
      mate: { host: 'pier-01', host_socket: 'end-east', my_socket: 'end-west' },
      yaw_deg: 0,
    },
    {
      instance_id: 'wall-x-02',
      asset: 'cn-ancient.wall.qiang-straight-a',
      mate: { host: 'wall-x-01', host_socket: 'end-east', my_socket: 'end-west' },
      yaw_deg: 0,
    },

    // ── 南向墙线：同一段直墙转 90°。枢接件的插槽在轴心，故方向比位置更关键 ──
    {
      instance_id: 'wall-z-01',
      asset: 'cn-ancient.wall.qiang-straight-a',
      mate: { host: 'pier-01', host_socket: 'end-north', my_socket: 'end-west' },
      yaw_deg: -90,
    },

    // ── 望柱：坐在墙墩顶上，靠 +y/−y 竖向堆叠继承承重链 ──────────────────────
    {
      instance_id: 'post-01',
      asset: 'cn-ancient.railing.balustrade-corner-a',
      mate: { host: 'pier-01', host_socket: 'top', my_socket: 'bottom' },
      yaw_deg: 0,
      note: '望柱（枢接节点），1 m 高 → 顶面 y = 4 恰好落 story_heights_m 的第二档',
    },

    // ── 装饰钉：attach 单向挂接，不参与结构对齐 ─────────────────────────────
    {
      instance_id: 'stud-01',
      asset: 'cn-ancient.ornament.ding-door',
      mate: { host: 'wall-x-02', host_socket: 'end-east', my_socket: 'mount' },
      yaw_deg: 0,
      note: '门钉的真实宿主是双扇板门（#21，P 灰模已入库）；此处挂在外露墙端面上，只为跑通 attach 通路。',
    },
  ],
};

/**
 * ★ 2026-10-21 屋顶试装：验证硬山整体屋面能坐上墙顶、承重链接得上。
 *
 * 这不是一栋完整民居（没有台基 / 山墙 / 门窗），只回答两个问题：
 * 「10 m 跨的硬山屋面能不能坐在 5 段 2 m 直墙的中间那段上？」
 * 「正脊能不能坐在屋面的 ridge-seat 上？」——都能，就说明屋面与正脊的插槽口径是对的。
 */
const ROOF_TEST = {
  id: 'cn-ancient.assembly.yingshan-roof-test-a',
  name: '槐阴村·硬山屋顶试装（灰模）',
  kit: 'cn-ancient',
  category: 'assemblies/building',
  params: {
    note: '屋顶试装：5 段 2 m 直墙（共 10 m）＋ 1 件硬山整体屋面 ＋ 1 件正脊。只验屋面/正脊的对接、网格与承重链；台基 / 山墙 / 门窗不在本清单。',
    wall_module_m: 2,
    story_height_m: 3,
    instance_count: 7,
  },
  scene_budget: { lod0: 350000, lod1: 90000, proxy: 12000 },

  steps: [
    // 基准件：西端墙段坐地，轴心即承重基准点
    { instance_id: 'wall-01', asset: 'cn-ancient.wall.qiang-straight-a', at: [-4, 0, 0], yaw_deg: 0 },
    { instance_id: 'wall-02', asset: 'cn-ancient.wall.qiang-straight-a', mate: { host: 'wall-01', host_socket: 'end-east', my_socket: 'end-west' }, yaw_deg: 0 },
    { instance_id: 'wall-03', asset: 'cn-ancient.wall.qiang-straight-a', mate: { host: 'wall-02', host_socket: 'end-east', my_socket: 'end-west' }, yaw_deg: 0 },
    { instance_id: 'wall-04', asset: 'cn-ancient.wall.qiang-straight-a', mate: { host: 'wall-03', host_socket: 'end-east', my_socket: 'end-west' }, yaw_deg: 0 },
    { instance_id: 'wall-05', asset: 'cn-ancient.wall.qiang-straight-a', mate: { host: 'wall-04', host_socket: 'end-east', my_socket: 'end-west' }, yaw_deg: 0 },

    // 屋面：坐在中间墙段（wall-03，x=0）的墙顶上
    {
      instance_id: 'roof-01',
      asset: 'cn-ancient.roof.yingshan-single-a',
      mate: { host: 'wall-03', host_socket: 'top', my_socket: 'bottom' },
      yaw_deg: 0,
      note: '10 m 屋面覆盖五段 2 m 墙。',
    },

    // 正脊：坐在屋面的 ridge-seat 上；两端 ridge-point 留给垂脊 / 脊兽
    {
      instance_id: 'ridge-01',
      asset: 'cn-ancient.roof.ridge-main-a',
      mate: { host: 'roof-01', host_socket: 'ridge-seat', my_socket: 'bottom' },
      yaw_deg: 0,
      note: '正脊压在屋脊上，10 m 与屋面同长。',
    },
  ],
};

/**
 * ★ 2026-10-22 首栋完整民居（灰模）：8 m 面阔 × 7 m 进深，硬山。
 *
 * 这套配方的意义：把「民居 18 类构件」第一次真正拼成一栋可交付的东西。
 * 它刻意不追求精细节点，只回答四个问题：
 *   ① 前后墙与两山墙能不能在转角平接（不靠角墩、不互相穿插）？
 *   ② 檐柱能不能落到地面、柱头顶住屋面？
 *   ③ 屋面 / 正脊 / 门 / 窗能不能各自找到合法的承托？
 *   ④ §19.5 八条判据能不能全绿、0 警告？
 *
 * 轴网：前后墙各 4 × 2 m（面阔 8 m），进深 7 m；前后墙中心线 z = ±3.0，
 * 两山墙中心线 x = ±4.25（内表面 x=±4.0，正好与前墙端面平接），墙高 3.0，
 * 屋面 10×7 再向外挑 1 m / 0.5 m 形成檐口。
 *
 * 门 / 窗是「贴在正立面上的填充件」：本批没有在墙上开洞的构件，
 * 所以它们先贴在外皮，靠自己的 ground-foot / 窗台石承托；下一版做墙洞时再改成嵌装。
 */
const MINJU = {
  id: 'cn-ancient.assembly.minju-hard-mountain-a',
  name: '槐阴村·硬山民居（灰模首栋）',
  kit: 'cn-ancient',
  category: 'assemblies/building',
  params: {
    note: '首栋完整民居：8 × 7 m，硬山。前后各 4 段直墙 + 两山墙 + 9 根檐柱 + 10×7 硬山屋面 + 正脊 + 双扇门 + 扇形窗。墙与山墙平接，不用角墩；门窗暂为外贴填充件，不做墙洞。',
    wall_module_m: 2,
    story_height_m: 3,
    bays: 4,
    depth_m: 7,
    instance_count: 24,
  },
  scene_budget: { lod0: 350000, lod1: 90000, proxy: 12000 },

  steps: [
    // ── 前墙：4 段 2 m 直墙，链式续接；端面 x=±4.0 与山墙内表面平接 ──────────
    { instance_id: 'wall-f1', asset: 'cn-ancient.wall.qiang-straight-a', at: [-3, 0, -3], yaw_deg: 0 },
    { instance_id: 'wall-f2', asset: 'cn-ancient.wall.qiang-straight-a', mate: { host: 'wall-f1', host_socket: 'end-east', my_socket: 'end-west' }, yaw_deg: 0 },
    { instance_id: 'wall-f3', asset: 'cn-ancient.wall.qiang-straight-a', mate: { host: 'wall-f2', host_socket: 'end-east', my_socket: 'end-west' }, yaw_deg: 0 },
    { instance_id: 'wall-f4', asset: 'cn-ancient.wall.qiang-straight-a', mate: { host: 'wall-f3', host_socket: 'end-east', my_socket: 'end-west' }, yaw_deg: 0 },

    // ── 后墙：同样 4 段 ──────────────────────────────────────────────────────
    { instance_id: 'wall-b1', asset: 'cn-ancient.wall.qiang-straight-a', at: [-3, 0, 3], yaw_deg: 0 },
    { instance_id: 'wall-b2', asset: 'cn-ancient.wall.qiang-straight-a', mate: { host: 'wall-b1', host_socket: 'end-east', my_socket: 'end-west' }, yaw_deg: 0 },
    { instance_id: 'wall-b3', asset: 'cn-ancient.wall.qiang-straight-a', mate: { host: 'wall-b2', host_socket: 'end-east', my_socket: 'end-west' }, yaw_deg: 0 },
    { instance_id: 'wall-b4', asset: 'cn-ancient.wall.qiang-straight-a', mate: { host: 'wall-b3', host_socket: 'end-east', my_socket: 'end-west' }, yaw_deg: 0 },

    // ── 两山墙：7 m 段绕 Y 转 90°，内表面 x=±4.0，与前墙端面平接 ────────────
    { instance_id: 'gable-w', asset: 'cn-ancient.wall.shanqiang-a', at: [-4.25, 0, 0], yaw_deg: 90 },
    { instance_id: 'gable-e', asset: 'cn-ancient.wall.shanqiang-a', at: [4.25, 0, 0], yaw_deg: 90 },

    // ── 檐柱：中心 1 根顶屋面，前后各 3 根，东西各 1 根 ─────────────────────
    { instance_id: 'col-c', asset: 'cn-ancient.pillar.yanzhu-round-a', at: [0, 0, 0], yaw_deg: 0 },
    { instance_id: 'col-fw', asset: 'cn-ancient.pillar.yanzhu-round-a', at: [-3.5, 0, -2.5], yaw_deg: 0 },
    { instance_id: 'col-fm', asset: 'cn-ancient.pillar.yanzhu-round-a', at: [0, 0, -2.5], yaw_deg: 0 },
    { instance_id: 'col-fe', asset: 'cn-ancient.pillar.yanzhu-round-a', at: [3.5, 0, -2.5], yaw_deg: 0 },
    { instance_id: 'col-bw', asset: 'cn-ancient.pillar.yanzhu-round-a', at: [-3.5, 0, 2.5], yaw_deg: 0 },
    { instance_id: 'col-bm', asset: 'cn-ancient.pillar.yanzhu-round-a', at: [0, 0, 2.5], yaw_deg: 0 },
    { instance_id: 'col-be', asset: 'cn-ancient.pillar.yanzhu-round-a', at: [3.5, 0, 2.5], yaw_deg: 0 },
    { instance_id: 'col-mw', asset: 'cn-ancient.pillar.yanzhu-round-a', at: [-2, 0, 0], yaw_deg: 0 },
    { instance_id: 'col-me', asset: 'cn-ancient.pillar.yanzhu-round-a', at: [2, 0, 0], yaw_deg: 0 },

    // ── 屋面：中心柱顶住 bottom，屋面覆盖 10 × 7 全跨 ────────────────────────
    {
      instance_id: 'roof-01',
      asset: 'cn-ancient.roof.yingshan-single-a',
      mate: { host: 'col-c', host_socket: 'top', my_socket: 'bottom' },
      yaw_deg: 0,
      note: '屋面 bottom 落中心柱顶；四周墙顶与其余柱顶在同一 y=3 平面上承托。',
    },

    // ── 正脊：坐在屋面的 ridge-seat 上 ──────────────────────────────────────
    {
      instance_id: 'ridge-01',
      asset: 'cn-ancient.roof.ridge-main-a',
      mate: { host: 'roof-01', host_socket: 'ridge-seat', my_socket: 'bottom' },
      yaw_deg: 0,
    },

    // ── 门窗：外贴填充件（本版不做墙洞）──────────────────────────────────────
    {
      instance_id: 'door-01',
      asset: 'cn-ancient.door-window.door-panel-double-a',
      at: [0, 0, -3.5],
      yaw_deg: 0,
      note: '贴在前墙外皮前 0.125 m（门厚 0.25，墙皮 z=-3.25）；本版不做墙洞，下一版改嵌装。',
    },
    {
      instance_id: 'sill-01',
      asset: 'cn-ancient.base.curb-stone-straight',
      at: [3, 0, -3.5],
      yaw_deg: 0,
      note: '窗台石：2 m 阶条石，背贴前墙外皮。',
    },
    {
      instance_id: 'window-01',
      asset: 'cn-ancient.door-window.window-fan-lattice-a',
      mate: { host: 'sill-01', host_socket: 'top', my_socket: 'bottom' },
      yaw_deg: 0,
      note: '窗坐在窗台石上，底面 y=0.5。',
    },
  ],
};

const RECIPES = {
  'wanan-wall-corner-a': RECIPE,
  'yingshan-roof-test-a': ROOF_TEST,
  'minju-hard-mountain-a': MINJU,
};

// ---------------------------------------------------------------------------
// 求解：按"宿主插槽世界坐标 − R·本件插槽局部坐标"定位置
// ---------------------------------------------------------------------------

function solve(recipe, pick) {
  const placed = new Map(); // instance_id → { asset, position, rotation, socketsMapped }
  const rows = [];

  for (const step of recipe.steps) {
    const { asset } = pick(step.asset);
    const rotation = rotY(step.yaw_deg || 0);
    let position;

    if (step.mate) {
      const host = placed.get(step.mate.host);
      if (!host) throw new Error(`${step.instance_id}: 宿主 "${step.mate.host}" 尚未落位（配方必须按依赖顺序书写）`);

      // 宿主插槽世界坐标 = 宿主位置 + R_host · 局部坐标
      const hostSock = socketOf(host.asset, step.mate.host_socket);
      const hr = rotXYZ(hostSock.position_m, host.rotation);
      const hostWorldPos = [host.position[0] + hr[0], host.position[1] + hr[1], host.position[2] + hr[2]];

      // 本件位置 = 宿主插槽世界坐标 − R_本件 · 本件插槽局部坐标
      const mySock = socketOf(asset, step.mate.my_socket);
      const mr = rotXYZ(mySock.position_m, rotation);
      position = [hostWorldPos[0] - mr[0], hostWorldPos[1] - mr[1], hostWorldPos[2] - mr[2]];
    } else {
      position = (step.at || [0, 0, 0]).slice();
    }

    position = position.map((c) => (Math.abs(c) < 1e-9 ? 0 : Math.round(c * 1e6) / 1e6));

    const sockets = {};
    if (step.mate) sockets[step.mate.my_socket] = `${step.mate.host}::${step.mate.host_socket}`;

    placed.set(step.instance_id, { asset, position, rotation, step });
    rows.push({
      instance_id: step.instance_id,
      asset: asset.id,
      version: pick(step.asset).version,
      position,
      yaw_deg: step.yaw_deg || 0,
      rotation,
      sockets,
      polys: asset.geometry.polycount,
      dims: asset.geometry.dimensions_m,
      note: step.note,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 自检：求解出来的坐标必须落网格，否则是配方写错了
// ---------------------------------------------------------------------------

function selfCheck(rows, gridSnap) {
  const errors = [];
  const warnings = [];
  const fine = gridSnap / 2;
  const near = (v, s) => Math.abs(v / s - Math.round(v / s)) < 1e-6;

  for (const r of rows) {
    r.position.forEach((v, i) => {
      if (!near(v, fine)) {
        warnings.push(`${r.instance_id}: position[${i}] = ${v} 未落造型网格 ${fine} m`);
      }
      if (!near(v, gridSnap)) {
        // 只有枢接件的轴心必须落定位网格；其余件允许落造型网格
        const isPivot = r.instance_id.startsWith('pier') || r.instance_id.startsWith('post');
        if (isPivot) errors.push(`${r.instance_id}: 枢接件轴心 position[${i}] = ${v} 未落定位网格 ${gridSnap} m`);
      }
    });
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// 成稿
// ---------------------------------------------------------------------------

function buildManifest(recipe, rows) {
  return {
    schema_version: '2',
    id: recipe.id,
    name: recipe.name,
    kit: recipe.kit,
    category: recipe.category,
    granularity: 'L0',
    grid_snap_m: 0.5,
    instances: rows.map((r) => {
      const inst = {
        instance_id: r.instance_id,
        asset: { id: r.asset, version: `^${r.version}` },
        transform: { position: r.position, rotation: r.rotation, scale: 1 },
      };
      if (Object.keys(r.sockets).length) inst.sockets = r.sockets;
      if (r.note) inst.note = r.note;
      return inst;
    }),
    params: recipe.params,
    derived_from: null,
    scene_budget: recipe.scene_budget,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const opts = { dryRun: argv.includes('--dry-run'), json: argv.includes('--json') };
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('用法：node build/procedural/assemble.js [--recipe <key>] [--dry-run] [--json]');
    console.log(`可用配方：${Object.keys(RECIPES).join(' · ')}`);
    return 0;
  }

  const recipeArg = argv.indexOf('--recipe');
  const recipeKey = recipeArg >= 0 ? argv[recipeArg + 1] : 'wanan-wall-corner-a';
  const recipe = RECIPES[recipeKey];
  if (!recipe) {
    console.error(`未知配方 "${recipeKey}"；可用：${Object.keys(RECIPES).join(' · ')}`);
    return 2;
  }

  const { pick } = loadComponents();
  const board = gbe.resolveGrid(recipe.kit);
  const snap = board.grid.snap_m;

  const rows = solve(recipe, pick);
  const chk = selfCheck(rows, snap);
  const manifest = buildManifest(recipe, rows);

  // ── 门禁双跑 · 第一次：studio 侧提交前 ──────────────────────────────────
  const res = gbe.checkAssemblyFull(manifest);

  console.log(`装配清单：${recipe.id}`);
  console.log(`构件来源：${path.join(ASSETS_ROOT, 'kits')}  （真源库，非生成器内存）`);
  console.log('─'.repeat(100));
  console.log('实例                构件                                      位置(m)                yaw   面数  对接');
  for (const r of rows) {
    const mate = Object.values(r.sockets)[0] || '—（基准件，坐地）';
    console.log(
      `${r.instance_id.padEnd(20)}${r.asset.replace(/^cn-ancient\./, '').padEnd(42)}` +
        `[${r.position.map((c) => c.toFixed(2)).join(', ')}]`.padEnd(22) +
        `${String(r.yaw_deg).padStart(4)}°  ${String(r.polys).padStart(5)}  ${mate}`
    );
  }
  console.log('─'.repeat(100));
  console.log(
    `实例 ${res.stats.instances} · 独特构件 ${res.stats.distinct} · 对接 ${res.stats.socketsMated} 处 · ` +
      `面数 ${res.stats.polys}（预算 ${recipe.scene_budget.lod0}）· 收容式嵌入 ${res.stats.buriedOverlaps} 处`
  );
  for (const e of chk.errors) console.log(`✗ 自检 ${e}`);
  for (const w of chk.warnings) console.log(`! 自检 ${w}`);
  for (const e of res.errors) console.log(`✗ ${e.path}  ${e.message}`);
  for (const w of res.warnings) console.log(`! ${w.path}  ${w.message}`);
  console.log(res.ok ? '✓ §19.5 八条判据全绿' : '✗ 装配校验未通过');
  if (res.flags.length) console.log(`· 资产标记：${res.flags.join(', ')}`);

  if (opts.json) console.log('\n' + JSON.stringify(manifest, null, 2));

  if (!res.ok) {
    console.error('清单未落盘（校验未通过）。');
    return 1;
  }
  if (opts.dryRun) {
    console.log('（--dry-run：未写盘）');
    return 0;
  }

  const segs = recipe.id.split('.');
  const file = path.join(ASM_DIR, segs[0], ...recipe.category.split('/'), `${segs[2]}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`→ ${path.relative(ASSETS_ROOT, file).replace(/\\/g, '/')}`);
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { RECIPE, RECIPES, solve, buildManifest, loadComponents };
