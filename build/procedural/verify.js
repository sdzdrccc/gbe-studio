'use strict';

/**
 * verify.js —— 程序化构件「出包复验」
 *
 * 生成器里那份自检只管"几何对不对"；这一份管"包能不能进库"——
 * 它调用的是 **gbe-assets 的 @gbe/schema**（语法校验的唯一实现），
 * 与将来 assets 侧 intake 用的是同一个函数。Studio 侧不写第二套校验器（禁令 8）。
 *
 * 用法：
 *   node build/procedural/verify.js                       # 校验 assets/inbox 下全部投递包
 *   node build/procedural/verify.js --dir <dir>           # 指定目录
 *   node build/procedural/verify.js --json                # 输出 JSON
 */

const fs = require('fs');
const path = require('path');
const { checkPackage, loadSchemaPackage } = require('../../core/schema-ref');

function parseArgs(argv) {
  const o = { dir: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') o.dir = argv[++i];
    else if (argv[i] === '--json') o.json = true;
  }
  return o;
}

function main(argv) {
  const args = parseArgs(argv);
  const schemaPkg = loadSchemaPackage();
  const assetsRoot = path.resolve(__dirname, '..', '..', '..', 'gbe-assets');
  const dir = args.dir ? path.resolve(args.dir) : path.join(assetsRoot, 'inbox');

  if (!fs.existsSync(dir)) {
    console.error(`✗ 目录不存在：${dir}`);
    return 2;
  }

  const pkgs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => path.join(dir, d.name))
    .sort();

  if (pkgs.length === 0) {
    console.error(`✗ ${dir} 下没有投递包（目录名须为 <asset-id>@<version>/）`);
    return 2;
  }

  const results = [];
  let okCount = 0;
  let warnCount = 0;

  for (const p of pkgs) {
    const r = checkPackage(p);
    const base = path.basename(p);
    if (r.ok) {
      okCount++;
      if (r.warnings.length) warnCount++;
    }
    results.push({ dir: base, ok: r.ok, errors: r.errors, warnings: r.warnings, asset: r.asset });
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          checker: schemaPkg.__resolved_from || 'unknown',
          dir,
          total: results.length,
          ok: okCount,
          with_warnings: warnCount,
          failed: results.length - okCount,
          results,
        },
        null,
        2
      )
    );
    return okCount === results.length ? 0 : 1;
  }

  console.log(`校验器：${schemaPkg.__resolved_from}`);
  console.log(`目录：  ${dir}`);
  console.log('─'.repeat(88));
  for (const r of results) {
    const tag = r.ok ? (r.warnings.length ? '!' : '✓') : '✗';
    const id = r.asset ? r.asset.id : r.dir;
    console.log(`${tag} ${id}`);
    r.errors.forEach((e) => console.log(`    ✗ ${e.path}  ${e.message}`));
    r.warnings.forEach((w) => console.log(`    ! ${w.path}  ${w.message}`));
  }
  console.log('─'.repeat(88));
  console.log(
    `共 ${results.length} 包 · 通过 ${okCount} · 失败 ${results.length - okCount} · 带软警告 ${warnCount}`
  );
  return okCount === results.length ? 0 : 1;
}

module.exports = { main };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
