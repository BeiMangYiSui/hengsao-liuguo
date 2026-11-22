#!/usr/bin/env node
/**
 * 从 assets.js 读出清单（唯一来源），输出流水线要处理的每个文件（制表符分隔，一行一个）：
 *   输出文件名  原图名  kind  输出宽px(0=按比例)  输出高px  fmt  切分份数  切分下标
 * 同一文件被多个键共用（ox / oxBig）时取最大高度。只用 Node 自带模块。
 * 用法：node tools/manifest.js [assets.js 路径]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = process.argv[2] || path.join(__dirname, '..', 'assets.js');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
const M = sandbox.window.QixiongAssets.manifest;

const out = new Map();
function put(name, raw, kind, w, h, fmt, n, idx) {
  const prev = out.get(name);
  if (prev && prev.h >= h) return;
  out.set(name, { name, raw, kind, w, h, fmt, n, idx });
}
for (const key of Object.keys(M)) {
  const e = M[key];
  const s = e.scale || 2, fmt = e.fmt || 'png';
  if (e.kind === 'frames') {
    e.names.forEach((nm, i) => put(e.file + '_' + i, e.file, 'frame', 0, Math.round(e.h[i] * s), fmt, e.names.length, i));
  } else {
    const w = e.w && e.kind !== 'sprite' ? Math.round(e.w * s) : 0;
    const w2 = e.kind === 'icon' ? Math.round(e.h * s) : w;
    put(e.file, e.file, e.kind, w2, Math.round(e.h * s), fmt, 1, 0);
  }
}
for (const v of out.values()) console.log([v.name, v.raw, v.kind, v.w, v.h, v.fmt, v.n, v.idx].join('\t'));
