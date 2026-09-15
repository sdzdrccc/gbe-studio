#!/usr/bin/env node
/**
 * 启用本仓的 Git 钩子
 * ==================
 *
 * 把 `core.hooksPath` 指向仓内的 `scripts/hooks/`，让 pre-push 版本校验生效。
 * 为什么用 core.hooksPath 而不是往 `.git/hooks/` 拷文件：
 *   —— `.git/` 不进版本库，钩子会被 clone 丢掉；`scripts/hooks/` 是受版本管理的。
 *
 * 用法：node scripts/install-hooks.js
 * 撤销：git config --unset core.hooksPath
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HOOKS_DIR = 'scripts/hooks';

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function main() {
  if (!fs.existsSync(path.join(ROOT, HOOKS_DIR, 'pre-push'))) {
    console.error(`✗ 找不到 ${HOOKS_DIR}/pre-push —— 本脚本需在仓库根目录下运行`);
    process.exit(1);
  }

  try {
    git(['rev-parse', '--is-inside-work-tree']);
  } catch {
    console.error('✗ 当前目录不是 git 仓库');
    process.exit(1);
  }

  git(['config', 'core.hooksPath', HOOKS_DIR]);
  console.log(`✓ core.hooksPath = ${HOOKS_DIR}`);
  console.log('  pre-push 版本校验已生效（每次推送会先跑 scripts/version.js check）');
  console.log('');
  console.log('  撤销：git config --unset core.hooksPath');
  console.log('  放行一次：GBE_SKIP_VERSION_CHECK=1 git push');
}

main();
