'use strict';

/**
 * generate.js —— 程序化构件生成器（CLI）
 *
 * 一次跑完：几何 → 归位 → 插槽换算 → glb → 预览图 → asset.json / source.json → 逐件自检。
 *
 * 用法：
 *   node build/procedural/generate.js                    # 生成全部 18 件，投递到 gbe-assets/inbox/
 *   node build/procedural/generate.js --only ding-door   # 只生成一件
 *   node build/procedural/generate.js --check            # 只跑自检，不落盘
 *   node build/procedural/generate.js --out <dir>        # 自定义投递目录
 *   node build/procedural/generate.js --no-preview       # 跳过预览渲染（调几何时快很多）
 *
 * 投递目录严格遵循 CONVENTIONS §2.3：`<out>/<asset.id>@<version>/`（**完整 id**，不是第三段）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { Mesh } = require('./geom');
const { buildGlb, parseGlb, GEN_VERSION } = require('./gltf');
const { renderPreview } = require('./render');
const { components, VERSION: SPEC_VERSION } = require('./components');

const STUDIO_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(STUDIO_ROOT, '..');
const ASSETS_ROOT = path.join(PROJECT_ROOT, 'gbe-assets');
const KIT_ID = 'cn-ancient';
const GRID = { snap_m: 0.5, fine_m: 0.25 };
const ASSET_VERSION = '1.0.0';

const GENERATOR_ID = `gbe-procedural/${SPEC_VERSION}`;

// ---------------------------------------------------------------------------

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function round4(v) {
  return Math.round(v * 1e4) / 1e4;
}

function nearMultiple(value, step, tol = 1e-6) {
  const q = value / step;
  return Math.abs(q - Math.round(q)) < tol;
}

function sha16(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// 材质
// ---------------------------------------------------------------------------

function loadMaterialColors() {
  const f = path.join(__dirname, 'material-colors.json');
  const raw = readJson(f);
  const map = new Map();
  for (const [group, names] of Object.entries(raw.groups)) {
    for (const [name, hex] of Object.entries(names)) map.set(`${group}/${name}`, hex);
  }
  return { map, source: f };
}

function hexToSrgb255(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ---------------------------------------------------------------------------
// 单件生成
// ---------------------------------------------------------------------------

/**
 * @returns {{ok:boolean, errors:string[], warnings:string[], asset:object, built:object}}
 */
function buildOne(spec, opts) {
  const errors = [];
  const warnings = [];
  const matColors = opts.matColors;

  // ── 1. 几何
  const M = new Mesh();
  spec.build(M);
  const recenter = M.recenterBottom();
  const b = M.bounds();
  const polycount = M.polycount();
  const arrays = M.toArrays();

  // ── 2. 插槽：把归位偏移量同样加到插槽坐标上（两者必须活在同一坐标系里）
  const sockets = spec.sockets.map((s) => {
    const out = { ...s };
    if (Array.isArray(s.position_m)) {
      out.position_m = [
        round4(s.position_m[0] + recenter.offset[0]),
        round4(s.position_m[1] + recenter.offset[1]),
        round4(s.position_m[2] + recenter.offset[2]),
      ];
    }
    return out;
  });

  // ── 3. 自检 a：插槽落定位网格（attach 豁免）
  for (const s of sockets) {
    if (s.type === 'attach') continue;
    if (!Array.isArray(s.position_m)) {
      errors.push(`插槽 "${s.name}" 缺 position_m`);
      continue;
    }
    s.position_m.forEach((v, axis) => {
      if (!nearMultiple(v, GRID.snap_m)) {
        errors.push(
          `插槽 "${s.name}" 的 position_m[${axis}] = ${v} 未落定位网格 ${GRID.snap_m}（§19.2 硬约束）`
        );
      }
    });
    if (s.type === 'continue' && !(typeof s.step_m === 'number' && s.step_m > 0)) {
      errors.push(`插槽 "${s.name}" 是 continue 但缺 step_m`);
    }
  }

  // ── 4. 自检 b：水平尺寸落造型网格（软约束，记警告不拦）
  const dims = [round4(b.size[0]), round4(b.size[1]), round4(b.size[2])];
  [0, 2].forEach((axis) => {
    const nm = axis === 0 ? 'x 宽' : 'z 深';
    if (!nearMultiple(dims[axis], GRID.fine_m)) {
      warnings.push(
        `水平尺寸 ${nm} = ${dims[axis]} 未落造型网格 ${GRID.fine_m}（软约束：薄板 / 细部件可接受）`
      );
    }
  });

  // ── 5. 自检 c：底面必须落在 y = 0（bottom-center 轴心的前提）
  if (Math.abs(b.lo[1]) > 1e-6) {
    errors.push(`归位后底面 y = ${b.lo[1]}，应为 0（bottom-center 轴心）`);
  }

  // ── 6. 自检 d：面数在 tier 预算内
  const limit = opts.budgets[spec.tier];
  if (typeof limit === 'number' && polycount > limit) {
    errors.push(`面数 ${polycount} 超出 tier "${spec.tier}" 预算 ${limit}`);
  }

  // ── 7. 材质槽
  const slots = (spec.slots || []).map((s) => {
    const hex = matColors.map.get(s.ref);
    if (!hex) errors.push(`材质引用 "${s.ref}" 不在 material-colors.json 中（配色真源缺失）`);
    return s;
  });
  if (slots.length === 0) errors.push('materials.slots 不能为空');

  // ── 8. glb
  const slotColors = new Map();
  for (const s of slots) {
    const hex = matColors.map.get(s.ref);
    if (hex) slotColors.set(s.slot, hexToSrgb255(hex));
  }
  const materials = slots.map((s) => ({
    slot: s.slot,
    name: `${s.slot} · ${s.ref}`,
    colorHex: matColors.map.get(s.ref) || '#b0b0b0',
    metallic: s.ref.startsWith('metal/') ? 0.7 : 0,
    roughness: s.ref.startsWith('metal/') ? 0.35 : 0.9,
  }));

  const assetId = `${KIT_ID}.${spec.category.split('/')[1]}.${spec.name}`;
  const glb = buildGlb({
    name: `${spec.name}@${ASSET_VERSION}`,
    positions: arrays.positions,
    normals: arrays.normals,
    submeshes: arrays.submeshes,
    materials,
  });
  const parsed = parseGlb(glb);
  let glbStats = null;
  if (!parsed.ok) {
    errors.push(`glb 回读失败：${parsed.error}`);
  } else {
    glbStats = parsed.stats;
    if (glbStats.triangles !== polycount) {
      errors.push(`glb 内三角数 ${glbStats.triangles} ≠ 内存统计 ${polycount}`);
    }
  }

  // ── 9. 预览
  let png = null;
  if (!opts.noPreview) {
    png = renderPreview({
      positions: arrays.positions,
      normals: arrays.normals,
      submeshes: arrays.submeshes,
      slotColors,
      width: 512,
      height: 512,
      yawDeg: opts.preview.yaw_deg,
      pitchDeg: opts.preview.pitch_deg,
      focalMm: opts.preview.focal_mm_equiv,
      ss: opts.ss,
    });
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    if (w !== opts.preview.size_px || h !== opts.preview.size_px) {
      errors.push(`预览图 ${w}×${h} ≠ ${opts.preview.size_px}×${opts.preview.size_px}`);
    }
  }

  // ── 10. recipe_hash：覆盖「几何内核源码 + 构件配方 + 构件参数」
  //     这样同代码 + 同参数 → 同 hash；改了内核或配方 → hash 必变。这是"可复现"的字面保证。
  const specForHash = {
    name: spec.name,
    category: spec.category,
    tier: spec.tier,
    granularity: spec.granularity,
    slots: spec.slots,
    sockets: spec.sockets,
    build: spec.build.toString(),
  };
  const recipeId = `procedural/${spec.category.split('/')[1]}/${spec.name}@1`;
  const recipeHash = sha16(
    `${opts.kernelDigest}\n${GENERATOR_ID}\n${JSON.stringify(specForHash)}`
  );

  const now = opts.now;

  // ── 11. 组装资产清单
  const asset = {
    schema_version: '2',
    id: assetId,
    name: spec.title,
    version: ASSET_VERSION,
    status: 'published',
    // 材质只给了占位色（matColors 是 primitive 层配色表），真实材质库未建 —— 如实标记
    flags: ['needs-material-review'],
    kit: KIT_ID,
    category: spec.category,
    tier: spec.tier,
    granularity: spec.granularity,
    tags: spec.tags,
    geometry: {
      dimensions_m: dims,
      pivot: 'bottom-center',
      axis: { up: '+Y', forward: '-Z' },
      polycount,
      vertices: arrays.positions.length / 3,
    },
    files: {
      model: { lod0: 'lod0.glb' },
      preview: opts.noPreview ? [] : ['preview.png'],
      collision: null,
    },
    shell: { has_uv: false, manifold: true, solidified: true },
    materials: { slots, embedded_textures: 0 },
    collision: spec.collision,
    sockets,
    license: 'CC0-1.0',
    author: 'GBE-Studio · 程序化生成器（参数化，非 AI 生成）',
  };

  const source = {
    schema_version: '2',
    provenance: {
      provider: 'procedural',
      channel: 'default',
      model: GENERATOR_ID,
      mode: 'procedural',
      task_id: null,
      cost: { value: 0, unit: 'credit', usd_est: 0 },
      created_at: now,
    },
    refine: {
      recipe_id: recipeId,
      recipe_hash: recipeHash,
      manual: false,
      note:
        '参数化几何内核直接生成，无平台调用、无人工精修。recipe_hash 覆盖几何内核源码 + 构件配方 + 构件参数，' +
        '同代码同参数必得同 hash、同几何。',
    },
    created_at: now,
  };

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    asset,
    source,
    built: {
      glb,
      png,
      dims,
      polycount,
      vertices: arrays.positions.length / 3,
      recenter,
      glbBytes: glb ? glb.length : 0,
      pngBytes: png ? png.length : 0,
      glbStats,
      recipeHash,
      slotNames: slots.map((s) => s.slot),
      socketNames: sockets.map((s) => s.name),
    },
  };
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { only: null, check: false, noPreview: false, out: null, quiet: false, ss: 2 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') o.only = argv[++i];
    else if (a === '--check') o.check = true;
    else if (a === '--no-preview') o.noPreview = true;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--ss') o.ss = parseInt(argv[++i], 10) || 2;
    else if (a === '--help' || a === '-h') o.help = true;
  }
  return o;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      [
        '程序化构件生成器',
        '',
        '  node build/procedural/generate.js [选项]',
        '',
        '  --only <name>     只生成指定构件（如 ding-door）',
        '  --check           只跑自检，不写文件',
        '  --no-preview      跳过 512×512 预览渲染',
        '  --ss <n>          预览超采样倍率（默认 2）',
        '  --out <dir>       投递目录（默认 ../gbe-assets/inbox）',
        '  --quiet           只输出汇总',
      ].join('\n')
    );
    return 0;
  }

  const kitFile = path.join(ASSETS_ROOT, 'kits', KIT_ID, 'kit.json');
  if (!fs.existsSync(kitFile)) {
    console.error(`✗ 找不到 kit.json：${kitFile}`);
    return 2;
  }
  const kit = readJson(kitFile);
  const cfgFile = path.join(ASSETS_ROOT, 'catalog.config.json');
  const cfg = fs.existsSync(cfgFile) ? readJson(cfgFile) : {};
  const matColors = loadMaterialColors();

  const kernelDigest = sha16(
    fs.readFileSync(path.join(__dirname, 'geom.js'), 'utf8') + fs.readFileSync(path.join(__dirname, 'gltf.js'), 'utf8')
  );

  const opts = {
    budgets: kit.budgets || cfg.budgets || {},
    matColors,
    kernelDigest,
    preview: Object.assign(
      { size_px: 512, yaw_deg: 45, pitch_deg: 30, focal_mm_equiv: 50 },
      cfg.preview || {}
    ),
    noPreview: args.noPreview,
    ss: args.ss,
    now: new Date().toISOString(),
  };

  const outDir = args.out ? path.resolve(args.out) : path.join(ASSETS_ROOT, 'inbox');

  const list = args.only ? components.filter((c) => c.name === args.only) : components;
  if (list.length === 0) {
    console.error(`✗ 没有匹配的构件：${args.only}`);
    console.error(`  可用：${components.map((c) => c.name).join(', ')}`);
    return 2;
  }

  const rows = [];
  let failed = 0;
  let warned = 0;

  for (const spec of list) {
    const r = buildOne(spec, opts);
    const dirName = `${r.asset.id}@${r.asset.version}`;
    const dir = path.join(outDir, dirName);

    if (r.ok && !args.check) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'asset.json'), JSON.stringify(r.asset, null, 2) + '\n');
      fs.writeFileSync(path.join(dir, 'source.json'), JSON.stringify(r.source, null, 2) + '\n');
      if (r.built.glb) fs.writeFileSync(path.join(dir, 'lod0.glb'), r.built.glb);
      if (r.built.png) fs.writeFileSync(path.join(dir, 'preview.png'), r.built.png);
    }

    rows.push({
      id: r.asset.id,
      name: r.asset.name,
      tier: spec.tier,
      gran: spec.granularity,
      dims: r.built.dims,
      tris: r.built.polycount,
      verts: r.built.vertices,
      sockets: r.built.socketNames.length,
      glbKB: (r.built.glbBytes / 1024).toFixed(1),
      pngKB: (r.built.pngBytes / 1024).toFixed(1),
      recipe: r.built.recipeHash,
      errors: r.errors,
      warnings: r.warnings,
    });

    if (!r.ok) failed++;
    if (r.warnings.length) warned++;

    if (!args.quiet) {
      const tag = r.ok ? (r.warnings.length ? '!' : '✓') : '✗';
      console.log(`${tag} ${r.asset.id}`);
      console.log(
        `    ${spec.tier}/${spec.granularity}  ${r.built.dims.join(' × ')} m  ` +
          `${r.built.polycount} tris  ${r.built.socketNames.length} sockets  ` +
          `[${r.built.slotNames.join(', ')}]`
      );
      console.log(
        `    glb ${(r.built.glbBytes / 1024).toFixed(1)} KB` +
          (args.noPreview ? '' : `  png ${(r.built.pngBytes / 1024).toFixed(1)} KB`) +
          `  recipe ${r.built.recipeHash}`
      );
      r.errors.forEach((e) => console.log(`    ✗ ${e}`));
      r.warnings.forEach((w) => console.log(`    ! ${w}`));
      console.log('');
    }
  }

  // ── 汇总表
  console.log('─'.repeat(96));
  console.log(
    '  ID'.padEnd(52) + 'tier'.padEnd(11) + '尺寸(m)'.padEnd(22) + 'tris'.padEnd(7) + 'sock'
  );
  console.log('─'.repeat(96));
  for (const r of rows) {
    const short = r.id.replace('cn-ancient.', '');
    console.log(
      `  ${short}`.padEnd(52) +
        `${r.tier}`.padEnd(11) +
        `${r.dims.join('×')}`.padEnd(22) +
        `${r.tris}`.padEnd(7) +
        `${r.sockets}`
    );
  }
  console.log('─'.repeat(96));

  const totalTris = rows.reduce((a, r) => a + r.tris, 0);
  const totalSockets = rows.reduce((a, r) => a + r.sockets, 0);
  const warnRows = rows.filter((r) => r.warnings.length);
  console.log(
    `共 ${rows.length} 件 · 三角 ${totalTris} · 插槽 ${totalSockets} · ` +
      `错误 ${failed} 件 · 软警告 ${warnRows.length} 件`
  );
  for (const r of warnRows) {
    r.warnings.forEach((w) => console.log(`  ! ${r.id}: ${w}`));
  }
  console.log(`credits 花费：0（程序化生成，不进 AI 队列）`);
  if (args.check) console.log('（--check 模式：未写任何文件）');
  else console.log(`投递目录：${outDir}`);

  // ── 报告落盘（供后续 intake / 台账引用）
  const report = {
    generator: GENERATOR_ID,
    kernel_digest: kernelDigest,
    generated_at: opts.now,
    kit: KIT_ID,
    asset_version: ASSET_VERSION,
    count: rows.length,
    total_triangles: totalTris,
    total_sockets: totalSockets,
    credits_spent: 0,
    components: rows.map((r) => ({
      id: r.id,
      name: r.name,
      tier: r.tier,
      granularity: r.gran,
      dimensions_m: r.dims,
      polycount: r.tris,
      vertices: r.verts,
      sockets: r.sockets,
      recipe_hash: r.recipe,
      glb_kb: Number(r.glbKB),
      preview_kb: Number(r.pngKB),
      warnings: r.warnings,
      errors: r.errors,
    })),
  };
  const reportPath = path.join(STUDIO_ROOT, 'build', 'out', 'procedural-report.json');
  if (!args.check) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`报告：${reportPath}`);
  }

  return failed === 0 ? 0 : 1;
}

module.exports = { buildOne, loadMaterialColors, GENERATOR_ID, ASSET_VERSION, KIT_ID, GRID };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
