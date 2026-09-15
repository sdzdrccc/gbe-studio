#!/usr/bin/env node
/**
 * GBE 版本与更新日志工具
 * ======================
 *
 * 版本真源 = 仓库根 `VERSION`（单行 `MAJOR.MINOR.PATCH`）。
 * 变更真源 = 仓库根 `CHANGELOG.md`。
 * 若仓库根存在 `package.json`，其 `version` 是**镜像**，由本脚本同步。
 *
 * 用法：
 *   node scripts/version.js show
 *       打印当前版本。
 *
 *   node scripts/version.js log [N]
 *       打印最近 N 个版本条目（默认 5）。
 *
 *   node scripts/version.js bump <major|minor|patch> [摘要...] [--dry-run] [--date YYYY-MM-DD]
 *      升版本 + 在 CHANGELOG 追加条目 + 同步镜像。
 *      摘要可给多条（每个位置参数 = 一条 `- 摘要`）；也可先写在 CHANGELOG 的
 *      `## [未发布]` 段里再跑 bump（那段内容会被原样带进新版本）。
 *
 *   node scripts/version.js check [--quiet]
 *       校验版本一致性 —— **pre-push 钩子调用的就是它**。
 *       任一项不过 → 退出码 1，推送被拦下。
 *
 *   node scripts/version.js sync
 *       把镜像（顶层 package.json 的 version）对齐到 VERSION。
 *       **不动版本号、不写日志** —— 只修镜像漂移。
 *
 *   node scripts/version.js tag [--message "说明"] [--dry-run]
 *       在当前 HEAD 打附注 tag `v<VERSION>`，说明默认取自 CHANGELOG 该版本正文。
 *       **必须在提交之后跑**（工作区不干净会直接报错），否则 tag 会打在旧提交上。
 *
 * 推荐节奏：bump → git commit → tag → git push --follow-tags
 *
 * 注意：本文件与 `gbe-studio/scripts/version.js` **逐字节相同**。
 *       改动必须双仓同步提交（AGENTS.md §2.6 同提交同步项）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VERSION_FILE = path.join(ROOT, 'VERSION');
const CHANGELOG_FILE = path.join(ROOT, 'CHANGELOG.md');
const PKG_FILE = path.join(ROOT, 'package.json');

/** 这两个文件自身的变化不算「未记录的变更」 */
const BASELINE_WHITELIST = ['VERSION', 'CHANGELOG.md'];

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const LEVELS = ['major', 'minor', 'patch'];
const PENDING_HEADING = '## [未发布]';

// ─────────────────────────── 基础工具 ───────────────────────────

const C = process.stdout.isTTY
  ? { ok: '\x1b[32m', err: '\x1b[31m', warn: '\x1b[33m', dim: '\x1b[2m', b: '\x1b[1m', r: '\x1b[0m' }
  : { ok: '', err: '', warn: '', dim: '', b: '', r: '' };

function ok(msg) { console.log(`${C.ok}✓${C.r} ${msg}`); }
function bad(msg) { console.log(`${C.err}✗${C.r} ${msg}`); }
function warn(msg) { console.log(`${C.warn}!${C.r} ${msg}`); }

function die(msg, code = 1) {
  bad(msg);
  process.exit(code);
}

function readVersion() {
  if (!fs.existsSync(VERSION_FILE)) die('找不到 VERSION 文件（版本真源缺失）');
  const raw = fs.readFileSync(VERSION_FILE, 'utf8').trim();
  if (!SEMVER_RE.test(raw)) die(`VERSION 内容不是合法语义化版本：${JSON.stringify(raw)}`);
  return raw;
}

function writeVersion(v) {
  fs.writeFileSync(VERSION_FILE, `${v}\n`, 'utf8');
}

function readChangelog() {
  if (!fs.existsSync(CHANGELOG_FILE)) die('找不到 CHANGELOG.md（变更真源缺失）');
  return fs.readFileSync(CHANGELOG_FILE, 'utf8');
}

function bumpVersion(v, level) {
  const m = SEMVER_RE.exec(v);
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (level === 'major') { major += 1; minor = 0; patch = 0; }
  else if (level === 'minor') { minor += 1; patch = 0; }
  else { patch += 1; }
  return `${major}.${minor}.${patch}`;
}

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 在仓库根执行 git；失败返回 null（不抛） */
function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function isGitRepo() {
  return git(['rev-parse', '--is-inside-work-tree']) !== null;
}

/** 顶层 package.json 存在 → 其 version 是镜像，需要同步 */
function readMirrorPkg() {
  if (!fs.existsSync(PKG_FILE)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(PKG_FILE, 'utf8'));
    return typeof pkg.version === 'string' ? { path: PKG_FILE, pkg } : null;
  } catch {
    return null;
  }
}

function writeMirrorPkgVersion(pkgObj, v) {
  const { path: p, pkg } = pkgObj;
  pkg.version = v;
  fs.writeFileSync(p, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

/** 从 CHANGELOG 里取出「未发布」段的正文（原样，去掉纯注释与空行） */
function extractPending(text) {
  const start = text.indexOf(PENDING_HEADING);
  if (start === -1) return { body: '', rest: text };
  const bodyStart = start + PENDING_HEADING.length;
  const nextRel = text.slice(bodyStart).search(/\n## \[/);
  const bodyEnd = nextRel === -1 ? text.length : bodyStart + nextRel;
  const body = text.slice(bodyStart, bodyEnd);
  const rest = text.slice(bodyEnd);

  const lines = body
    .split('\n')
    .filter((l) => !l.trim().startsWith('<!--'))
    .join('\n')
    .trim();

  return { body: lines, rest };
}

/** 截取 CHANGELOG 里各版本条目的「标题 + 正文」 */
function listReleases(text) {
  const re = /^## \[(\d+\.\d+\.\d+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/gm;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ version: m[1], date: m[2] || null, index: m.index });
  }
  return out;
}

/** 取 CHANGELOG 中某版本的正文（去掉标题行），用于生成 tag 说明 */
function releaseBody(text, version) {
  const releases = listReleases(text);
  const i = releases.findIndex((r) => r.version === version);
  if (i === -1) return '';
  const start = releases[i].index;
  const nextRel = text.slice(start + 1).search(/\n## \[/);
  const end = nextRel === -1 ? text.length : start + 1 + nextRel;
  return text
    .slice(start, end)
    .replace(/^##\s*\[[^\]]+\][^\n]*\n?/, '')
    .trim();
}

// ─────────────────────────── show ───────────────────────────

function cmdShow() {
  const v = readVersion();
  console.log(v);
  return 0;
}

// ─────────────────────────── log ───────────────────────────

function cmdLog(argv) {
  const n = Math.max(1, parseInt(argv[0], 10) || 5);
  const text = readChangelog();
  const releases = listReleases(text);
  if (releases.length === 0) {
    warn('CHANGELOG 里还没有任何版本条目');
    return 0;
  }
  for (const rel of releases.slice(0, n)) {
    const end = text.indexOf('\n## [', rel.index + 1);
    const block = text.slice(rel.index, end === -1 ? text.length : end).trim();
    console.log(block);
    console.log('');
  }
  return 0;
}

// ─────────────────────────── bump ───────────────────────────

function cmdBump(argv) {
  const level = (argv[0] || '').toLowerCase();
  if (!LEVELS.includes(level)) {
    die(`用法：node scripts/version.js bump <${LEVELS.join('|')}> [摘要...] [--dry-run] [--date YYYY-MM-DD]`);
  }

  const rest = argv.slice(1);
  const dryRun = rest.includes('--dry-run');
  const dateIdx = rest.indexOf('--date');
  let date = todayISO();
  if (dateIdx !== -1) {
    date = rest[dateIdx + 1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) die('--date 需要 YYYY-MM-DD 格式');
    rest.splice(dateIdx, 2);
  }
  const notes = rest.filter((a) => !a.startsWith('--') && a.trim() !== '');

  const cur = readVersion();
  const next = bumpVersion(cur, level);
  const text = readChangelog();
  const { body: pending, rest: tail } = extractPending(text);

  if (!pending && notes.length === 0) {
    die('没有变更内容可记录：给几条摘要（`bump patch "修了 X" "调了 Y"`），或先写在 CHANGELOG 的「未发布」段里');
  }

  const sections = [];
  if (pending) sections.push(pending);
  if (notes.length) sections.push(['### 变更', ...notes.map((n) => `- ${n}`)].join('\n'));

  const head = text.slice(0, text.indexOf(PENDING_HEADING)).replace(/\s*$/, '\n\n');
  const newBlock = `${PENDING_HEADING}\n\n## [${next}] - ${date}\n\n${sections.join('\n\n')}\n\n`;
  const newText = `${head}${newBlock}${tail.replace(/^\n+/, '')}`;

  const pkg = readMirrorPkg();

  if (dryRun) {
    console.log(`${C.dim}── dry-run ──${C.r}`);
    console.log(`VERSION    ${cur} → ${next}`);
    console.log(`CHANGELOG  追加 [${next}] - ${date}`);
    if (pkg) console.log(`package.json  version ${pkg.pkg.version} → ${next}`);
    console.log('');
    console.log(`${C.dim}新条目预览：${C.r}`);
    console.log(`## [${next}] - ${date}\n\n${sections.join('\n\n')}`);
    return 0;
  }

  if (!pkg && fs.existsSync(PKG_FILE)) warn('顶层 package.json 无法解析，跳过版本镜像同步');

  writeVersion(next);
  fs.writeFileSync(CHANGELOG_FILE, newText, 'utf8');
  ok(`VERSION ${cur} → ${C.b}${next}${C.r}`);
  ok(`CHANGELOG.md 追加 [${next}] - ${date}`);
  if (pkg) {
    writeMirrorPkgVersion(pkg, next);
    ok(`package.json version → ${next}`);
  }

  console.log('');
  console.log(`${C.dim}下一步：${C.r}`);
  console.log(`  git add -A && git commit -m "chore(release): v${next}"`);
  console.log('  node scripts/version.js tag        # 提交后打附注 tag');
  console.log('  git push --follow-tags');
  return 0;
}

// ─────────────────────────── check ───────────────────────────

function cmdCheck(argv) {
  const quiet = argv.includes('--quiet');
  const errors = [];
  const warnings = [];

  // 1) VERSION 合法
  let version = null;
  if (!fs.existsSync(VERSION_FILE)) {
    errors.push('缺 VERSION 文件（版本真源）');
  } else {
    const raw = fs.readFileSync(VERSION_FILE, 'utf8').trim();
    if (!SEMVER_RE.test(raw)) errors.push(`VERSION 内容不是语义化版本：${JSON.stringify(raw)}`);
    else version = raw;
  }

  // 2) CHANGELOG 存在 + 最新条目 == VERSION
  let changelog = null;
  if (!fs.existsSync(CHANGELOG_FILE)) {
    errors.push('缺 CHANGELOG.md（变更真源）');
  } else {
    changelog = fs.readFileSync(CHANGELOG_FILE, 'utf8');
    const releases = listReleases(changelog);
    if (releases.length === 0) {
      errors.push('CHANGELOG.md 里没有任何版本条目');
    } else if (version && releases[0].version !== version) {
      errors.push(
        `CHANGELOG 最新条目是 [${releases[0].version}]，与 VERSION（${version}）不一致 —— 先跑 bump`
      );
    }
    for (const rel of releases) {
      if (!rel.date) warnings.push(`CHANGELOG 条目 [${rel.version}] 没有日期`);
    }
  }

  // 3) 镜像同步（顶层 package.json）
  const mirror = readMirrorPkg();
  if (mirror && version && mirror.pkg.version !== version) {
    errors.push(`package.json version（${mirror.pkg.version}）与 VERSION（${version}）不一致`);
  }

  // 4) git 基线：上个版本之后有没有「没记录的改动」
  if (!isGitRepo()) {
    warnings.push('不是 git 仓库，跳过「未记录变更」检查');
  } else {
    const lastVerCommit = (git(['log', '-1', '--format=%H', '--', 'VERSION']) || '').trim();
    const head = (git(['rev-parse', 'HEAD']) || '').trim();
    if (!lastVerCommit) {
      warnings.push('VERSION 尚未被提交过，基线暂不可用（首次提交后生效）');
    } else if (lastVerCommit !== head) {
      const changed = (git(['diff', '--name-only', lastVerCommit, 'HEAD']) || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const offenders = changed.filter((f) => !BASELINE_WHITELIST.includes(f));
      if (offenders.length > 0) {
        const shown = offenders.slice(0, 20).map((f) => `      ${f}`).join('\n');
        const more = offenders.length > 20 ? `\n      … 另有 ${offenders.length - 20} 个文件` : '';
        errors.push(
          `自 v${version} 记录以来，有 ${offenders.length} 个文件变更但未更新版本号：\n${shown}${more}\n` +
            `    → 先跑：node scripts/version.js bump <major|minor|patch> "变更摘要"`
        );
      }
    }
    // 4b) tag 锚点：VERSION 对应的 tag 是否已打、是否打对位置
    if (version) {
      const tagName = `v${version}`;
      if (!(git(['tag', '-l', tagName]) || '').trim()) {
        warnings.push(`还没打 tag ${tagName} —— 提交后跑：node scripts/version.js tag`);
      } else {
        const tagCommit = (git(['rev-list', '-n', '1', tagName]) || '').trim();
        const verCommit = (git(['log', '-1', '--format=%H', '--', 'VERSION']) || '').trim();
        if (tagCommit && verCommit && tagCommit !== verCommit) {
          warnings.push(
            `tag ${tagName} 指向 ${tagCommit.slice(0, 7)}，而 VERSION 最后改动在 ${verCommit.slice(0, 7)} —— 确认是否打错位置`
          );
        }
      }
    }

    const dirty = (git(['status', '--porcelain']) || '').trim();
    if (dirty) warnings.push('工作区有未提交的改动（推送只会带上已提交的内容）');
  }

  // 输出
  if (!quiet) {
    const title = version ? `GBE 版本校验 · v${version}` : 'GBE 版本校验';
    console.log(`${C.b}${title}${C.r}  ${C.dim}(cwd: ${ROOT})${C.r}`);
    console.log('');
    for (const w of warnings) warn(w);
    for (const e of errors) bad(e);
    if (errors.length === 0) {
      if (warnings.length === 0) ok('全部通过：版本号、更新日志、镜像、变更记录一致');
      else ok(`通过（${warnings.length} 条提示）`);
    }
  }

  return errors.length === 0 ? 0 : 1;
}

// ─────────────────────────── sync ───────────────────────────

function cmdSync() {
  const version = readVersion();
  const mirror = readMirrorPkg();
  if (!mirror) {
    console.log(`当前版本 v${version} —— 本仓没有顶层 package.json，无需同步镜像`);
    return 0;
  }
  if (mirror.pkg.version === version) {
    ok(`package.json version 已是 ${version}，无需改动`);
    return 0;
  }
  const from = mirror.pkg.version;
  writeMirrorPkgVersion(mirror, version);
  ok(`package.json version ${from} → ${version}`);
  return 0;
}

// ─────────────────────────── tag ───────────────────────────

function cmdTag(argv) {
  const dryRun = argv.includes('--dry-run');
  const mi = argv.indexOf('--message');
  const customMsg = mi !== -1 ? argv[mi + 1] : null;

  const version = readVersion();
  const tagName = `v${version}`;

  if (!isGitRepo()) die('当前目录不是 git 仓库，无法打 tag');

  if ((git(['tag', '-l', tagName]) || '').trim()) {
    die(
      `tag ${tagName} 已存在。**已发布的 tag 不要移动** —— 同一版本号指向不同代码，比多打一个 tag 危险。\n` +
        `    确实要重打（仅在尚未推送时）：git tag -f -a ${tagName} -m "..." && git push -f origin ${tagName}`
    );
  }

  const dirty = (git(['status', '--porcelain']) || '').trim();
  if (dirty) {
    const shown = dirty.split('\n').slice(0, 15).map((l) => `      ${l}`).join('\n');
    die(
      `工作区不干净，tag 会打错位置 —— **先提交再打**：\n${shown}\n` +
        `    → git add -A && git commit -m "chore(release): ${tagName}" && node scripts/version.js tag`
    );
  }

  const head = (git(['rev-parse', '--short', 'HEAD']) || '').trim();
  const body = customMsg || releaseBody(readChangelog(), version) || tagName;

  if (dryRun) {
    console.log(`${C.dim}── dry-run ──${C.r}`);
    console.log(`将在 ${head} 打附注 tag ${C.b}${tagName}${C.r}`);
    console.log('');
    console.log(`${C.dim}说明（取自 CHANGELOG [${version}]）：${C.r}`);
    console.log(body.split('\n').map((l) => `  ${l}`).join('\n'));
    return 0;
  }

  if (git(['tag', '-a', tagName, '-m', body]) === null) {
    die(`打 tag 失败：git tag -a ${tagName}`);
  }

  ok(`已打附注 tag ${C.b}${tagName}${C.r} → ${head}`);
  console.log('');
  console.log(`${C.dim}说明（取自 CHANGELOG）：${C.r}`);
  console.log(
    body
      .split('\n')
      .slice(0, 6)
      .map((l) => `  ${l}`)
      .join('\n')
  );
  console.log('');
  console.log(`${C.dim}下一步：${C.r}`);
  console.log('  git push --follow-tags');
  return 0;
}

// ─────────────────────────── main ───────────────────────────

function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  switch (cmd) {
    case 'show':
      return cmdShow();
    case 'log':
      return cmdLog(argv);
    case 'bump':
      return cmdBump(argv);
    case 'check':
      return cmdCheck(argv);
    case 'sync':
      return cmdSync();
    case 'tag':
      return cmdTag(argv);
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(`GBE 版本与更新日志工具

  node scripts/version.js show
  node scripts/version.js log [N]
  node scripts/version.js bump <major|minor|patch> [摘要...] [--dry-run] [--date YYYY-MM-DD]
  node scripts/version.js check [--quiet]
  node scripts/version.js sync
  node scripts/version.js tag [--message "说明"] [--dry-run]

推荐节奏：
  bump → git commit → tag → git push --follow-tags

版本真源：VERSION   变更真源：CHANGELOG.md   镜像：package.json（若存在）`);
      return 0;
    default:
      die(`未知子命令：${cmd}（可用：show / log / bump / check / sync / tag）`);
  }
}

process.exit(main());
