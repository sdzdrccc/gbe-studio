'use strict';

/**
 * 平台适配器模板。
 *
 * 契约：每个适配器只需实现三个动词 —— submit / poll / fetch ——
 * 上层（拆分 / 精修 / 集成 / 账本）全部只认 GenerationArtifact，不感知平台差异。
 *
 * 复制到 providers/<id>/adapter.js 后：
 *   1. 填 submit / poll / fetch
 *   2. 删掉本文件顶部的 `throw new Error('模板')` 用法
 *   3. 在 core/registry/providers.json 加一条记录（enabled: true, adapter: 'providers/<id>'）
 *
 * 三条纪律（血泪）：
 *   ① **产出即时落盘** —— 多数平台的模型 URL 只有 5–10 分钟寿命，不能挂着等。
 *   ② **凭证永不出现在返回值** —— 返回的 raw_meta 必须脱敏（sk-*** / Bearer ***）。
 *   ③ **成本原样上报** —— 不猜测、不换算时用 unit: "unknown"，交账本层处理。
 */

const fs = require('fs');
const path = require('path');

const ID = '<provider-id>';

/** ① 提交任务 → ticket */
async function submit(job) {
  // job: GenerationJob（core/contracts/generation-job.schema.json）
  // 返回：{ ticket, provider, channel, raw }
  throw new Error(`模板：请实现 ${ID}.submit()`);
}

/** ② 轮询状态；完成后返回产出信息 */
async function poll(ticket) {
  // 返回：{ state: 'pending'|'running'|'succeeded'|'failed', artifact?, error? }
  throw new Error(`模板：请实现 ${ID}.poll()`);
}

/** ③ 拉取产出并**立即落盘**（纪律 ①） */
async function fetch(artifact, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  // 下载 model / texture / preview 到 outDir，返回 GenerationArtifact
  throw new Error(`模板：请实现 ${ID}.fetch()`);
}

/** 能力自述 —— 从 capabilities.json 读，不要在代码里重复声明 */
function capabilities() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'capabilities.json'), 'utf8'));
}

/** 脱敏工具（纪律 ②） */
function redact(text) {
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/(SecretId|SecretKey|api[_-]?key)"?\s*[:=]\s*"?[A-Za-z0-9._-]+/gi, '$1=***');
}

module.exports = { id: ID, submit, poll, fetch, capabilities, redact };
