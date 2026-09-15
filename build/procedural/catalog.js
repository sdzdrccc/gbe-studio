'use strict';

/**
 * catalog.js —— 生成「程序化构件总览」单页（自包含 HTML，预览图 base64 内嵌）
 *
 * 为什么要有这一页：程序化构件的验收不能只看控制台里的三角数与插槽数。
 * 「长成什么样」是美术判断，只能看图 —— 一页看全 18 件，比翻 18 个目录快。
 *
 * 数据来源：**已入库的实体**（`gbe-assets/kits/`），不是生成器内存里的定义。
 * 输出：`build/out/procedural-catalog.html`（`build/out/` 随 .gitignore 忽略 —— 派生件可重建）
 *
 * 用法：node build/procedural/catalog.js
 */

const fs = require('fs');
const path = require('path');
const gbe = require('../../core/schema-ref').loadSchemaPackage();

const ASSETS_ROOT = gbe.REPO_ROOT;
const OUT = path.join(__dirname, '..', 'out', 'procedural-catalog.html');

const GROUP_LABEL = {
  base: '台基',
  pillar: '柱网',
  beam: '梁架',
  wall: '屋身',
  roof: '屋顶',
  railing: '栏杆',
  ornament: '装饰',
};
const GROUP_ORDER = ['base', 'pillar', 'beam', 'wall', 'roof', 'railing', 'ornament'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function main() {
  const lib = gbe.assembly.loadLibrary(ASSETS_ROOT);
  const items = [];
  for (const [id, list] of lib.byId) {
    for (const e of list) {
      const a = e.asset;
      if (a.tier !== 'primitive') continue;
      const png = path.join(e.dir, 'preview.png');
      const glb = path.join(e.dir, (a.files.model && a.files.model.lod0) || 'lod0.glb');
      items.push({
        id,
        leaf: id.split('.')[1],
        name: a.name,
        category: a.category,
        summary: (a.tags || []).join(' · '),
        granularity: a.granularity,
        tier: a.tier,
        dims: a.geometry.dimensions_m,
        polys: a.geometry.polycount,
        sockets: a.sockets || [],
        mats: ((a.materials && a.materials.slots) || []).map((s) => `${s.slot}→${s.ref}`),
        collision: a.collision,
        version: e.version,
        glbKB: fs.existsSync(glb) ? (fs.statSync(glb).size / 1024).toFixed(1) : '—',
        b64: fs.existsSync(png) ? fs.readFileSync(png).toString('base64') : null,
      });
    }
  }

  items.sort((a, b) => {
    const g = GROUP_ORDER.indexOf(a.leaf) - GROUP_ORDER.indexOf(b.leaf);
    return g !== 0 ? g : a.id.localeCompare(b.id);
  });

  const totalPolys = items.reduce((s, i) => s + i.polys, 0);
  const totalSockets = items.reduce((s, i) => s + i.sockets.length, 0);

  const card = (it) => `
    <article class="card">
      <div class="shot">${it.b64 ? `<img alt="${esc(it.name)}" src="data:image/png;base64,${it.b64}">` : '<span class="noimg">无预览</span>'}</div>
      <div class="meta">
        <h3>${esc(it.name)}</h3>
        <code class="id">${esc(it.id)}</code>
        <dl>
          <div><dt>尺寸</dt><dd>${it.dims.map((d) => d.toFixed(2)).join(' × ')} m</dd></div>
          <div><dt>三角 / 大小</dt><dd>${it.polys} · ${it.glbKB} KB</dd></div>
          <div><dt>插槽</dt><dd>${it.sockets.length} 个</dd></div>
          <div><dt>材质槽</dt><dd>${esc(it.mats.join(' , ') || '—')}</dd></div>
        </dl>
        <ul class="sock">
          ${it.sockets
            .map(
              (s) =>
                `<li><b>${esc(s.name)}</b> <span class="t">${esc(s.type)}</span> <span class="d">${esc(
                  s.direction || ''
                )}</span> <span class="p">[${(s.position_m || []).map((v) => (v % 1 === 0 ? v : v.toFixed(2))).join(', ')}]</span></li>`
            )
            .join('')}
        </ul>
      </div>
    </article>`;

  let body = '';
  for (const g of GROUP_ORDER) {
    const group = items.filter((i) => i.leaf === g);
    if (!group.length) continue;
    body += `\n  <h2>${GROUP_LABEL[g] || g}<span class="n">components/${g} · ${group.length} 件</span></h2>\n  <section class="grid">${group
      .map(card)
      .join('')}\n  </section>`;
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GBE 程序化构件总览 · cn-ancient</title>
<style>
  :root{
    --bg:#f6f7f9; --panel:#ffffff; --line:#e3e6ea; --ink:#1b1f24; --dim:#68707a; --accent:#2f6df6; --accent2:#0f7b6c;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
       font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}
  header{padding:34px clamp(16px,4vw,56px) 22px;border-bottom:1px solid var(--line);background:var(--panel)}
  h1{margin:0 0 6px;font-size:23px;letter-spacing:.2px}
  .sub{color:var(--dim);font-size:13px}
  .stats{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
  .stat{background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:7px 13px;font-size:12.5px}
  .stat b{color:var(--accent);font-size:15px;margin-right:5px}
  h2{margin:34px clamp(16px,4vw,56px) 0;font-size:15.5px;font-weight:650;
     display:flex;align-items:baseline;gap:12px;padding-bottom:8px;border-bottom:1px solid var(--line)}
  h2 .n{font:12px/1 var(--mono);color:var(--dim);font-weight:400}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));
        gap:16px;padding:16px clamp(16px,4vw,56px)}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;
        display:flex;flex-direction:column}
  .shot{aspect-ratio:1;background:#fff;display:flex;align-items:center;justify-content:center;
        border-bottom:1px solid var(--line)}
  .shot img{width:100%;height:100%;object-fit:contain;display:block}
  .noimg{color:var(--dim);font-size:12px}
  .meta{padding:13px 15px 15px}
  .meta h3{margin:0 0 3px;font-size:14.5px;font-weight:650}
  .id{display:block;font:11.5px/1.5 var(--mono);color:var(--accent);word-break:break-all}
  dl{margin:10px 0 10px;display:grid;grid-template-columns:1fr 1fr;gap:3px 12px}
  dl>div{display:flex;gap:6px;font-size:12.5px}
  dt{color:var(--dim);min-width:60px}
  dd{margin:0;font-family:var(--mono);font-size:12px}
  .sock{list-style:none;margin:0;padding:9px 0 0;border-top:1px dashed var(--line);
        display:flex;flex-direction:column;gap:4px}
  .sock li{font-size:11.5px;font-family:var(--mono);display:flex;gap:7px;flex-wrap:wrap;align-items:baseline}
  .sock b{font-weight:600;min-width:74px;color:var(--ink)}
  .sock .t{color:var(--accent2)}
  .sock .d{color:var(--dim)}
  .sock .p{color:var(--dim)}
  footer{padding:22px clamp(16px,4vw,56px) 46px;color:var(--dim);font-size:12.5px;
         border-top:1px solid var(--line);background:var(--panel)}
  footer code{font-family:var(--mono);font-size:12px}
</style>
</head>
<body>
<header>
  <h1>GBE 程序化构件总览 · <code>cn-ancient</code></h1>
  <div class="sub">BUILDING-DECOMPOSITION §9.2 全部 <b>P</b> 项 · 零依赖参数化生成 · 0 credit · 确定性可重建</div>
  <div class="stats">
    <span class="stat"><b>${items.length}</b>件构件</span>
    <span class="stat"><b>${totalPolys}</b>三角面</span>
    <span class="stat"><b>${totalSockets}</b>个插槽</span>
    <span class="stat"><b>0</b>credit</span>
    <span class="stat">定位网格 <b>0.5</b>m</span>
    <span class="stat">造型网格 <b>0.25</b>m</span>
    <span class="stat">轴心 <b>bottom-center</b></span>
  </div>
</header>
${body}
<footer>
  预览图：512×512 白底 3/4 视角（相机沿局部 −Z 水平偏 45°、俯角 30°，50mm 等效）—— 纯 JS 软件光栅化，无 GPU、无三方库。<br>
  尺寸轴序 <code>[x 宽, y 高, z 深]</code> · 单位米（1u = 1m）· <code>+Y up / −Z forward</code> · 角墩与望柱为<b>枢接</b>节点件，插槽落轴心。<br>
  本页由 <code>node build/procedural/catalog.js</code> 从 <code>gbe-assets/kits/</code> 的已入库实体重建（派生件，不入库）。
</footer>
</body>
</html>
`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, 'utf8');
  console.log(`构件总览：${items.length} 件 · ${totalPolys} 三角 · ${totalSockets} 插槽`);
  console.log(`→ ${path.relative(process.cwd(), OUT).replace(/\\/g, '/')}  (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { main };
