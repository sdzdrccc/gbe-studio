'use strict';

/**
 * @gbe/schema 解析器（CONVENTIONS §0.2 / §18）。
 *
 * 契约校验器【只有一份实现】，位于 gbe-assets/packages/schema。
 * 本仓按以下顺序解析，永不拷贝副本：
 *   1. node_modules/@gbe/schema（CI 期用 git submodule 或 npm link 时）
 *   2. 环境变量 GBE_ASSETS_REPO 指向的仓库
 *   3. 同级目录 ../gbe-assets（开发期默认）
 *
 * 拷贝副本 = 违反「语法校验单源」，是硬性禁令 8 的明确对象。
 */

const fs = require('fs');
const path = require('path');

const CANDIDATES = [
  process.env.GBE_ASSETS_REPO
    ? path.join(process.env.GBE_ASSETS_REPO, 'packages', 'schema')
    : null,
  path.resolve(__dirname, '..', '..', 'gbe-assets', 'packages', 'schema'),
].filter(Boolean);

let cached = null;

function loadSchemaPackage() {
  if (cached) return cached;

  // 1. 已安装的包
  try {
    cached = require('@gbe/schema');
    cached.__resolved_from = 'node_modules/@gbe/schema';
    return cached;
  } catch (_) {
    /* 继续 */
  }

  // 2/3. 同级仓库
  for (const dir of CANDIDATES) {
    const entry = path.join(dir, 'index.js');
    if (fs.existsSync(entry)) {
      cached = require(dir);
      cached.__resolved_from = dir;
      return cached;
    }
  }

  throw new Error(
    [
      '找不到 @gbe/schema —— 契约校验必须使用 gbe-assets 的那一份实现，本仓不允许自带副本。',
      '',
      '请任选其一：',
      `  1. 把 gbe-assets 放在本仓同级目录：${CANDIDATES[1]}`,
      '  2. 设置环境变量 GBE_ASSETS_REPO=/path/to/gbe-assets',
      '  3. 在 CI 中把 gbe-assets 作为 git submodule 挂载（锁定 commit）',
    ].join('\n')
  );
}

/** 便捷封装：校验一个 inbox 投递包 */
function checkPackage(dir) {
  return loadSchemaPackage().checkPackage(dir);
}

/** 便捷封装：校验一份 asset.json / source.json / assembly.json */
function validate(kind, data) {
  return loadSchemaPackage().validate(kind, data);
}

module.exports = { loadSchemaPackage, checkPackage, validate, CANDIDATES };
