#!/usr/bin/env node
/**
 * 把输出目录里的成品图转成 base64，写成 assets_data.js（定义 window.QixiongAssetsData）。
 * 只收清单里登记过的文件；每个键单独一行，便于 package.py 逐行校验。只用 Node 自带模块。
 * 用法：node tools/build_data.js <图片目录> <输出 js> [assets.js 路径]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const [imgDir, outFile, assetsJs] = process.argv.slice(2);
if (!imgDir || !outFile) { console.error('用法：node tools/build_data.js <图片目录> <输出 js> [assets.js]'); process.exit(1); }
const lines = execFileSync(process.execPath, [path.join(__dirname, 'manifest.js')].concat(assetsJs ? [assetsJs] : []), { encoding: 'utf8' }).trim().split('\n');

const rows = [];
let raw = 0;
for (const line of lines) {
  const [name, , , , , fmt] = line.split('\t');
  const ext = fmt === 'jpg' ? '.jpg' : '.png';
  const p = path.join(imgDir, name + ext);
  if (!fs.existsSync(p)) continue;
  const buf = fs.readFileSync(p);
  const okPng = ext === '.png' && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const okJpg = ext === '.jpg' && buf[0] === 0xff && buf[1] === 0xd8;
  if (!okPng && !okJpg) { console.error('跳过（文件头不对）：' + p); continue; }
  raw += buf.length;
  rows.push('  "' + name + '": "data:image/' + (okPng ? 'png' : 'jpeg') + ';base64,' + buf.toString('base64') + '"');
}
const js = '/* 《七雄割草传》图片数据：由 tools/build_data.js 生成，请勿手改 */\n' +
  '(function (w) {\n w.QixiongAssetsData = {\n' + rows.join(',\n') + '\n };\n})(window);\n';
fs.writeFileSync(outFile, js);
const deflated = zlib.deflateRawSync(Buffer.from(js), { level: 9 }).length;
console.log('数据文件：' + outFile);
console.log('  收录 ' + rows.length + ' 张；原图合计 ' + (raw / 1024).toFixed(1) + ' KB；JS 文件 ' + (js.length / 1024).toFixed(1) +
  ' KB（+' + ((js.length / raw - 1) * 100).toFixed(1) + '%）；ZIP 压缩后约 ' + (deflated / 1024).toFixed(1) + ' KB');
