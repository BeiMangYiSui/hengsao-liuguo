/**
 * 《横扫六国》卡通 Q 萌界面组件 —— window.QixiongUI
 * - 纯 Canvas 2D，只用 ES5（兼容 Chrome 61：不用 ?. ?? 与箭头函数）
 * - 所有函数只接收 2D context 与参数，不依赖 core.js 内部变量
 * - 可点击组件返回点击区域 {x, y, w, h}，由调用方登记按钮
 * - 复杂渐变 / 描边 / 文字结果缓存在离屏 canvas，按内容变化重画；
 *   战斗中每帧画的 topBar / skillSlot / rageBar / bossBar 只做 drawImage 与少量矩形填充
 * - 只用系统字体栈，不引入字体文件
 * 用法：页面先加载 ui.js，再加载 core.js；canvas 尺寸变化时调用 QixiongUI.setDpr(dpr)
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  var doc = global.document;

  // ================= 配色（集中在这里，按美术打样微调） =================
  var PAL = {
    ink: '#3a1d10',          // 粗描边：深棕近黑
    inkSoft: 'rgba(58,29,16,0.35)',
    shadow: 'rgba(48,18,6,0.30)',
    white: '#ffffff',
    cream: '#fff8e4',
    text: '#4a2812',         // 纸面正文
    textSub: '#8a5a2e',      // 纸面次要文字
    textLight: '#fff6dc',    // 深底上的浅字
    gold: { hi: '#fffbd0', top: '#ffe773', mid: '#ffc93a', bot: '#f08c1a', rim: '#e04a2a' },
    red: { top: '#ff9a6a', mid: '#f4553a', bot: '#d9301f', side: '#99190f', label: '#ffffff' },        // 朱红：主按钮
    jade: { top: '#9ff0c8', mid: '#45c79a', bot: '#23a276', side: '#136448', label: '#ffffff' },       // 青铜绿：次按钮
    wood: { top: '#ffe09a', mid: '#f5b75a', bot: '#de8f33', side: '#8c5216', label: '#ffffff' },       // 木色：次按钮
    off: { top: '#efebe4', mid: '#cdc6bb', bot: '#b3aca1', side: '#7a7369', label: '#f7f4ef', stroke: '#6a645b' },
    purple: { top: '#e3c4ff', mid: '#b47ce8', bot: '#8d52c9', side: '#58287f', label: '#ffffff' },
    paper: { top: '#fffaea', bot: '#ffeec2', line: '#eccf8c', cloud: '#e6b85c' },
    bamboo: { base: '#f8e6aa', slat: '#e9cd7c', hi: '#fff4cc', cord: '#c0532f' },
    dark: { top: 'rgba(60,30,14,0.82)', bot: 'rgba(40,18,8,0.86)', line: 'rgba(255,214,120,0.55)' },
    selected: '#ffd84a',
    selectedGlow: 'rgba(255,214,60,0.85)',
    exp: { top: '#b6f77a', bot: '#4fc23a' },
    rage: { top: '#ffb24a', bot: '#f0402a', full1: '#ffef6a', full2: '#ff5a2a' },
    boss: { top: '#ff8a9a', bot: '#e02a48', lag: '#ffe08a' },
    coin: { face: '#ffcf3d', edge: '#c98a12', hole: '#6b3c0c' },
    overlay: 'rgba(36,14,6,0.62)',
    sky: { top: '#7fd0ff', mid: '#c9ecff', low: '#fff1c4' },
    hill: { far: '#9fdcbc', near: '#6cc59a', line: '#3f9a73' },
    ground: { top: '#ffdf93', bot: '#f2c063', dot: '#e5ab4a' }
  };

  // 粗体无衬线系统字体栈（安卓 Noto Sans CJK 有 900 粗，iOS 苹方最粗到 600）
  var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC","Droid Sans Fallback","Heiti SC",sans-serif';
  var W_HEAVY = '900', W_BOLD = 'bold', W_NORMAL = '500';

  // ================= 离屏缓存 =================
  var DPR = 1;
  var big = { map: {}, n: 0, max: 260 };   // 面板 / 按钮 / 标题等较大的图
  var small = { map: {}, n: 0, max: 400 }; // 字形、数字、短文字
  function makeCanvas(w, h) {
    var c = doc.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * DPR)); c.height = Math.max(1, Math.ceil(h * DPR));
    return c;
  }
  // 取缓存；没有就新建并调用 draw(g, w, h) 画一次（g 已按 DPR 缩放，坐标用逻辑像素）
  function cached(store, key, w, h, draw) {
    var c = store.map[key];
    if (c) return c;
    if (store.n >= store.max) { store.map = {}; store.n = 0; }
    c = makeCanvas(w, h);
    var g = c.getContext('2d');
    g.scale(DPR, DPR);
    draw(g, w, h);
    c.lw = w; c.lh = h;
    store.map[key] = c; store.n++;
    return c;
  }
  function blit(g, c, x, y, w, h) {
    var sm = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = true;
    g.drawImage(c, x, y, w === undefined ? c.lw : w, h === undefined ? c.lh : h);
    g.imageSmoothingEnabled = sm;
  }
  function clearCache() { big.map = {}; big.n = 0; small.map = {}; small.n = 0; }
  function setDpr(d) {
    d = Math.max(1, Math.min(3, d || 1));
    if (d !== DPR) { DPR = d; clearCache(); }
  }
  function cacheStats() { return { big: big.n, small: small.n, dpr: DPR }; }

  // ================= 基础图形 =================
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rr(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
    g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
    g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r);
    g.closePath();
  }
  function vgrad(g, y0, y1, stops) {
    var gr = g.createLinearGradient(0, y0, 0, y1);
    for (var i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    return gr;
  }
  function font(size, weight) { return (weight || W_BOLD) + ' ' + size + 'px ' + FONT; }
  function measure(g, s, size, weight) { g.font = font(size, weight); return g.measureText(s).width; }
  // 描边字：先粗描边再填色（圆角连接，Q 萌）
  function strokeText(g, s, x, y, size, fill, stroke, sw, weight, align) {
    g.font = font(size, weight || W_HEAVY);
    g.textAlign = align || 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.miterLimit = 2;
    if (stroke) { g.lineWidth = sw || Math.max(2, size * 0.24); g.strokeStyle = stroke; g.strokeText(s, x, y); }
    g.fillStyle = fill; g.fillText(s, x, y);
  }
  function wrapLines(g, text, maxW, size, weight) {
    g.font = font(size, weight);
    var lines = [], cur = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i), test = cur + ch;
      if (g.measureText(test).width > maxW && cur) { lines.push(cur); cur = ch; } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  // 卡通高光：左上角小白点 + 一道短光
  function gleam(g, x, y, s) {
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.ellipse(x, y, s * 1.6, s * 0.9, -0.5, 0, TAU); g.fill();
    g.beginPath(); g.arc(x + s * 2.6, y - s * 0.9, s * 0.55, 0, TAU); g.fill();
  }
  // 云纹角饰：一个卷云小涡
  function cloudCurl(g, x, y, s, flipX, flipY, color) {
    g.save(); g.translate(x, y); g.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    g.strokeStyle = color; g.lineWidth = Math.max(1.6, s * 0.16); g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, s);
    g.quadraticCurveTo(0, 0, s, 0);
    g.stroke();
    g.beginPath(); g.arc(s * 0.62, s * 0.62, s * 0.34, Math.PI * 1.1, Math.PI * 2.6); g.stroke();
    g.beginPath(); g.arc(s * 1.22, s * 0.16, s * 0.16, 0, TAU); g.fillStyle = color; g.fill();
    g.beginPath(); g.arc(s * 0.16, s * 1.22, s * 0.16, 0, TAU); g.fill();
    g.restore();
  }
  // 四角小星（闪光点）
  function sparkle(g, x, y, r, color) {
    g.fillStyle = color || '#fffbe0';
    g.beginPath();
    g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r);
    g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r);
    g.fill();
  }
  // 铜钱（圜钱：圆形方孔）
  function coinIcon(g, x, y, r) {
    g.fillStyle = PAL.ink; g.beginPath(); g.arc(x, y + 1, r + 1.6, 0, TAU); g.fill();
    g.fillStyle = PAL.coin.edge; g.beginPath(); g.arc(x, y + 0.8, r, 0, TAU); g.fill();
    g.fillStyle = PAL.coin.face; g.beginPath(); g.arc(x, y - 0.4, r * 0.86, 0, TAU); g.fill();
    var hs = r * 0.36;
    g.fillStyle = PAL.coin.hole; rr(g, x - hs, y - hs - 0.4, hs * 2, hs * 2, hs * 0.3); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(x - r * 0.45, y - r * 0.5, r * 0.18, 0, TAU); g.fill();
  }
  // 圆形印章徽记（单字）
  function sealBadge(g, x, y, r, ch, face, side) {
    g.fillStyle = PAL.ink; g.beginPath(); g.arc(x, y + 1.5, r + 2, 0, TAU); g.fill();
    g.fillStyle = side; g.beginPath(); g.arc(x, y + 1.5, r, 0, TAU); g.fill();
    g.fillStyle = face; g.beginPath(); g.arc(x, y - 0.5, r - 0.5, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(x, y - r * 0.45, r * 0.62, r * 0.32, 0, 0, TAU); g.fill();
    strokeText(g, ch, x, y, r * 1.05, '#ffffff', PAL.ink, r * 0.28, W_HEAVY);
  }

  // ================= 小文字 / 数字缓存 =================
  // 单个字形精灵：数字跳动时只拼 drawImage，不重复描边
  function glyph(ch, size, fill, stroke, weight) {
    var key = 'gl|' + ch + '|' + size + '|' + fill + '|' + stroke + '|' + weight;
    var c = small.map[key];
    if (c) return c;
    var g0 = getMeasureCtx(), sw = stroke ? Math.max(2, size * 0.26) : 0;
    var adv = measure(g0, ch, size, weight);
    var pad = Math.ceil(sw / 2 + 2), w = adv + pad * 2, h = size * 1.4 + pad * 2;
    c = cached(small, key, w, h, function (g) {
      strokeText(g, ch, pad, h / 2, size, fill, stroke, sw, weight, 'left');
    });
    c.adv = adv; c.pad = pad;
    return c;
  }
  var mctx = null;
  function getMeasureCtx() { if (!mctx) mctx = doc.createElement('canvas').getContext('2d'); return mctx; }
  // 拼字画数字/短串，返回宽度。align: left/center/right，y 为垂直中线
  function drawGlyphs(g, s, x, y, size, fill, stroke, weight, align) {
    s = String(s);
    var i, tot = 0, cs = [];
    for (i = 0; i < s.length; i++) { var c = glyph(s.charAt(i), size, fill, stroke, weight || W_HEAVY); cs.push(c); tot += c.adv; }
    var cx = align === 'center' ? x - tot / 2 : (align === 'right' ? x - tot : x);
    var sm = g.imageSmoothingEnabled; g.imageSmoothingEnabled = true;
    for (i = 0; i < cs.length; i++) { g.drawImage(cs[i], cx - cs[i].pad, y - cs[i].lh / 2, cs[i].lw, cs[i].lh); cx += cs[i].adv; }
    g.imageSmoothingEnabled = sm;
    return tot;
  }
  // 整串缓存的描边字（适合不常变的文字）
  function textSprite(s, size, fill, stroke, weight, sw) {
    var key = 'tx|' + s + '|' + size + '|' + fill + '|' + stroke + '|' + weight + '|' + sw;
    var c = small.map[key];
    if (c) return c;
    var g0 = getMeasureCtx(), lw = stroke ? (sw || Math.max(2, size * 0.24)) : 0;
    var tw = measure(g0, s, size, weight || W_HEAVY), pad = Math.ceil(lw / 2 + 3);
    var w = tw + pad * 2, h = size * 1.4 + pad * 2;
    c = cached(small, key, w, h, function (g) { strokeText(g, s, w / 2, h / 2, size, fill, stroke, lw, weight || W_HEAVY); });
    c.tw = tw;
    return c;
  }
  // 画一段描边字（带缓存），返回 {x,y,w,h}
  function label(g, s, x, y, opts) {
    opts = opts || {};
    var size = opts.size || 14, c = textSprite(s, size, opts.color || PAL.textLight, opts.stroke === undefined ? PAL.ink : opts.stroke, opts.weight || W_BOLD, opts.strokeWidth);
    var align = opts.align || 'center', dx = align === 'center' ? -c.lw / 2 : (align === 'right' ? -c.lw + (c.lw - c.tw) / 2 : -(c.lw - c.tw) / 2);
    if (opts.alpha !== undefined) { var a = g.globalAlpha; g.globalAlpha = a * opts.alpha; blit(g, c, x + dx, y - c.lh / 2); g.globalAlpha = a; }
    else blit(g, c, x + dx, y - c.lh / 2);
    return { x: x + dx, y: y - c.lh / 2, w: c.lw, h: c.lh };
  }

  // ================= 按钮 =================
  // style: 'primary'(朱红) | 'secondary'(青铜绿) | 'wood'(木色) | 'purple' | 'off'(禁用灰)
  function btnPal(style) {
    if (style === 'secondary' || style === 'jade') return PAL.jade;
    if (style === 'wood' || style === 'dark') return PAL.wood;
    if (style === 'purple') return PAL.purple;
    if (style === 'off' || style === 'disabled') return PAL.off;
    return PAL.red;
  }
  function drawButtonBody(g, w, h, pal, pressed, fontSize, labelText, sub) {
    var ow = 3, depth = Math.max(4, Math.round(h * 0.11)), r = Math.min(h * 0.42, 22);
    var shY = 3, bodyH = h - shY;                 // 底部留 3px 给落地阴影
    var press = pressed ? depth - 1 : 0;
    // 落地阴影
    g.fillStyle = PAL.shadow; rr(g, 3, shY + 1, w - 6, bodyH, r); g.fill();
    // 粗描边外框（含厚度）
    g.fillStyle = PAL.ink; rr(g, 0, press, w, bodyH - press, r); g.fill();
    // 厚度侧面
    g.fillStyle = pal.side; rr(g, ow, press + ow, w - ow * 2, bodyH - press - ow * 2, r - ow); g.fill();
    // 正面渐变
    var fy = press + ow, fh = bodyH - press - ow * 2 - (depth - press);
    g.fillStyle = vgrad(g, fy, fy + fh, [[0, pal.top], [0.45, pal.mid], [1, pal.bot]]);
    rr(g, ow, fy, w - ow * 2, fh, r - ow); g.fill();
    // 顶部高光带
    g.fillStyle = vgrad(g, fy + 2, fy + fh * 0.5, [[0, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0.06)']]);
    rr(g, ow + 5, fy + 2.5, w - ow * 2 - 10, fh * 0.46, Math.max(2, r - ow - 4)); g.fill();
    // 底边暗线
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(ow + r * 0.6, fy + fh - 1); g.lineTo(w - ow - r * 0.6, fy + fh - 1); g.stroke();
    if (pal !== PAL.off) gleam(g, ow + Math.max(10, r * 0.7), fy + fh * 0.26, Math.max(2.2, h * 0.05));
    // 文字
    var cy = fy + fh / 2 + (sub ? -fontSize * 0.28 : 0.5);
    var strokeC = pal.stroke || PAL.ink;
    g.fillStyle = 'rgba(0,0,0,0.18)';
    strokeText(g, labelText, w / 2, cy + 2, fontSize, 'rgba(0,0,0,0)', 'rgba(58,29,16,0.45)', fontSize * 0.34, W_HEAVY);
    strokeText(g, labelText, w / 2, cy, fontSize, pal.label, strokeC, fontSize * 0.3, W_HEAVY);
    if (sub) strokeText(g, sub, w / 2, cy + fontSize * 0.95, fontSize * 0.55, 'rgba(255,255,255,0.95)', strokeC, fontSize * 0.2, W_BOLD);
  }
  /**
   * 按钮。opts: {style, pressed, fontSize, sub}
   * 返回点击区域 {x,y,w,h}
   */
  function button(g, x, y, w, h, text, opts) {
    opts = opts || {};
    var pal = btnPal(opts.style), pressed = !!opts.pressed;
    var fs = opts.fontSize || Math.min(22, h * 0.4);
    var g0 = getMeasureCtx(), tw = measure(g0, text, fs, W_HEAVY);
    if (tw > w - 28) fs = Math.max(11, fs * (w - 28) / tw);
    w = Math.round(w); h = Math.round(h);
    var key = 'btn|' + (opts.style || 'primary') + '|' + w + '|' + h + '|' + text + '|' + (opts.sub || '') + '|' + (pressed ? 1 : 0) + '|' + fs;
    var c = cached(big, key, w, h, function (cg) { drawButtonBody(cg, w, h, pal, pressed, fs, text, opts.sub); });
    blit(g, c, x, y);
    return { x: x, y: y, w: w, h: h };
  }
  // 圆角方形小图标按钮（暂停、声音等）
  function iconButton(g, x, y, w, h, glyph0, opts) {
    opts = opts || {};
    var pal = btnPal(opts.style || 'wood'), pressed = !!opts.pressed;
    var key = 'ibtn|' + (opts.style || 'wood') + '|' + w + '|' + h + '|' + glyph0 + '|' + (pressed ? 1 : 0);
    var c = cached(big, key, w, h, function (cg) {
      drawButtonBody(cg, w, h, pal, pressed, 1, '', '');
      var press = pressed ? Math.max(4, Math.round(h * 0.11)) - 1 : 0, cy = h / 2 - 2 + press * 0.6;
      if (glyph0 === 'pause') {
        var bw = Math.max(3, w * 0.12), bh = h * 0.4;
        for (var s = -1; s <= 1; s += 2) {
          cg.fillStyle = PAL.ink; rr(cg, w / 2 + s * bw * 0.95 - bw / 2 - 1.5, cy - bh / 2 - 1.5, bw + 3, bh + 3, 2.5); cg.fill();
          cg.fillStyle = '#ffffff'; rr(cg, w / 2 + s * bw * 0.95 - bw / 2, cy - bh / 2, bw, bh, 1.5); cg.fill();
        }
      } else strokeText(cg, glyph0, w / 2, cy, h * 0.46, '#ffffff', PAL.ink, h * 0.14, W_HEAVY);
    });
    blit(g, c, x, y);
    return { x: x, y: y, w: w, h: h };
  }

  // ================= 面板 =================
  function drawPanelBody(g, w, h, o) {
    var pad = o.selected ? 6 : 0, x = pad, y = pad, pw = w - pad * 2, ph = h - pad * 2 - 3;
    var r = o.radius || 16, kind = o.kind || 'paper';
    if (o.selected) {
      g.save(); g.shadowColor = PAL.selectedGlow; g.shadowBlur = 10;
      g.fillStyle = PAL.selected; rr(g, x - 4, y - 4, pw + 8, ph + 8, r + 4); g.fill(); g.restore();
    }
    // 落地阴影
    g.fillStyle = PAL.shadow; rr(g, x + 2, y + 4, pw - 4, ph, r); g.fill();
    // 描边
    g.fillStyle = PAL.ink; rr(g, x, y, pw, ph, r); g.fill();
    var ix = x + 3, iy = y + 3, iw = pw - 6, ih = ph - 6, ir = r - 3;
    if (kind === 'bamboo') {
      g.fillStyle = PAL.bamboo.base; rr(g, ix, iy, iw, ih, ir); g.fill();
      g.save(); rr(g, ix, iy, iw, ih, ir); g.clip();
      var sw = 22;
      for (var sx = ix + sw; sx < ix + iw; sx += sw) {
        g.fillStyle = PAL.bamboo.slat; g.fillRect(sx - 1.5, iy, 2.5, ih);
        g.fillStyle = PAL.bamboo.hi; g.fillRect(sx + 1, iy, 2, ih);
      }
      g.fillStyle = vgrad(g, iy, iy + ih, [[0, 'rgba(255,255,255,0.35)'], [0.3, 'rgba(255,255,255,0)'], [1, 'rgba(160,100,30,0.12)']]);
      g.fillRect(ix, iy, iw, ih);
      // 编绳
      g.fillStyle = PAL.bamboo.cord;
      g.fillRect(ix, iy + Math.min(13, ih * 0.1), iw, 3); g.fillRect(ix, iy + ih - Math.min(13, ih * 0.1) - 3, iw, 3);
      g.restore();
    } else if (kind === 'dark') {
      g.fillStyle = vgrad(g, iy, iy + ih, [[0, PAL.dark.top], [1, PAL.dark.bot]]); rr(g, ix, iy, iw, ih, ir); g.fill();
      g.strokeStyle = PAL.dark.line; g.lineWidth = 1.5; rr(g, ix + 4, iy + 4, iw - 8, ih - 8, Math.max(2, ir - 4)); g.stroke();
    } else {
      g.fillStyle = vgrad(g, iy, iy + ih, [[0, o.tint || PAL.paper.top], [1, o.tint2 || PAL.paper.bot]]); rr(g, ix, iy, iw, ih, ir); g.fill();
      // 上沿柔光
      g.fillStyle = 'rgba(255,255,255,0.55)'; rr(g, ix + 6, iy + 3, iw - 12, Math.min(12, ih * 0.12), 6); g.fill();
      g.strokeStyle = PAL.paper.line; g.lineWidth = 2; g.setLineDash([6, 4]);
      rr(g, ix + 6, iy + 6, iw - 12, ih - 12, Math.max(2, ir - 5)); g.stroke(); g.setLineDash([]);
    }
    if (o.corners !== false && kind !== 'dark' && pw > 90 && ph > 60) {
      var cs = Math.min(12, ph * 0.12), cc = kind === 'bamboo' ? PAL.bamboo.cord : PAL.paper.cloud, m = 9;
      cloudCurl(g, ix + m, iy + m, cs, false, false, cc);
      cloudCurl(g, ix + iw - m, iy + m, cs, true, false, cc);
      cloudCurl(g, ix + m, iy + ih - m, cs, false, true, cc);
      cloudCurl(g, ix + iw - m, iy + ih - m, cs, true, true, cc);
    }
  }
  /**
   * 面板底板。opts: {kind:'paper'|'bamboo'|'dark', selected, corners, radius, title, titleStyle}
   * 返回 {x,y,w,h}
   */
  function panel(g, x, y, w, h, opts) {
    opts = opts || {};
    w = Math.round(w); h = Math.round(h);
    var pad = opts.selected ? 6 : 0;
    var key = 'pnl|' + (opts.kind || 'paper') + '|' + w + '|' + h + '|' + (opts.selected ? 1 : 0) + '|' + (opts.corners === false ? 0 : 1) + '|' + (opts.radius || 16) + '|' + (opts.tint || '') + (opts.tint2 || '');
    var c = cached(big, key, w + pad * 2, h + pad * 2 + 3, function (cg, cw, ch) { drawPanelBody(cg, cw, ch, { kind: opts.kind, selected: opts.selected, corners: opts.corners, radius: opts.radius, tint: opts.tint, tint2: opts.tint2 }); });
    blit(g, c, x - pad, y - pad);
    if (opts.title) ribbon(g, x + w / 2, y, opts.title, { style: opts.titleStyle || 'primary', size: opts.titleSize || 18 });
    return { x: x, y: y, w: w, h: h };
  }
  // 标题飘带（居中于 cx, cy）
  function ribbon(g, cx, cy, text, opts) {
    opts = opts || {};
    var size = opts.size || 18, pal = btnPal(opts.style);
    var g0 = getMeasureCtx(), tw = measure(g0, text, size, W_HEAVY);
    var bw = Math.round(tw + size * 2.2), bh = Math.round(size * 1.9), tail = Math.round(size * 0.9);
    var W = bw + tail * 2 + 6, H = bh + 10;
    var key = 'rib|' + text + '|' + size + '|' + (opts.style || 'primary');
    var c = cached(big, key, W, H, function (cg) {
      var x0 = tail + 3, y0 = 3;
      // 燕尾
      for (var s = 0; s < 2; s++) {
        var ex = s ? x0 + bw + tail - 2 : x0 - tail + 2, ix2 = s ? x0 + bw - 8 : x0 + 8, dir = s ? -1 : 1;
        cg.fillStyle = PAL.ink; cg.beginPath();
        cg.moveTo(ix2, y0 + 6); cg.lineTo(ex - dir * 2, y0 + 6); cg.lineTo(ex + dir * tail * 0.45, y0 + 6 + bh * 0.5); cg.lineTo(ex - dir * 2, y0 + 6 + bh); cg.lineTo(ix2, y0 + 6 + bh); cg.closePath(); cg.fill();
        cg.fillStyle = pal.side; cg.beginPath();
        cg.moveTo(ix2, y0 + 9); cg.lineTo(ex + dir * 1, y0 + 9); cg.lineTo(ex + dir * tail * 0.45 - dir * 4, y0 + 6 + bh * 0.5); cg.lineTo(ex + dir * 1, y0 + 3 + bh); cg.lineTo(ix2, y0 + 3 + bh); cg.closePath(); cg.fill();
      }
      cg.fillStyle = PAL.ink; rr(cg, x0, y0, bw, bh, bh * 0.3); cg.fill();
      cg.fillStyle = vgrad(cg, y0, y0 + bh, [[0, pal.top], [0.5, pal.mid], [1, pal.bot]]); rr(cg, x0 + 3, y0 + 3, bw - 6, bh - 6, bh * 0.25); cg.fill();
      cg.fillStyle = 'rgba(255,255,255,0.35)'; rr(cg, x0 + 7, y0 + 5, bw - 14, bh * 0.3, bh * 0.15); cg.fill();
      strokeText(cg, text, x0 + bw / 2, y0 + bh / 2 + 0.5, size, '#ffffff', PAL.ink, size * 0.3, W_HEAVY);
    });
    blit(g, c, cx - W / 2, cy - H / 2);
    return { x: cx - W / 2, y: cy - H / 2, w: W, h: H };
  }

  // ================= 标题大字 =================
  var TITLE_SCHEMES = {
    gold: { fill: [[0, '#fffbd6'], [0.35, '#ffe46a'], [0.7, '#ffbf2e'], [1, '#f28a18']], rim: '#e5452a', ink: PAL.ink },
    red: { fill: [[0, '#ffd1b8'], [0.4, '#ff7a52'], [1, '#d9301f']], rim: '#fff1c8', ink: PAL.ink },
    jade: { fill: [[0, '#e9fff4'], [0.4, '#86eec0'], [1, '#22a676']], rim: '#fff1c8', ink: PAL.ink },
    purple: { fill: [[0, '#fff6ff'], [0.4, '#e2b6ff'], [1, '#9a52dc']], rim: '#ffd84a', ink: PAL.ink }
  };
  /**
   * 描金描边大标题：粗描边 + 彩色内圈 + 渐变填充 + 顶部光泽 + 投影；字略微错落，Q 萌圆润
   * opts: {scheme:'gold'|'red'|'jade'|'purple', maxW, bounce(默认 true), sparkle}
   * 以 (x, y) 为中心，返回 {x,y,w,h}
   */
  function titleText(g, text, x, y, size, opts) {
    opts = opts || {};
    var sch = TITLE_SCHEMES[opts.scheme || 'gold'] || TITLE_SCHEMES.gold;
    var bounce = opts.bounce !== false, g0 = getMeasureCtx();
    var gap = size * 0.02, chars = text.split(''), i, tw = 0, adv = [];
    for (i = 0; i < chars.length; i++) { adv.push(measure(g0, chars[i], size, W_HEAVY)); tw += adv[i] + (i ? gap : 0); }
    if (opts.maxW && tw + size * 0.7 > opts.maxW) { var k = opts.maxW / (tw + size * 0.7); size = Math.floor(size * k); tw *= k; gap *= k; for (i = 0; i < adv.length; i++) adv[i] *= k; }
    var outer = size * 0.32, pad = Math.ceil(outer + size * 0.25), W = Math.ceil(tw + pad * 2), H = Math.ceil(size * 1.3 + pad * 2);
    var key = 'ttl|' + text + '|' + size + '|' + (opts.scheme || 'gold') + '|' + (bounce ? 1 : 0) + '|' + (opts.sparkle ? 1 : 0);
    var c = cached(big, key, W, H, function (cg) {
      var pos = [], cx = pad, cy = H / 2 - size * 0.04;
      var ROT = [-0.07, 0.05, -0.03, 0.06, -0.05, 0.04, -0.06, 0.05];
      var DY = [0.03, -0.04, 0.02, -0.03, 0.04, -0.02, 0.03, -0.04];
      for (var j = 0; j < chars.length; j++) {
        pos.push({ x: cx + adv[j] / 2, y: cy + (bounce ? DY[j % 8] * size : 0), r: bounce ? ROT[j % 8] : 0 });
        cx += adv[j] + gap;
      }
      function each(fn) {
        for (var q = 0; q < chars.length; q++) { cg.save(); cg.translate(pos[q].x, pos[q].y); cg.rotate(pos[q].r); fn(chars[q]); cg.restore(); }
      }
      cg.font = font(size, W_HEAVY); cg.textAlign = 'center'; cg.textBaseline = 'middle'; cg.lineJoin = 'round';
      // 1 投影
      each(function (ch) { cg.translate(0, size * 0.09); cg.lineWidth = outer; cg.strokeStyle = 'rgba(58,29,16,0.45)'; cg.strokeText(ch, 0, 0); });
      // 2 深色粗描边
      each(function (ch) { cg.lineWidth = outer; cg.strokeStyle = sch.ink; cg.strokeText(ch, 0, 0); cg.fillStyle = sch.ink; cg.fillText(ch, 0, 0); });
      // 3 彩色内圈
      each(function (ch) { cg.lineWidth = outer * 0.52; cg.strokeStyle = sch.rim; cg.strokeText(ch, 0, 0); });
      // 4 渐变填充 + 光泽：先画到独立层再用 source-atop 叠高光
      var layer = makeCanvas(W, H), lg = layer.getContext('2d');
      lg.scale(DPR, DPR); lg.font = cg.font; lg.textAlign = 'center'; lg.textBaseline = 'middle'; lg.lineJoin = 'round';
      for (var q = 0; q < chars.length; q++) {
        lg.save(); lg.translate(pos[q].x, pos[q].y); lg.rotate(pos[q].r);
        lg.fillStyle = vgrad(lg, -size * 0.5, size * 0.5, sch.fill);
        lg.lineWidth = size * 0.05; lg.strokeStyle = lg.fillStyle; lg.strokeText(chars[q], 0, 0); // 略加粗
        lg.fillText(chars[q], 0, 0); lg.restore();
      }
      lg.globalCompositeOperation = 'source-atop';
      lg.fillStyle = 'rgba(255,255,255,0.45)';
      lg.beginPath(); lg.ellipse(W / 2, H / 2 - size * 0.42, W * 0.6, size * 0.34, 0, 0, TAU); lg.fill();
      lg.fillStyle = 'rgba(170,60,0,0.18)'; lg.fillRect(0, H / 2 + size * 0.22, W, H);
      cg.save(); cg.setTransform(1, 0, 0, 1, 0, 0); cg.drawImage(layer, 0, 0); cg.restore();
      if (opts.sparkle) {
        sparkle(cg, pad * 0.7, H * 0.3, size * 0.12); sparkle(cg, W - pad * 0.6, H * 0.36, size * 0.1);
        sparkle(cg, W - pad * 1.2, H * 0.78, size * 0.07); sparkle(cg, pad * 1.4, H * 0.82, size * 0.06);
      }
    });
    blit(g, c, x - W / 2, y - H / 2);
    return { x: x - W / 2, y: y - H / 2, w: W, h: H };
  }

  // ================= 战斗横幅 =================
  /**
   * 横幅：「赵括要来了！」「获得 · 秦弩齐射」
   * opts: {sub, kind:'warn'|'gain'|'big'|'info', alpha, scale, maxW, size(字号，默认 22；big 为 34)}
   * 以 (cx, cy) 为中心
   */
  function bannerText(g, text, cx, cy, opts) {
    opts = opts || {};
    var kind = opts.kind || 'info', maxW = opts.maxW || 340;
    var pal = kind === 'warn' ? PAL.red : (kind === 'gain' ? PAL.jade : (kind === 'big' ? PAL.red : PAL.wood));
    var size = opts.size || (kind === 'big' ? 34 : 22), g0 = getMeasureCtx();
    var tw = measure(g0, text, size, W_HEAVY);
    if (tw > maxW - size * 2.4) { size = Math.max(14, Math.floor(size * (maxW - size * 2.4) / tw)); tw = measure(g0, text, size, W_HEAVY); }
    var bw = Math.round(Math.min(maxW, tw + size * 2.4)), bh = Math.round(size * 1.85), subH = opts.sub ? 24 : 0;
    var W = bw + 8, H = bh + subH + 14;
    var key = 'ban|' + kind + '|' + text + '|' + (opts.sub || '') + '|' + bw + '|' + size;
    var c = cached(big, key, W, H, function (cg) {
      var x0 = 4, y0 = 4, r = bh * 0.5;
      cg.fillStyle = PAL.shadow; rr(cg, x0 + 2, y0 + 5, bw - 4, bh, r); cg.fill();
      cg.fillStyle = PAL.ink; rr(cg, x0, y0, bw, bh, r); cg.fill();
      cg.fillStyle = pal.side; rr(cg, x0 + 3, y0 + 3, bw - 6, bh - 6, r - 3); cg.fill();
      cg.fillStyle = vgrad(cg, y0 + 3, y0 + bh - 6, [[0, pal.top], [0.5, pal.mid], [1, pal.bot]]); rr(cg, x0 + 3, y0 + 3, bw - 6, bh - 9, r - 3); cg.fill();
      cg.fillStyle = 'rgba(255,255,255,0.4)'; rr(cg, x0 + r * 0.6, y0 + 5, bw - r * 1.2, bh * 0.28, bh * 0.14); cg.fill();
      // 两端云纹
      cloudCurl(cg, x0 + r * 0.55, y0 + bh * 0.3, bh * 0.22, false, false, 'rgba(255,255,255,0.75)');
      cloudCurl(cg, x0 + bw - r * 0.55, y0 + bh * 0.3, bh * 0.22, true, false, 'rgba(255,255,255,0.75)');
      var tc = kind === 'big' || kind === 'warn' ? '#fff3a8' : '#ffffff';
      strokeText(cg, text, x0 + bw / 2, y0 + bh / 2 - 1, size, tc, PAL.ink, size * 0.3, W_HEAVY);
      if (opts.sub) {
        var sw = Math.min(bw - 20, measure(cg, opts.sub, 13, W_BOLD) + 26), sx = x0 + (bw - sw) / 2, sy = y0 + bh - 3;
        cg.fillStyle = PAL.ink; rr(cg, sx, sy, sw, 22, 11); cg.fill();
        cg.fillStyle = PAL.cream; rr(cg, sx + 2, sy + 2, sw - 4, 18, 9); cg.fill();
        strokeText(cg, opts.sub, x0 + bw / 2, sy + 11.5, 13, PAL.text, null, 0, W_BOLD);
      }
    });
    var sc = opts.scale || 1, a = opts.alpha === undefined ? 1 : opts.alpha, oa = g.globalAlpha;
    g.globalAlpha = oa * clamp(a, 0, 1);
    blit(g, c, cx - W * sc / 2, cy - (bh / 2 + 4) * sc, W * sc, H * sc);
    g.globalAlpha = oa;
    return { x: cx - W * sc / 2, y: cy - (bh / 2 + 4) * sc, w: W * sc, h: H * sc };
  }

  // ================= 顶部状态条 =================
  function fmtTime(t) {
    if (typeof t === 'string') return t;
    t = Math.max(0, Math.floor(t || 0));
    var m = Math.floor(t / 60), s = t % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function topLayout(w) {
    var k = clamp(w / 270, 0.78, 1.15), h = Math.round(38 * Math.min(1, k + 0.1));
    var badge = Math.round(h * 0.56);
    return { k: k, h: h, badgeR: badge, killX: badge * 2 + 8, coinX: w - Math.round(62 * k), timeX: Math.round(w * 0.55) };
  }
  /**
   * 顶部状态条（Lv、斩、时间、铜钱 + 经验细条）。data: {level, kills, time(秒或 'mm:ss'), coins, exp(0..1)}
   * 框体缓存；数字用字形精灵拼接，每帧只有几次 drawImage + 一次经验条填充
   * 返回 {x,y,w,h}
   */
  function topBar(g, x, y, w, data) {
    w = Math.round(w);
    var L = topLayout(w), h = L.h, k = L.k, fs = Math.round(15 * k);
    var frame = cached(big, 'top|' + w, w, h + 8, function (cg) {
      var bx = L.badgeR - 2, bw = w - bx;
      cg.fillStyle = PAL.shadow; rr(cg, bx + 2, 4, bw - 2, h - 2, h / 2); cg.fill();
      cg.fillStyle = PAL.ink; rr(cg, bx, 1, bw, h - 2, h / 2); cg.fill();
      cg.fillStyle = vgrad(cg, 4, h - 4, [[0, '#fff6df'], [1, '#ffe2a6']]); rr(cg, bx + 3, 4, bw - 6, h - 8, h / 2 - 3); cg.fill();
      cg.fillStyle = 'rgba(255,255,255,0.7)'; rr(cg, bx + h * 0.5, 6, bw - h, 5, 2.5); cg.fill();
      // 经验槽底
      cg.fillStyle = PAL.ink; rr(cg, bx + h * 0.45, h - 9, bw - h * 0.8, 9, 4.5); cg.fill();
      cg.fillStyle = '#7a5532'; rr(cg, bx + h * 0.45 + 2, h - 7, bw - h * 0.8 - 4, 5, 2.5); cg.fill();
      // 分隔竹节
      cg.fillStyle = 'rgba(160,110,50,0.35)';
      cg.fillRect(L.timeX - Math.round(34 * k), 9, 2, h - 20); cg.fillRect(L.coinX - Math.round(10 * k), 9, 2, h - 20);
      // Lv 徽章（圆形朱红印）
      sealBadge(cg, L.badgeR + 1, h / 2 + 1, L.badgeR - 2, '', PAL.red.mid, PAL.red.side);
      strokeText(cg, 'Lv', L.badgeR + 1, h / 2 - L.badgeR * 0.42, Math.round(9 * k + 1), '#fff3a8', PAL.ink, 2.5, W_HEAVY);
      // 斩：小剑印
      sealBadge(cg, L.killX + 8 * k, h / 2 - 2, 9 * k, '斩', '#5b6a86', '#2c3446');
      // 时间：沙漏般的小钟
      var tx = L.timeX - Math.round(22 * k), ty = h / 2 - 2, tr = 7 * k;
      cg.fillStyle = PAL.ink; cg.beginPath(); cg.arc(tx, ty, tr + 2, 0, TAU); cg.fill();
      cg.fillStyle = '#ffffff'; cg.beginPath(); cg.arc(tx, ty, tr, 0, TAU); cg.fill();
      cg.strokeStyle = PAL.ink; cg.lineWidth = 1.8; cg.lineCap = 'round';
      cg.beginPath(); cg.moveTo(tx, ty); cg.lineTo(tx, ty - tr * 0.6); cg.moveTo(tx, ty); cg.lineTo(tx + tr * 0.5, ty + 1); cg.stroke();
      coinIcon(cg, L.coinX + 4 * k, h / 2 - 2, 8 * k);
    });
    blit(g, frame, x, y);
    // 经验填充（纯色圆角条，便宜）
    var ex = x + L.badgeR - 2 + h * 0.45 + 2, ew = w - (L.badgeR - 2) - h * 0.8 - 4, ef = clamp(data.exp || 0, 0, 1);
    if (ef > 0) {
      var fw = Math.max(5, ew * ef);
      g.fillStyle = PAL.exp.bot; rr(g, ex, y + h - 7, fw, 5, 2.5); g.fill();
      g.fillStyle = PAL.exp.top; g.fillRect(ex + 2.5, y + h - 7, Math.max(0, fw - 5), 2);
    }
    // 数字
    drawGlyphs(g, String(data.level || 1), x + L.badgeR + 1, y + h / 2 + L.badgeR * 0.2 + 1, Math.round(16 * k), '#ffffff', PAL.ink, W_HEAVY, 'center');
    drawGlyphs(g, String(data.kills || 0), x + L.killX + 20 * k, y + h / 2 - 2, fs, PAL.text, null, W_HEAVY, 'left');
    drawGlyphs(g, fmtTime(data.time), x + L.timeX - Math.round(11 * k), y + h / 2 - 2, Math.round(17 * k), PAL.text, null, W_HEAVY, 'left');
    drawGlyphs(g, String(data.coins || 0), x + L.coinX + 16 * k, y + h / 2 - 2, fs, '#b86a00', null, W_HEAVY, 'left');
    return { x: x, y: y, w: w, h: h };
  }

  // ================= Boss 血条 =================
  /**
   * data: {name, hp(0..1), lag(0..1 可选：受击残影), icon(单字，默认'括')}
   * 返回 {x,y,w,h}
   */
  function bossBar(g, x, y, w, data) {
    w = Math.round(w);
    var h = 30, iconR = 17, bx = iconR * 2 - 4, bw = w - bx, name = data.name || '赵括 · 纸上谈兵', icon = data.icon || '括';
    var frame = cached(big, 'boss|' + w + '|' + name + '|' + icon, w, h + 16, function (cg) {
      cg.fillStyle = PAL.shadow; rr(cg, bx + 2, 15, bw - 2, h - 10, (h - 10) / 2); cg.fill();
      cg.fillStyle = PAL.ink; rr(cg, bx, 11, bw, h - 10, (h - 10) / 2); cg.fill();
      cg.fillStyle = '#5a2430'; rr(cg, bx + 3, 14, bw - 6, h - 16, (h - 16) / 2); cg.fill();
      sealBadge(cg, iconR, iconR + 3, iconR - 2, icon, '#8c5ad6', '#4f2a85');
      // 名牌
      var nw = Math.min(bw - 30, measure(cg, name, 12, W_HEAVY) + 22), nx = bx + 14;
      cg.fillStyle = PAL.ink; rr(cg, nx, h - 3, nw, 18, 9); cg.fill();
      cg.fillStyle = PAL.cream; rr(cg, nx + 2, h - 1, nw - 4, 14, 7); cg.fill();
      strokeText(cg, name, nx + nw / 2, h + 6, 12, PAL.text, null, 0, W_HEAVY);
    });
    var fill = cached(big, 'bossfill|' + w, bw, h - 16, function (cg, fw, fh) {
      cg.fillStyle = vgrad(cg, 0, fh, [[0, PAL.boss.top], [0.5, '#ff4d6a'], [1, PAL.boss.bot]]); rr(cg, 0, 0, fw, fh, fh / 2); cg.fill();
      cg.fillStyle = 'rgba(255,255,255,0.5)'; rr(cg, fh * 0.4, 2, fw - fh * 0.8, fh * 0.28, 2); cg.fill();
    });
    blit(g, frame, x, y);
    var fx = x + bx + 3, fy = y + 14, fw2 = bw - 6, fh2 = h - 16;
    var lag = clamp(data.lag === undefined ? 0 : data.lag, 0, 1), hp = clamp(data.hp, 0, 1);
    if (lag > hp) { g.fillStyle = PAL.boss.lag; rr(g, fx, fy, Math.max(fh2, fw2 * lag), fh2, fh2 / 2); g.fill(); }
    if (hp > 0) {
      var sw = Math.max(fh2, fw2 * hp), sm = g.imageSmoothingEnabled; g.imageSmoothingEnabled = true;
      g.drawImage(fill, 0, 0, sw * DPR, fill.height, fx, fy, sw, fh2);
      g.imageSmoothingEnabled = sm;
    }
    return { x: x, y: y, w: w, h: h + 16 };
  }

  // ================= 技能格 =================
  /**
   * data: {img(可选 Image/Canvas), imgKey, ch(单字), name(两字名), color, evolved, time(秒，用于进化发光)}
   * size：图标边长。名字画在图标下方。返回 {x,y,w,h}（含名字）
   */
  function skillSlot(g, x, y, size, data) {
    size = Math.round(size);
    var ev = !!data.evolved, img = data.img, hasImg = !!(img && (img.complete === undefined || img.complete) && (img.width || img.naturalWidth));
    var name = data.name || '', W = size + 10, H = size + 26;
    var key = 'slot|' + size + '|' + (data.ch || '') + '|' + name + '|' + (data.color || '') + '|' + (ev ? 1 : 0) + '|' + (hasImg ? (data.imgKey || img.src || 'img') : '');
    var c = cached(big, key, W, H, function (cg) {
      var bx = 5, by = 3, r = size * 0.28, base = data.color || '#8a5a2b';
      cg.fillStyle = PAL.shadow; rr(cg, bx + 1, by + 4, size, size, r); cg.fill();
      cg.fillStyle = PAL.ink; rr(cg, bx - 2, by - 2, size + 4, size + 4, r + 2); cg.fill();
      cg.fillStyle = ev ? '#ffd84a' : PAL.cream; rr(cg, bx, by, size, size, r); cg.fill();
      var ix = bx + 3, iy = by + 3, is = size - 6, ir = r - 2;
      cg.save(); rr(cg, ix, iy, is, is, ir); cg.clip();
      if (hasImg) {
        cg.fillStyle = base; cg.fillRect(ix, iy, is, is);
        cg.drawImage(img, ix, iy, is, is);
      } else {
        cg.fillStyle = vgrad(cg, iy, iy + is, [[0, lighten(base, 0.3)], [0.55, base], [1, darken(base, 0.25)]]); cg.fillRect(ix, iy, is, is);
        cg.fillStyle = 'rgba(255,255,255,0.18)'; cg.beginPath(); cg.arc(ix + is * 0.8, iy + is * 0.85, is * 0.45, 0, TAU); cg.fill();
        strokeText(cg, data.ch || '?', ix + is / 2, iy + is / 2 + 1, is * 0.56, '#ffffff', PAL.ink, is * 0.14, W_HEAVY);
      }
      cg.fillStyle = 'rgba(255,255,255,0.38)'; rr(cg, ix + 3, iy + 2, is - 6, is * 0.26, is * 0.12); cg.fill();
      cg.restore();
      if (ev) { sparkle(cg, bx + size - 3, by + 4, 5, '#fffbe0'); sparkle(cg, bx + 4, by + size - 6, 3.5, '#fffbe0'); }
      // 名字小牌
      if (name) {
        var nw = Math.min(W, measure(cg, name, 11, W_HEAVY) + 12), nx = (W - nw) / 2, ny = by + size + 3;
        cg.fillStyle = PAL.ink; rr(cg, nx, ny, nw, 17, 8.5); cg.fill();
        cg.fillStyle = ev ? '#ff7a2a' : '#6b4026'; rr(cg, nx + 1.5, ny + 1.5, nw - 3, 14, 7); cg.fill();
        strokeText(cg, name, W / 2, ny + 9, 11, '#fff6dc', null, 0, W_HEAVY);
      }
    });
    if (ev) {
      var glow = cached(big, 'slotglow|' + size, size + 24, size + 24, function (cg, gw, gh) {
        var gr = cg.createRadialGradient(gw / 2, gh / 2, size * 0.3, gw / 2, gh / 2, gw / 2);
        gr.addColorStop(0, 'rgba(255,220,80,0.9)'); gr.addColorStop(0.6, 'rgba(255,140,30,0.45)'); gr.addColorStop(1, 'rgba(255,120,0,0)');
        cg.fillStyle = gr; cg.fillRect(0, 0, gw, gh);
      });
      var oa = g.globalAlpha, t = data.time || 0;
      g.globalAlpha = oa * (0.55 + 0.45 * Math.sin(t * 5));
      blit(g, glow, x + 5 + size / 2 - (size + 24) / 2, y + 3 + size / 2 - (size + 24) / 2);
      g.globalAlpha = oa;
    }
    blit(g, c, x, y);
    return { x: x, y: y, w: W, h: H };
  }
  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lighten(hex, k) { var c = hexToRgb(hex); return 'rgb(' + Math.round(c[0] + (255 - c[0]) * k) + ',' + Math.round(c[1] + (255 - c[1]) * k) + ',' + Math.round(c[2] + (255 - c[2]) * k) + ')'; }
  function darken(hex, k) { var c = hexToRgb(hex); return 'rgb(' + Math.round(c[0] * (1 - k)) + ',' + Math.round(c[1] * (1 - k)) + ',' + Math.round(c[2] * (1 - k)) + ')'; }

  // ================= 怒气条 =================
  /**
   * data: {value(0..1), full(bool，可省：value>=1 即满), time(秒), hint(满时提示文字，可选)}
   * x 为条左端（左侧另画「怒」字圆徽，向左伸出约 22px）。返回 {x,y,w,h}
   */
  function rageBar(g, x, y, w, data) {
    w = Math.round(w);
    var h = 18, v = clamp(data.value || 0, 0, 1), full = data.full === undefined ? v >= 1 : !!data.full, t = data.time || 0;
    var frame = cached(big, 'rage|' + w, w, h + 4, function (cg) {
      cg.fillStyle = PAL.shadow; rr(cg, 2, 4, w - 2, h - 1, h / 2); cg.fill();
      cg.fillStyle = PAL.ink; rr(cg, 0, 1, w, h, h / 2); cg.fill();
      cg.fillStyle = '#5a2a1a'; rr(cg, 3, 4, w - 6, h - 6, (h - 6) / 2); cg.fill();
      // 刻度
      cg.fillStyle = 'rgba(255,220,180,0.25)';
      for (var i = 1; i < 4; i++) cg.fillRect(Math.round(w * i / 4), 5, 1.5, h - 8);
    });
    var fill = cached(big, 'ragefill|' + w, w - 6, h - 6, function (cg, fw, fh) {
      cg.fillStyle = vgrad(cg, 0, fh, [[0, PAL.rage.top], [1, PAL.rage.bot]]); rr(cg, 0, 0, fw, fh, fh / 2); cg.fill();
      cg.fillStyle = 'rgba(255,255,255,0.5)'; rr(cg, fh * 0.4, 1.5, fw - fh * 0.8, fh * 0.3, 2); cg.fill();
    });
    var fullFill = cached(big, 'ragefull|' + w, w - 6, h - 6, function (cg, fw, fh) {
      cg.fillStyle = vgrad(cg, 0, fh, [[0, PAL.rage.full1], [1, PAL.rage.full2]]); rr(cg, 0, 0, fw, fh, fh / 2); cg.fill();
      cg.fillStyle = 'rgba(255,255,255,0.7)'; rr(cg, fh * 0.4, 1.5, fw - fh * 0.8, fh * 0.32, 2); cg.fill();
      for (var sx = 10; sx < fw; sx += 26) sparkle(cg, sx, fh / 2, 3, '#ffffff');
    });
    var halo = full ? cached(big, 'ragehalo|' + w, w + 24, h + 24, function (cg, hw, hh) {
      cg.shadowColor = 'rgba(255,170,40,1)'; cg.shadowBlur = 10;
      cg.fillStyle = 'rgba(255,200,60,0.9)'; rr(cg, 12, 12, w, h, h / 2); cg.fill();
    }) : null;
    var oa = g.globalAlpha, pulse = 0.5 + 0.5 * Math.sin(t * 10);
    if (halo) { g.globalAlpha = oa * (0.35 + 0.65 * pulse); blit(g, halo, x - 12, y - 11); g.globalAlpha = oa; }
    blit(g, frame, x, y);
    if (v > 0) {
      var fw2 = Math.max(h - 6, (w - 6) * v), src = full ? fullFill : fill, sm = g.imageSmoothingEnabled;
      g.imageSmoothingEnabled = true;
      g.drawImage(src, 0, 0, fw2 * DPR, src.height, x + 3, y + 4, fw2, h - 6);
      if (full) { g.globalAlpha = oa * 0.35 * pulse; g.fillStyle = '#ffffff'; rr(g, x + 3, y + 4, fw2, h - 6, (h - 6) / 2); g.fill(); g.globalAlpha = oa; }
      g.imageSmoothingEnabled = sm;
    }
    // 「怒」字圆徽：满时在两种状态间闪动
    var ic = cached(big, 'rageicon|' + (full ? 1 : 0), 34, 36, function (cg) {
      if (full) sealBadge(cg, 17, 17, 14, '怒', '#ff5a2a', '#a8180c');
      else sealBadge(cg, 17, 17, 14, '怒', '#c6402c', '#7a1a10');
    });
    var bob = full ? Math.sin(t * 10) * 1.5 : 0, s = full ? 1 + 0.08 * pulse : 1;
    blit(g, ic, x - 26 - 17 * (s - 1), y - 7 + bob - 17 * (s - 1), 34 * s, 36 * s);
    if (full && data.hint) {
      var hint = textSprite(data.hint, 13, '#fff3a8', PAL.ink, W_HEAVY);
      g.globalAlpha = oa * (0.75 + 0.25 * pulse);
      blit(g, hint, x + w / 2 - hint.lw / 2, y - hint.lh + 2);
      g.globalAlpha = oa;
    }
    return { x: x - 26, y: y - 7, w: w + 26, h: h + 8 };
  }

  // ================= 弹窗与遮罩 =================
  function dim(g, W, H, a) { g.fillStyle = a === undefined ? PAL.overlay : 'rgba(36,14,6,' + a + ')'; g.fillRect(0, 0, W, H); }
  /**
   * 暂停面板：继续 / 重新开始 / 返回主菜单
   * opts: {title, pressed:'resume'|'restart'|'home', tip}
   * 返回 {panel, resume, restart, home} 四个区域
   */
  function pausePanel(g, W, H, opts) {
    opts = opts || {};
    dim(g, W, H, 0.55);
    var pw = Math.min(300, W - 40), bh = 54, gap = 14, ph = 46 + bh * 3 + gap * 2 + (opts.tip ? 52 : 24);
    var px = Math.round((W - pw) / 2), py = Math.round(H * 0.46 - ph / 2);
    var p = panel(g, px, py, pw, ph, { kind: 'bamboo' });
    ribbon(g, W / 2, py + 2, opts.title || '暂停', { style: 'primary', size: 20 });
    var bw = pw - 48, bx = px + 24, by = py + 46;
    var r1 = button(g, bx, by, bw, bh, '继续', { style: 'primary', pressed: opts.pressed === 'resume' });
    var r2 = button(g, bx, by + bh + gap, bw, bh, '重新开始', { style: 'wood', pressed: opts.pressed === 'restart' });
    var r3 = button(g, bx, by + (bh + gap) * 2, bw, bh, '返回主菜单', { style: 'secondary', pressed: opts.pressed === 'home' });
    if (opts.tip) label(g, opts.tip, W / 2, by + (bh + gap) * 3 + 8, { size: 12, color: PAL.textSub, stroke: null, weight: W_BOLD });
    return { panel: p, resume: r1, restart: r2, home: r3 };
  }

  // ================= 商品卡 / 技能卡 =================
  /**
   * 货栈商品卡（也可当升级选技能卡用：不传 price）
   * data: {img, imgKey, ch, color, name, desc, price(数字或文字), tag('新！' 等), sold, afford(默认 true), gold(高亮), selected, pressed}
   * 返回 {x,y,w,h}
   */
  function shopCard(g, x, y, w, h, data) {
    w = Math.round(w); h = Math.round(h);
    var sold = !!data.sold, afford = data.afford !== false, gold = !!data.gold;
    var key = 'shop|' + w + '|' + h + '|' + [data.ch, data.color, data.name, data.desc, data.price, data.tag, sold ? 1 : 0, afford ? 1 : 0, gold ? 1 : 0, data.selected ? 1 : 0, data.imgKey || ''].join('|');
    var pad = data.selected ? 6 : 0;
    var c = cached(big, key, w + pad * 2, h + pad * 2 + 3, function (cg, cw, ch) {
      drawPanelBody(cg, cw, ch, { kind: 'paper', selected: data.selected, corners: false, radius: 14, tint: gold ? '#fff7cc' : undefined, tint2: gold ? '#ffe08a' : undefined });
      var ox = pad, oy = pad, isz = Math.min(54, h - 26), ix = ox + 12, iy = oy + (h - isz) / 2 - 1;
      // 图标
      cg.fillStyle = PAL.ink; rr(cg, ix - 2, iy - 2, isz + 4, isz + 4, isz * 0.3); cg.fill();
      cg.save(); rr(cg, ix, iy, isz, isz, isz * 0.28); cg.clip();
      var base = data.color || '#8a5a2b';
      cg.fillStyle = vgrad(cg, iy, iy + isz, [[0, lighten(base, 0.45)], [0.55, base], [1, darken(base, 0.25)]]); cg.fillRect(ix, iy, isz, isz);
      if (data.img) cg.drawImage(data.img, ix, iy, isz, isz);
      else strokeText(cg, data.ch || '?', ix + isz / 2, iy + isz / 2 + 1, isz * 0.52, '#ffffff', PAL.ink, isz * 0.13, W_HEAVY);
      cg.fillStyle = 'rgba(255,255,255,0.38)'; rr(cg, ix + 3, iy + 2, isz - 6, isz * 0.26, isz * 0.12); cg.fill();
      cg.restore();
      // 价格签
      var hasPrice = data.price !== undefined && data.price !== null && data.price !== '';
      var priceW = 0, rightX = ox + w - 12;
      if (sold || hasPrice) {
        var ptxt = sold ? '已购' : String(data.price), psz = 14;
        priceW = measure(cg, ptxt, psz, W_HEAVY) + (sold ? 22 : 38);
        var px2 = rightX - priceW, py2 = oy + 11;
        cg.fillStyle = PAL.ink; rr(cg, px2, py2, priceW, 26, 13); cg.fill();
        cg.fillStyle = sold ? '#9b948a' : (afford ? '#ffd24a' : '#e7b9a8'); rr(cg, px2 + 2, py2 + 2, priceW - 4, 22, 11); cg.fill();
        cg.fillStyle = 'rgba(255,255,255,0.45)'; rr(cg, px2 + 6, py2 + 4, priceW - 12, 6, 3); cg.fill();
        if (!sold) coinIcon(cg, px2 + 14, py2 + 13, 7);
        strokeText(cg, ptxt, px2 + (sold ? priceW / 2 : 24 + (priceW - 24) / 2 - 4), py2 + 13.5, psz, sold ? '#ffffff' : (afford ? PAL.text : '#a0302a'), sold ? PAL.ink : null, 3, W_HEAVY);
      }
      // 名称与描述
      var tx = ix + isz + 12, tw = ox + w - tx - 12;
      var nameMax = tw - (priceW ? priceW + 6 : 0), nsz = 17;
      var nwid = measure(cg, data.name || '', nsz, W_HEAVY);
      if (nwid > nameMax) nsz = Math.max(12, Math.floor(nsz * nameMax / nwid));
      strokeText(cg, data.name || '', tx, oy + (h < 84 ? 21 : 24), nsz, PAL.text, null, 0, W_HEAVY, 'left');
      if (data.tag) {
        var tgw = measure(cg, data.tag, 11, W_HEAVY) + 12, tgx = tx + Math.min(nameMax - tgw, measure(cg, data.name || '', nsz, W_HEAVY) + 6);
        cg.fillStyle = '#e8452c'; rr(cg, tgx, oy + 15, tgw, 18, 9); cg.fill();
        strokeText(cg, data.tag, tgx + tgw / 2, oy + 24.5, 11, '#ffffff', null, 0, W_HEAVY);
      }
      var dsz = h < 84 ? 12.5 : 13, dlh = h < 84 ? 16 : 18;
      var lines = wrapLines(cg, data.desc || '', tw, dsz, W_NORMAL), maxL = Math.max(1, Math.floor((h - 40) / dlh));
      for (var i = 0; i < Math.min(maxL, lines.length); i++) {
        var ln = lines[i]; if (i === maxL - 1 && lines.length > maxL) ln = ln.slice(0, Math.max(1, ln.length - 1)) + '…';
        strokeText(cg, ln, tx, oy + (h < 84 ? 45 : 49) + i * dlh, dsz, PAL.textSub, null, 0, W_NORMAL, 'left');
      }
      if (sold || !afford) { cg.fillStyle = 'rgba(120,100,80,0.32)'; rr(cg, ox + 3, oy + 3, w - 6, h - 6, 12); cg.fill(); }
    });
    blit(g, c, x - pad, y - pad + (data.pressed ? 2 : 0));
    return { x: x, y: y, w: w, h: h };
  }

  // ================= 选将卡 =================
  /**
   * 选将卡：左边立绘区，右边文字区
   * data: {name, title, lines:[{text, color}] 或 [字符串], stats:[['体魄',4,5],['脚力',2,5]],
   *        selected, portraitBg(颜色), portrait: function(g, cx, footY, areaW, areaH) 由调用方画立绘（可动画，不缓存）}
   * 返回 {x,y,w,h}
   */
  function heroCard(g, x, y, w, h, data) {
    w = Math.round(w); h = Math.round(h);
    var sel = !!data.selected, pw = Math.round(Math.min(124, w * (w < 320 ? 0.31 : 0.36)));
    var linesKey = '';
    var lines = data.lines || [];
    for (var q = 0; q < lines.length; q++) linesKey += (typeof lines[q] === 'string' ? lines[q] : lines[q].text + lines[q].color) + '/';
    var statsKey = data.stats ? JSON.stringify(data.stats) : '';
    var pad = sel ? 6 : 0;
    var key = 'hero|' + w + '|' + h + '|' + data.name + '|' + data.title + '|' + linesKey + statsKey + '|' + (sel ? 1 : 0) + '|' + (data.portraitBg || '');
    var c = cached(big, key, w + pad * 2, h + pad * 2 + 3, function (cg, cw, ch) {
      drawPanelBody(cg, cw, ch, { kind: 'paper', selected: sel, corners: true, radius: 18, tint: sel ? '#fffbef' : undefined, tint2: sel ? '#ffe7a8' : undefined });
      var ox = pad, oy = pad;
      // 立绘底：圆角窗 + 放射光
      var ax = ox + 12, ay = oy + 12, ah = h - 24, bg = data.portraitBg || '#7fb8e8';
      cg.fillStyle = PAL.ink; rr(cg, ax - 2.5, ay - 2.5, pw + 5, ah + 5, 16); cg.fill();
      cg.save(); rr(cg, ax, ay, pw, ah, 14); cg.clip();
      cg.fillStyle = vgrad(cg, ay, ay + ah, [[0, lighten(bg, 0.55)], [0.65, bg], [1, darken(bg, 0.2)]]); cg.fillRect(ax, ay, pw, ah);
      cg.fillStyle = 'rgba(255,255,255,0.18)';
      for (var k = 0; k < 10; k++) { var a0 = k * TAU / 10; cg.beginPath(); cg.moveTo(ax + pw / 2, ay + ah * 0.45); cg.arc(ax + pw / 2, ay + ah * 0.45, ah, a0, a0 + TAU / 20); cg.closePath(); cg.fill(); }
      cg.fillStyle = 'rgba(60,30,10,0.18)'; cg.beginPath(); cg.ellipse(ax + pw / 2, ay + ah - 16, pw * 0.36, 7, 0, 0, TAU); cg.fill();
      cg.restore();
      // 文字区
      var tx = ax + pw + 14, tw = ox + w - tx - 14, ty = oy + 30;
      strokeText(cg, data.name || '', tx, ty, 26, '#ffffff', PAL.ink, 7, W_HEAVY, 'left');
      var nmW = measure(cg, data.name || '', 26, W_HEAVY);
      if (data.title) {
        var tsz = 12, ttw = measure(cg, data.title, tsz, W_HEAVY) + 14, ttx = tx + nmW + 8;
        if (ttx + ttw > ox + w - 14) { ttx = tx; ty += 0; }
        if (ttx + ttw <= ox + w - 14) {
          cg.fillStyle = PAL.ink; rr(cg, ttx, ty - 10, ttw, 21, 10.5); cg.fill();
          cg.fillStyle = PAL.red.mid; rr(cg, ttx + 1.5, ty - 8.5, ttw - 3, 18, 9); cg.fill();
          strokeText(cg, data.title, ttx + ttw / 2, ty + 0.5, tsz, '#ffffff', null, 0, W_HEAVY);
        }
      }
      var ly = ty + 30, bottom = oy + h - (data.stats ? 38 : 14);
      // 字号从 13 往下试，直到所有条目都放得下（小屏不丢信息）
      var fsz = 13, lh = 18, wrapped = [];
      for (var tryF = 13; tryF >= 10.5; tryF -= 0.5) {
        fsz = tryF; lh = Math.round(tryF * 1.36); wrapped = [];
        var need = 0;
        for (var i0 = 0; i0 < lines.length; i0++) {
          var it0 = typeof lines[i0] === 'string' ? { text: lines[i0] } : lines[i0];
          var wl0 = wrapLines(cg, it0.text, tw - 10, tryF, W_BOLD);
          wrapped.push({ it: it0, wl: wl0 }); need += wl0.length * lh + 2;
        }
        if (ly + need - lh <= bottom) break;
      }
      for (var i = 0; i < wrapped.length; i++) {
        var it = wrapped[i].it, wl = wrapped[i].wl;
        for (var j = 0; j < wl.length; j++) {
          if (ly > bottom) break;
          if (j === 0) { cg.fillStyle = it.color || PAL.paper.cloud; cg.beginPath(); cg.arc(tx + 3, ly, 3, 0, TAU); cg.fill(); }
          strokeText(cg, wl[j], tx + 10, ly, fsz, it.color ? darken(it.color, 0.15) : PAL.text, null, 0, W_BOLD, 'left');
          ly += lh;
        }
        ly += 2;
      }
      if (data.stats) {
        var sy = oy + h - 26, sx = tx, labW = 0, dots = 0, ns = data.stats.length;
        for (var s0 = 0; s0 < ns; s0++) { labW += measure(cg, data.stats[s0][0], 12, W_HEAVY) + 4; dots += data.stats[s0][2] || 5; }
        var sp = clamp((tw - labW - 10 * (ns - 1)) / dots, 6.5, 10), dr = sp * 0.46;
        for (var s = 0; s < ns; s++) {
          var st = data.stats[s], mx = st[2] || 5;
          strokeText(cg, st[0], sx, sy, 12, PAL.textSub, null, 0, W_HEAVY, 'left');
          var px0 = sx + measure(cg, st[0], 12, W_HEAVY) + 4;
          for (var d = 0; d < mx; d++) {
            cg.fillStyle = PAL.ink; cg.beginPath(); cg.arc(px0 + d * sp + sp / 2, sy, dr + 1.3, 0, TAU); cg.fill();
            cg.fillStyle = d < st[1] ? '#ffc93a' : '#e8dcc0'; cg.beginPath(); cg.arc(px0 + d * sp + sp / 2, sy, dr, 0, TAU); cg.fill();
          }
          sx = px0 + mx * sp + 10;
        }
      }
    });
    blit(g, c, x - pad, y - pad);
    if (data.portrait) {
      g.save(); rr(g, x + 12, y + 12, pw, h - 24, 14); g.clip();
      data.portrait(g, x + 12 + pw / 2, y + h - 22, pw, h - 24);
      g.restore();
    }
    if (sel) {
      var tag = cached(big, 'heroSel', 54, 28, function (cg) {
        cg.fillStyle = PAL.ink; rr(cg, 1, 1, 52, 26, 13); cg.fill();
        cg.fillStyle = vgrad(cg, 3, 25, [[0, PAL.gold.top], [1, PAL.gold.bot]]); rr(cg, 3, 3, 48, 22, 11); cg.fill();
        strokeText(cg, '已选', 27, 14.5, 13, PAL.text, null, 0, W_HEAVY);
      });
      blit(g, tag, x + w - 60, y - 10);
    }
    return { x: x, y: y, w: w, h: h };
  }

  // ================= 提示与对话 =================
  /**
   * 轻提示。opts: {alpha, kind:'info'|'good'|'bad'}；以 (cx, cy) 为中心
   */
  function toast(g, text, cx, cy, opts) {
    opts = opts || {};
    var kind = opts.kind || 'info', size = 14, g0 = getMeasureCtx();
    var tw = measure(g0, text, size, W_HEAVY), w = Math.round(tw + 40), h = 36;
    var face = kind === 'good' ? '#e6ffef' : (kind === 'bad' ? '#ffe6df' : PAL.cream);
    var dot = kind === 'good' ? PAL.jade.mid : (kind === 'bad' ? PAL.red.mid : PAL.gold.mid);
    var c = cached(big, 'toast|' + text + '|' + kind, w, h + 4, function (cg) {
      cg.fillStyle = PAL.shadow; rr(cg, 2, 4, w - 4, h, h / 2); cg.fill();
      cg.fillStyle = PAL.ink; rr(cg, 0, 0, w, h, h / 2); cg.fill();
      cg.fillStyle = face; rr(cg, 3, 3, w - 6, h - 6, h / 2 - 3); cg.fill();
      cg.fillStyle = dot; cg.beginPath(); cg.arc(18, h / 2, 5, 0, TAU); cg.fill();
      strokeText(cg, text, w / 2 + 7, h / 2 + 0.5, size, PAL.text, null, 0, W_HEAVY);
    });
    var oa = g.globalAlpha; g.globalAlpha = oa * (opts.alpha === undefined ? 1 : opts.alpha);
    blit(g, c, cx - w / 2, cy - h / 2);
    g.globalAlpha = oa;
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
  }
  /** 对话气泡（Boss 台词等）：尾巴指向 (x, y) 下方 */
  function bubble(g, text, x, y, opts) {
    opts = opts || {};
    var size = opts.size || 13, tw = measure(getMeasureCtx(), text, size, W_HEAVY), w = Math.round(tw + 24), h = 28;
    var c = cached(big, 'bub|' + text + '|' + size, w + 4, h + 12, function (cg) {
      cg.fillStyle = PAL.ink; rr(cg, 0, 0, w, h, 12); cg.fill();
      cg.beginPath(); cg.moveTo(w / 2 - 8, h - 2); cg.lineTo(w / 2, h + 10); cg.lineTo(w / 2 + 8, h - 2); cg.fill();
      cg.fillStyle = '#ffffff'; rr(cg, 2.5, 2.5, w - 5, h - 5, 10); cg.fill();
      cg.beginPath(); cg.moveTo(w / 2 - 5, h - 3); cg.lineTo(w / 2, h + 6); cg.lineTo(w / 2 + 5, h - 3); cg.fill();
      strokeText(cg, text, w / 2, h / 2, size, PAL.text, null, 0, W_HEAVY);
    });
    blit(g, c, x - w / 2, y - h - 10);
    return { x: x - w / 2, y: y - h - 10, w: w, h: h + 10 };
  }

  // ================= 背景 =================
  /**
   * 菜单 / 选将 / 加载用的明亮背景：蓝天、圆云、圆润远山、暖色地面。静态部分缓存，云朵按时间飘动
   * opts: {groundY(0..1，地面高度比例，默认 0.72), clouds(默认 true)}
   */
  function sceneBg(g, W, H, t, opts) {
    opts = opts || {};
    var gy = opts.groundY || 0.72;
    var c = cached(big, 'bg|' + W + '|' + H + '|' + gy, W, H, function (cg) {
      cg.fillStyle = vgrad(cg, 0, H * gy, [[0, PAL.sky.top], [0.65, PAL.sky.mid], [1, PAL.sky.low]]); cg.fillRect(0, 0, W, H);
      // 太阳光晕
      var sg = cg.createRadialGradient(W * 0.8, H * 0.12, 4, W * 0.8, H * 0.12, W * 0.5);
      sg.addColorStop(0, 'rgba(255,250,210,0.9)'); sg.addColorStop(1, 'rgba(255,250,210,0)'); cg.fillStyle = sg; cg.fillRect(0, 0, W, H);
      // 远山：几个圆包
      function hills(baseY, amp, n, color, seed) {
        cg.fillStyle = color; cg.strokeStyle = PAL.hill.line; cg.lineWidth = 2.5;
        cg.beginPath(); cg.moveTo(-10, H);
        cg.lineTo(-10, baseY);
        var step = (W + 20) / n;
        for (var i = 0; i < n; i++) {
          var x0 = -10 + i * step, hh = amp * (0.6 + 0.4 * Math.abs(Math.sin(i * 1.9 + seed)));
          cg.bezierCurveTo(x0 + step * 0.1, baseY - hh, x0 + step * 0.9, baseY - hh, x0 + step, baseY);
        }
        cg.lineTo(W + 10, H); cg.closePath(); cg.fill(); cg.stroke();
      }
      hills(H * (gy - 0.06), H * 0.1, 4, PAL.hill.far, 0.3);
      hills(H * (gy - 0.01), H * 0.07, 5, PAL.hill.near, 1.7);
      // 地面
      cg.fillStyle = PAL.ink; cg.fillRect(0, H * gy - 3, W, 3);
      cg.fillStyle = vgrad(cg, H * gy, H, [[0, PAL.ground.top], [1, PAL.ground.bot]]); cg.fillRect(0, H * gy, W, H * (1 - gy));
      cg.fillStyle = PAL.ground.dot;
      for (var i = 0; i < 26; i++) { cg.beginPath(); cg.ellipse((i * 67 + 13) % W, H * gy + 12 + (i * 41) % (H * (1 - gy) - 20), 5, 2.2, 0, 0, TAU); cg.fill(); }
      // 草丛
      cg.fillStyle = '#7fcf5a'; cg.strokeStyle = PAL.ink; cg.lineWidth = 2;
      for (i = 0; i < 6; i++) {
        var gx = (i * 97 + 30) % W, gyy = H * gy + 20 + (i * 53) % (H * (1 - gy) - 40);
        cg.beginPath(); cg.moveTo(gx - 9, gyy); cg.quadraticCurveTo(gx - 8, gyy - 10, gx - 3, gyy - 12); cg.quadraticCurveTo(gx, gyy - 4, gx + 2, gyy - 14); cg.quadraticCurveTo(gx + 6, gyy - 5, gx + 10, gyy - 9); cg.quadraticCurveTo(gx + 9, gyy - 2, gx + 9, gyy); cg.closePath(); cg.fill(); cg.stroke();
      }
    });
    blit(g, c, 0, 0);
    if (opts.clouds !== false) {
      var cl = cached(big, 'cloud', 96, 46, function (cg) {
        cg.fillStyle = 'rgba(120,170,210,0.45)';
        cg.beginPath(); cg.arc(30, 30, 15, 0, TAU); cg.arc(50, 22, 20, 0, TAU); cg.arc(70, 30, 15, 0, TAU); cg.rect(28, 30, 44, 14); cg.fill();
        cg.fillStyle = '#ffffff';
        cg.beginPath(); cg.arc(30, 27, 14, 0, TAU); cg.arc(50, 19, 18, 0, TAU); cg.arc(70, 27, 14, 0, TAU); cg.rect(28, 27, 44, 13); cg.fill();
      });
      var tt = t || 0;
      for (var k = 0; k < 4; k++) {
        var cx = ((k * 131 + tt * (8 + k * 3)) % (W + 120)) - 100, cy = H * (0.06 + k * 0.075);
        var s = 0.7 + (k % 3) * 0.25;
        blit(g, cl, cx, cy, 96 * s, 46 * s);
      }
    }
  }

  // ================= 加载界面 =================
  /**
   * 加载界面：「整军中…」+ 竹简进度条 + 转动铜钱
   * opts: {time, tip, title}
   */
  function loadingScreen(g, W, H, progress, opts) {
    opts = opts || {};
    var t = opts.time || 0, p = clamp(progress || 0, 0, 1);
    sceneBg(g, W, H, t, { groundY: 0.74 });
    titleText(g, opts.title || '横扫六国', W / 2, H * 0.24, Math.min(58, W * 0.15), { maxW: W - 24, sparkle: true });
    // 转动铜钱
    var cy = H * 0.47, sx = Math.abs(Math.cos(t * 3));
    g.save(); g.translate(W / 2, cy + Math.sin(t * 4) * 4); g.scale(Math.max(0.15, sx), 1);
    coinIcon(g, 0, 0, 26);
    g.restore();
    // 进度条（竹简节）
    var bw = Math.min(260, W - 60), bh = 26, bx = Math.round((W - bw) / 2), by = Math.round(H * 0.58);
    var frame = cached(big, 'load|' + bw, bw, bh + 4, function (cg) {
      cg.fillStyle = PAL.shadow; rr(cg, 2, 4, bw - 2, bh, bh / 2); cg.fill();
      cg.fillStyle = PAL.ink; rr(cg, 0, 0, bw, bh, bh / 2); cg.fill();
      cg.fillStyle = '#8a5a30'; rr(cg, 3, 3, bw - 6, bh - 6, bh / 2 - 3); cg.fill();
    });
    var fill = cached(big, 'loadfill|' + bw, bw - 6, bh - 6, function (cg, fw, fh) {
      cg.fillStyle = PAL.bamboo.base; rr(cg, 0, 0, fw, fh, fh / 2); cg.fill();
      cg.save(); rr(cg, 0, 0, fw, fh, fh / 2); cg.clip();
      for (var sx2 = 14; sx2 < fw; sx2 += 16) { cg.fillStyle = PAL.bamboo.slat; cg.fillRect(sx2, 0, 2.5, fh); }
      cg.fillStyle = 'rgba(255,255,255,0.55)'; cg.fillRect(0, 2, fw, fh * 0.25);
      cg.restore();
    });
    blit(g, frame, bx, by);
    if (p > 0) {
      var fw3 = Math.max(bh - 6, (bw - 6) * p), sm = g.imageSmoothingEnabled; g.imageSmoothingEnabled = true;
      g.drawImage(fill, 0, 0, fw3 * DPR, fill.height, bx + 3, by + 3, fw3, bh - 6); g.imageSmoothingEnabled = sm;
    }
    var dots = ['', '.', '..', '...'][Math.floor(t * 3) % 4];
    label(g, '整军中' + dots, bx, by - 18, { size: 18, color: '#ffffff', align: 'left', weight: W_HEAVY });
    drawGlyphs(g, Math.round(p * 100) + '%', bx + bw, by - 18, 16, '#ffffff', PAL.ink, W_HEAVY, 'right');
    if (opts.tip) {
      var c = cached(big, 'loadtip|' + opts.tip + '|' + W, W - 48, 44, function (cg, cw, ch) {
        cg.fillStyle = 'rgba(58,29,16,0.55)'; rr(cg, 0, 0, cw, ch, 14); cg.fill();
        var ls = wrapLines(cg, opts.tip, cw - 28, 13, W_BOLD);
        for (var i = 0; i < Math.min(2, ls.length); i++) strokeText(cg, ls[i], cw / 2, ch / 2 + (i - (Math.min(2, ls.length) - 1) / 2) * 17, 13, '#fff6dc', null, 0, W_BOLD);
      });
      blit(g, c, 24, by + bh + 22);
    }
  }

  // ================= 军功战报卡（750×1334） =================
  /**
   * 在 750×1334 的 canvas 上画整张战报卡。数据全部由调用方算好传入：
   * d: {win, heroName, heroTitle, kills, time, level, merit, rankName, rankUp, rankSub, nextText, nextProgress(0..1，可省),
   *     title(称号), stage('长平 · 纸上谈兵'), footer, portraitBg, portrait: function(g, cx, footY, scale)}
   */
  function reportCard(g, d) {
    var W = 750, H = 1334, i;
    // 战报卡是一次性大图：临时换用独立缓存、按 1 倍像素画，不占用战斗缓存
    var sBig = big, sSmall = small, sDpr = DPR;
    big = { map: {}, n: 0, max: 999 }; small = { map: {}, n: 0, max: 999 }; DPR = 1;
    try { drawReport(g, d, W, H); } finally { big = sBig; small = sSmall; DPR = sDpr; }
  }
  function drawReport(g, d, W, H) {
    var i;
    // 背景：暖色放射光
    g.fillStyle = vgrad(g, 0, H, [[0, '#ffd88a'], [0.5, '#ffb866'], [1, '#f28a4a']]); g.fillRect(0, 0, W, H);
    g.save(); g.globalAlpha = 0.22; g.fillStyle = '#fff6d0';
    for (i = 0; i < 18; i++) { var a0 = i * TAU / 18; g.beginPath(); g.moveTo(W / 2, 430); g.arc(W / 2, 430, 1400, a0, a0 + TAU / 36); g.closePath(); g.fill(); }
    g.restore();
    // 底板
    panel(g, 34, 300, W - 68, H - 362, { kind: 'paper', radius: 34 });
    titleText(g, '军功战报', W / 2, 118, 104, { sparkle: true, maxW: W - 60 });
    ribbon(g, W / 2, 232, d.stage || '长平 · 纸上谈兵', { style: 'secondary', size: 32 });
    // 印章
    g.save(); g.translate(W - 132, 368); g.rotate(-0.2);
    g.fillStyle = PAL.ink; g.beginPath(); g.arc(0, 4, 68, 0, TAU); g.fill();
    g.fillStyle = d.win ? PAL.red.mid : '#9a9a9a'; g.beginPath(); g.arc(0, 0, 63, 0, TAU); g.fill();
    g.strokeStyle = '#fff3d0'; g.lineWidth = 4; g.setLineDash([10, 7]); g.beginPath(); g.arc(0, 0, 52, 0, TAU); g.stroke(); g.setLineDash([]);
    strokeText(g, d.win ? '大捷' : '惜败', 0, 2, 44, '#ffffff', PAL.ink, 10, W_HEAVY);
    g.restore();
    // 立绘圆窗
    var bg = d.portraitBg || '#86c8f0';
    g.fillStyle = PAL.ink; g.beginPath(); g.arc(W / 2, 470, 158, 0, TAU); g.fill();
    g.fillStyle = vgrad(g, 316, 624, [[0, lighten(bg, 0.5)], [1, bg]]); g.beginPath(); g.arc(W / 2, 470, 150, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(W / 2 - 40, 380, 70, 30, -0.4, 0, TAU); g.fill();
    if (d.portrait) { g.save(); g.beginPath(); g.arc(W / 2, 470, 150, 0, TAU); g.clip(); d.portrait(g, W / 2, 600, 4.4); g.restore(); }
    ribbon(g, W / 2, 640, d.heroName + (d.heroTitle ? ' · ' + d.heroTitle : ''), { style: 'primary', size: 38 });
    // 数据竹简
    var rows = [['斩敌', String(d.kills)], ['用时', fmtTime(d.time)], ['等级', 'Lv ' + d.level], ['本局军功', '+' + d.merit]];
    for (i = 0; i < rows.length; i++) {
      var y = 704 + i * 76;
      panel(g, 96, y, W - 192, 64, { kind: 'bamboo', corners: false, radius: 18 });
      strokeText(g, rows[i][0], 140, y + 30, 32, PAL.text, null, 0, W_HEAVY, 'left');
      strokeText(g, rows[i][1], W - 140, y + 30, 40, PAL.red.bot, '#ffffff', 8, W_HEAVY, 'right');
    }
    // 爵位
    strokeText(g, '爵位：' + d.rankName + (d.rankUp ? '  晋爵！' : ''), W / 2, 1030, 44, PAL.gold.mid, PAL.ink, 11, W_HEAVY);
    if (d.rankSub) strokeText(g, d.rankSub, W / 2, 1080, 24, PAL.textSub, null, 0, W_BOLD);
    if (d.nextProgress !== undefined && d.nextProgress !== null) {
      g.fillStyle = PAL.ink; rr(g, 150, 1102, W - 300, 24, 12); g.fill();
      g.fillStyle = '#e8d6ac'; rr(g, 154, 1106, W - 308, 16, 8); g.fill();
      g.fillStyle = vgrad(g, 1106, 1122, [[0, PAL.gold.top], [1, PAL.gold.bot]]); rr(g, 154, 1106, Math.max(16, (W - 308) * clamp(d.nextProgress, 0, 1)), 16, 8); g.fill();
    }
    if (d.nextText) strokeText(g, d.nextText, W / 2, 1146, 22, PAL.textSub, null, 0, W_BOLD);
    ribbon(g, W / 2, 1208, '称号 · ' + d.title, { style: 'primary', size: 36 });
    strokeText(g, d.footer || '横扫六国 · 戏说战国，非史实', W / 2, 1306, 22, '#fff6dc', 'rgba(150,70,20,0.7)', 5, W_BOLD);
  }

  global.QixiongUI = {
    version: '2026-11-20',
    PAL: PAL,
    FONT: FONT,
    setDpr: setDpr,
    clearCache: clearCache,
    cacheStats: cacheStats,
    // 组件
    button: button,
    iconButton: iconButton,
    panel: panel,
    ribbon: ribbon,
    titleText: titleText,
    bannerText: bannerText,
    topBar: topBar,
    bossBar: bossBar,
    skillSlot: skillSlot,
    rageBar: rageBar,
    pausePanel: pausePanel,
    shopCard: shopCard,
    heroCard: heroCard,
    toast: toast,
    bubble: bubble,
    loadingScreen: loadingScreen,
    sceneBg: sceneBg,
    reportCard: reportCard,
    dim: dim,
    label: label,
    // 小工具（可选用）
    drawGlyphs: drawGlyphs,
    coinIcon: coinIcon,
    sealBadge: sealBadge,
    roundRect: rr,
    fmtTime: fmtTime
  };
})(typeof window !== 'undefined' ? window : this);
