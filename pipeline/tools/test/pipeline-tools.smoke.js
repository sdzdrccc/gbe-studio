'use strict';

/**
 * pipeline-tools.smoke.js —— 产线脚本（`pipeline/tools/`）的**行为测试**（2026-10-27 · X-0064 N-2）。
 *
 * 为什么要有它：这 10 个脚本此前**零测试** —— 改错只有等到跑批次时才发现。
 * 本测试不假装覆盖全部：**能真实跑的跑，跑不了的显式写「未覆盖」**（跳过不是通过）。
 *
 * 覆盖：
 *   ① analyze-mesh      在夹具上跑通，读数 = 32 tris / 25 verts
 *   ② inspect-glb       在夹具上跑通，输出含 tris=32
 *   ③ validate-lod      源 = LOD（恒等）⇒ pass=true；bbox / 边界保持全过
 *   ④ simplify-attr     32 tris → ≤ 31（带锁约束，不苛求精确 8），产物可再分析
 *   ⑤ preview-normalized-glb  产出 3 张 PNG（校验 PNG 魔数）
 *   ⑥ Python 四件（bake-column / normalize-hunyuan / rebuild-column / retopo-bake）**语法编译**
 *      —— 行为需 Blender / 真实资产，本测试**未覆盖**，显式标注
 *
 * 未覆盖：
 *   · preview-building.js —— 依赖 `pipeline/out/.../normalized/*.glb` 真实资产（不入 Git）
 *   · Python 四件的运行行为 —— 需 Blender / 真实拼装数据
 *
 * 用法：node pipeline/tools/test/pipeline-tools.smoke.js
 * 退出码：0 = 全过 / 1 = 有失败
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeGridGlb } = require('./fixture');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gbe-pipeline-test-'));

let failed = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '   ' + detail : ''}`);
  if (!ok) failed++;
}
function run(args, opts = {}) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 120000,
  });
}

(async () => {
  console.log('[pipeline-tools] 行为测试（夹具：4×4 平面网格 = 32 tris）');
  console.log('─'.repeat(64));

  const grid = path.join(TMP, 'grid.glb');
  const grid8 = path.join(TMP, 'grid-8.glb');
  const meta = await writeGridGlb(grid, 4);
  check('夹具生成', meta.triangles === 32 && meta.vertices === 25, `tris=${meta.triangles} verts=${meta.vertices}`);

  // ① analyze-mesh
  const a = run(['pipeline/tools/lod/analyze-mesh.js', grid]);
  let aJson = null;
  try { aJson = JSON.parse(a.stdout); } catch { /* 下面报 */ }
  check('analyze-mesh 退出 0', a.status === 0, a.stderr.trim().slice(0, 120));
  check('analyze-mesh 读数', aJson && aJson.tris === 32 && aJson.verts === 25,
    aJson ? `tris=${aJson.tris} verts=${aJson.verts}` : '输出不是 JSON');

  // ② inspect-glb
  const i = run(['pipeline/tools/lod/inspect-glb.js', grid]);
  check('inspect-glb 退出 0', i.status === 0, i.stderr.trim().slice(0, 120));
  check('inspect-glb 读数', /tris=32\b/.test(i.stdout) && /verts=25\b/.test(i.stdout));

  // ③ validate-lod（源 = LOD，恒等）
  const valJson = path.join(TMP, 'validate.json');
  const v = run(['pipeline/tools/lod/validate-lod.js', grid, grid, '--mode', 'simplify', '--json', valJson]);
  let vJson = null;
  try { vJson = JSON.parse(fs.readFileSync(valJson, 'utf8')); } catch { /* 下面报 */ }
  check('validate-lod 退出 0', v.status === 0, v.stderr.trim().slice(0, 120));
  check('validate-lod 恒等通过', vJson && vJson.pass === true &&
    vJson.checks.every((c) => c.pass), vJson ? JSON.stringify(vJson.checks.map((c) => [c.name, c.pass])) : '无 JSON');

  // ④ simplify-attr（32 → 带锁简化，≤ 31 即证明真的减了）
  const s = run(['pipeline/tools/lod/simplify-attr.js', grid, grid8, '--tris', '8']);
  check('simplify-attr 退出 0', s.status === 0, s.stderr.trim().slice(0, 120));
  let simpTris = null;
  if (fs.existsSync(grid8)) {
    const a2 = run(['pipeline/tools/lod/analyze-mesh.js', grid8]);
    try { simpTris = JSON.parse(a2.stdout).tris; } catch { /* 下面报 */ }
  }
  check('simplify-attr 真的减面', Number.isFinite(simpTris) && simpTris > 0 && simpTris < 32,
    simpTris === null ? '产物缺失/不可分析' : `32 → ${simpTris}`);

  // ⑤ preview-normalized-glb（3 视图 PNG）
  const prevDir = path.join(TMP, 'prev');
  fs.mkdirSync(prevDir, { recursive: true });
  const p = run(['pipeline/tools/preview-normalized-glb.js', grid, prevDir]);
  const pngs = fs.existsSync(prevDir)
    ? fs.readdirSync(prevDir).filter((f) => f.endsWith('.png'))
    : [];
  const pngOk = pngs.length === 3 && pngs.every((f) => {
    const b = fs.readFileSync(path.join(prevDir, f));
    return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  });
  check('preview-normalized-glb 退出 0', p.status === 0, p.stderr.trim().slice(0, 120));
  check('preview-normalized-glb 三张 PNG 魔数', pngOk, `png=${pngs.length}`);

  console.log('─'.repeat(64));

  // ⑥ Python 语法编译（行为需 Blender，未覆盖）
  const pyFiles = [
    'pipeline/tools/bake-column-texture.py',
    'pipeline/tools/normalize-hunyuan-glb.py',
    'pipeline/tools/rebuild-column.py',
    'pipeline/tools/lod/retopo-bake.py',
  ];
  const py = ['python3', 'python', 'py'].find((cmd) => {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    return r.status === 0;
  });
  if (!py) {
    console.log('  ⚠ Python 不在场 → 4 件语法编译**未覆盖（NOT a pass）**');
  } else {
    for (const f of pyFiles) {
      const r = spawnSync(py, ['-m', 'py_compile', f], { cwd: ROOT, encoding: 'utf8' });
      check(`py_compile ${path.basename(f)}`, r.status === 0, (r.stderr || '').trim().slice(0, 120));
    }
  }

  // 未覆盖：显式写出来，不放绿灯
  console.log('  ⚠ 未覆盖（NOT a pass）：');
  console.log('      · preview-building.js —— 依赖 pipeline/out/.../normalized/*.glb 真实资产（不入 Git）');
  console.log('      · Python 四件的运行行为 —— 需 Blender / 真实拼装数据');
  console.log('─'.repeat(64));
  console.log(`  结果：${failed ? '不通过（' + failed + ' 项失败）' : '通过（夹具路径 ' + TMP + '）'}`);

  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
});
