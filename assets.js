/**
 * 《横扫六国》图片资源层 —— 把 AI 卡通 Q 萌 PNG 变成 core.js 能直接用的精灵
 * - 兼容 Chrome 61：只用 ES5 写法；零外链；不用任何网络请求接口，只用 new Image()
 * - 图源优先级：window.QixiongAssetsData（assets_data.js 里的 base64，推荐）→ img/ 目录文件（备用）
 * - 任何一张缺失、解码失败、超时或会污染画布，都记为 null，由 core.js 退回代码小人；onDone 一定回调
 * 用法见审核目录《图片加载层-工作记录》第五节。
 */
(function (global) {
  'use strict';

  // ================= 清单 =================
  // kind：sprite 战斗精灵（生成 spriteSet）｜image 普通透明图｜icon 技能图标｜tile 地面平铺（不抠绿）
  //       opaque 不透明背景（不抠绿）｜frames 一张原图横排 N 个小物件，流水线切成 <file>_<i>
  // h / w：目标显示尺寸（逻辑像素，即 core 里 g.setTransform(dpr) 之后的单位）；只给 h 时宽度按原图比例
  // anchor：[ax, ay] 归一化锚点，[0.5, 1] = 脚底中心（core 现有精灵都按脚底中心画）
  // face：原图人物朝向，left/right；core 的 spriteSet.l 是朝左
  // scale：流水线输出倍数（默认 2，即按 2 倍显示尺寸存图）；fmt：png（默认）/ jpg（仅不透明大背景）
  var MANIFEST = {
    // —— 与 core.js buildSprites() 同名的键 ——
    baiqi:  { file: 'baiqi',  kind: 'sprite', h: 60, anchor: [0.5, 1], face: 'right' },
    sunbin: { file: 'sunbin', kind: 'sprite', h: 56, anchor: [0.5, 1], face: 'right' },
    paper:  { file: 'paper',  kind: 'sprite', h: 30, anchor: [0.5, 1], face: 'left' },
    shield: { file: 'shield', kind: 'sprite', h: 32, anchor: [0.5, 1], face: 'left' },
    kite:   { file: 'kite',   kind: 'sprite', h: 32, anchor: [0.5, 1], face: 'left' },
    elite:  { file: 'elite',  kind: 'sprite', h: 48, anchor: [0.5, 1], face: 'left' },
    boss:   { file: 'boss',   kind: 'sprite', h: 80, anchor: [0.5, 1], face: 'left' },
    lv:     { file: 'lv',     kind: 'sprite', h: 72, anchor: [0.5, 1], face: 'left' },
    ox:     { file: 'ox',     kind: 'sprite', h: 34, anchor: [0.5, 1], face: 'right' },
    oxBig:  { file: 'ox',     kind: 'sprite', h: 50, anchor: [0.5, 1], face: 'right' },
    bagua:  { file: 'bagua',  kind: 'image',  h: 136, anchor: [0.5, 0.5] },
    tile:   { file: 'tile',   kind: 'tile',   w: 192, h: 192, anchor: [0, 0] },
    deco:   { file: 'deco',   kind: 'frames', names: ['rock', 'flag', 'halberd', 'wheel', 'grass'], h: [24, 56, 30, 32, 24], anchor: [0, 0] },
    // —— 立绘 ——
    portrait_baiqi:  { file: 'portrait_baiqi',  kind: 'image', h: 200, anchor: [0.5, 1] },
    portrait_sunbin: { file: 'portrait_sunbin', kind: 'image', h: 200, anchor: [0.5, 1] },
    portrait_boss:   { file: 'portrait_boss',   kind: 'image', h: 260, anchor: [0.5, 1] },
    // —— 技能图标 ——
    icon_halberd:   { file: 'icon_halberd',   kind: 'icon', h: 34, anchor: [0.5, 0.5] },
    icon_bagua:     { file: 'icon_bagua',     kind: 'icon', h: 34, anchor: [0.5, 0.5] },
    icon_swordring: { file: 'icon_swordring', kind: 'icon', h: 34, anchor: [0.5, 0.5] },
    icon_crossbow:  { file: 'icon_crossbow',  kind: 'icon', h: 34, anchor: [0.5, 0.5] },
    icon_fireox:    { file: 'icon_fireox',    kind: 'icon', h: 34, anchor: [0.5, 0.5] },
    icon_fireox_evo:{ file: 'icon_fireox_evo',kind: 'icon', h: 34, anchor: [0.5, 0.5] },
    icon_tally:     { file: 'icon_tally',     kind: 'icon', h: 34, anchor: [0.5, 0.5] },
    // —— 界面 ——
    bg_menu: { file: 'bg_menu', kind: 'opaque', w: 375, h: 812, anchor: [0.5, 0.5], fmt: 'jpg' },
    ui_card: { file: 'ui_card', kind: 'image',  w: 320, h: 96, anchor: [0, 0] },
    // card_bg 已出图但战报卡未使用，2026-11-20 美术细节修订第 7 项从清单移除（原图仍在 art/selected/card_bg.png）
    // —— 道具（铜钱、经验玉 3 级、虎符，合在一张原图里）——
    items: { file: 'items', kind: 'frames', names: ['coin', 'jade1', 'jade2', 'jade3', 'tally'], h: [14, 12, 14, 16, 18], anchor: [0.5, 0.5] }
  };

  var CFG = {
    imgBase: 'img/',      // 备用方案：目录图片的相对路径
    useFiles: true,       // 数据文件里没有的键，是否再去 img/ 找
    rejectTainted: true,  // 会污染画布的图（file:// 下的目录图片）直接弃用，保证战报 toDataURL 不报错
    timeout: 8000,        // 单张超时（毫秒）
    totalTimeout: 30000,  // 整体兜底（毫秒），到点把剩下的全部记为 null
    scale: 0              // 预缩放倍数；0 = 自动取 min(devicePixelRatio, 2)，与 core 的 dpr 一致
  };

  var images = {};   // file -> HTMLImageElement | null
  var status = {};   // file -> 'data' | 'file' | 'missing' | 'error' | 'timeout' | 'tainted' | 'skipped'
  var cache = {};
  var loading = false, loaded = false, waiters = [], lastSummary = null;
  var hooks = { createImage: function () { return new Image(); } }; // 测试用：可替换成永不加载的假图

  function now() { return global.performance && global.performance.now ? global.performance.now() : +new Date(); }
  function extOf(e) { return e.fmt === 'jpg' ? '.jpg' : '.png'; }
  function frameCount(e) { return e.names ? e.names.length : 0; }
  function autoScale() { return CFG.scale > 0 ? CFG.scale : Math.min(global.devicePixelRatio || 1, 2); }

  // 全部要加载的文件（同名文件只加载一次）
  function fileList() {
    var out = [], seen = {}, k, e, i, f;
    for (k in MANIFEST) {
      if (!MANIFEST.hasOwnProperty(k)) continue;
      e = MANIFEST[k];
      if (e.kind === 'frames') {
        for (i = 0; i < frameCount(e); i++) { f = e.file + '_' + i; if (!seen[f]) { seen[f] = 1; out.push({ file: f, ext: extOf(e), key: k }); } }
      } else if (!seen[e.file]) { seen[e.file] = 1; out.push({ file: e.file, ext: extOf(e), key: k }); }
    }
    return out;
  }

  function srcFor(item) {
    var data = global.QixiongAssetsData;
    if (data && typeof data[item.file] === 'string' && data[item.file].indexOf('data:image/') === 0) return { src: data[item.file], via: 'data' };
    if (CFG.useFiles) return { src: CFG.imgBase + item.file + item.ext, via: 'file' };
    return null;
  }

  // 画到 1×1 画布再读像素：读不出来说明会污染画布
  function isTainted(img) {
    try {
      var c = document.createElement('canvas'); c.width = c.height = 1;
      var g = c.getContext('2d'); g.drawImage(img, 0, 0, 1, 1); g.getImageData(0, 0, 1, 1);
      return false;
    } catch (e) { return true; }
  }

  function loadOne(item, cb) {
    var s = srcFor(item), done = false, timer = null, img;
    if (!s) { cb(null, 'missing'); return; }
    function finish(res, why) {
      if (done) return; done = true;
      if (timer) clearTimeout(timer);
      if (img) { img.onload = null; img.onerror = null; }
      cb(res, why);
    }
    try {
      img = hooks.createImage();
      img.onload = function () {
        if (!img.naturalWidth || !img.naturalHeight) { finish(null, 'error'); return; }
        if (isTainted(img)) { if (CFG.rejectTainted) { finish(null, 'tainted'); return; } img.qxTainted = true; }
        finish(img, s.via);
      };
      img.onerror = function () { finish(null, s.via === 'file' ? 'missing' : 'error'); };
      timer = setTimeout(function () { finish(null, 'timeout'); }, CFG.timeout);
      img.src = s.src;
    } catch (e) { finish(null, 'error'); }
  }

  /**
   * 逐张加载全部图片。onProgress(done, total, file, ok)；onDone(summary) 一定被调用且只调用一次。
   * 已加载过再调用，直接回调上次结果；加载中再调用，排队等同一次结果。
   */
  function load(onProgress, onDone) {
    if (loaded) { safe(onDone, lastSummary); return; }
    waiters.push({ p: onProgress, d: onDone });
    if (loading) return;
    loading = true;
    var list = fileList(), n = list.length, i = 0, finished = false, t0 = now(), allTimer;
    function report(item, ok) { for (var w = 0; w < waiters.length; w++) safe(waiters[w].p, i, n, item.file, ok); }
    function finishAll() {
      if (finished) return; finished = true;
      if (allTimer) clearTimeout(allTimer);
      for (var j = 0; j < n; j++) if (!(list[j].file in status)) { images[list[j].file] = null; status[list[j].file] = 'skipped'; }
      var sum = { total: n, ok: 0, ms: Math.round(now() - t0), failed: [], status: status };
      for (var f in status) if (status.hasOwnProperty(f)) { if (images[f]) sum.ok++; else sum.failed.push(f + ':' + status[f]); }
      lastSummary = sum; loaded = true; loading = false;
      var ws = waiters; waiters = [];
      for (var w = 0; w < ws.length; w++) safe(ws[w].d, sum);
    }
    function next() {
      if (finished) return;
      if (i >= n) { finishAll(); return; }
      var item = list[i];
      loadOne(item, function (img, why) {
        if (finished) return;
        images[item.file] = img; status[item.file] = why; i++;
        report(item, !!img);
        setTimeout(next, 0);
      });
    }
    allTimer = setTimeout(finishAll, CFG.totalTimeout);
    if (n === 0) finishAll(); else next();
  }
  function safe(fn) {
    if (typeof fn !== 'function') return;
    try { fn.apply(null, Array.prototype.slice.call(arguments, 1)); } catch (e) { if (global.console) global.console.warn('QixiongAssets 回调出错', e); }
  }

  // ================= 取图与预缩放 =================
  function entryOf(key) { return MANIFEST[key] || null; }
  // get('baiqi') / get('deco_2') 取单张；get('deco') 取数组
  function get(key) {
    var e = entryOf(key), i, arr;
    if (e && e.kind === 'frames') { arr = []; for (i = 0; i < frameCount(e); i++) arr.push(images[e.file + '_' + i] || null); return arr; }
    if (e) return images[e.file] || null;
    return images[key] || null;
  }

  // 高质量缩放：先逐级减半（每步不超过 2 倍），最后一步缩到目标；全程开平滑
  function smoothCanvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); var g = c.getContext('2d'); g.imageSmoothingEnabled = true; if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = 'high'; return c; }
  function scaleTo(src, outW, outH) {
    var cur = src, cw = src.naturalWidth || src.width, ch = src.naturalHeight || src.height;
    while (cw / 2 >= outW && ch / 2 >= outH) {
      var nw = Math.max(outW, Math.floor(cw / 2)), nh = Math.max(outH, Math.floor(ch / 2));
      var tmp = smoothCanvas(nw, nh); tmp.getContext('2d').drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
      cur = tmp; cw = nw; ch = nh;
    }
    var out = smoothCanvas(outW, outH); out.getContext('2d').drawImage(cur, 0, 0, cw, ch, 0, 0, outW, outH);
    return out;
  }
  function tagLogical(c, lw, lh, scale, e) {
    c.lw = lw; c.lh = lh; c.qxScale = scale;
    var a = (e && e.anchor) || [0.5, 1]; c.ax = a[0] * lw; c.ay = a[1] * lh;
    return c;
  }
  function logicalSize(img, e, targetH, targetW) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var h = targetH || (e && typeof e.h === 'number' ? e.h : ih), w = targetW || (e && e.w && !targetH ? e.w : 0);
    if (!w) w = Math.max(1, Math.round(h * iw / ih));
    return { w: w, h: h };
  }

  /**
   * 预缩放成画布：像素尺寸 = 逻辑尺寸 × scale；画布带 lw/lh（逻辑宽高）和 ax/ay（锚点，逻辑像素）。
   * core 画时必须写明宽高：g.drawImage(c, x, y, c.lw, c.lh)。缺图返回 null。
   * opts：{ scale, w }；frames 的单帧用 'deco_2' 这类文件名。
   */
  function makeCanvas(key, targetH, opts) {
    opts = opts || {};
    var img = get(key), e = entryOf(key) || entryOf(String(key).replace(/_\d+$/, ''));
    if (!img || img.length !== undefined) return null;
    var scale = opts.scale || autoScale(), sz = logicalSize(img, e, targetH, opts.w);
    var id = key + '|' + sz.w + 'x' + sz.h + '@' + scale;
    if (cache[id]) return cache[id];
    var c;
    if (e && e.kind === 'opaque' && e.w && !targetH) c = coverTo(img, Math.round(sz.w * scale), Math.round(sz.h * scale));
    else c = scaleTo(img, Math.round(sz.w * scale), Math.round(sz.h * scale));
    cache[id] = tagLogical(c, sz.w, sz.h, scale, e);
    return cache[id];
  }
  // 不透明背景：按 cover 方式裁中间
  function coverTo(img, outW, outH) {
    var iw = img.naturalWidth, ih = img.naturalHeight, k = Math.max(outW / iw, outH / ih);
    var sw = outW / k, sh = outH / k, sx = (iw - sw) / 2, sy = (ih - sh) / 2;
    var full = scaleTo(img, Math.round(iw * k), Math.round(ih * k)), out = smoothCanvas(outW, outH);
    out.getContext('2d').drawImage(full, Math.round(sx * k), Math.round(sy * k), outW, outH, 0, 0, outW, outH);
    return out;
  }

  function flip(src) {
    var c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    var g = c.getContext('2d'); g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0); return c;
  }
  // 与 core.tintSprite 同语义：source-in 整体填色，alpha（含抗锯齿半透明边）原样保留，轮廓不变
  function tint(src, color) {
    var c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    var g = c.getContext('2d'); g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height); return c;
  }

  /**
   * 生成与 core.js spriteSet 同结构的 {l,r,wl,wr,il,ir,w,h}，另带 art:true、scale、ax/ay。
   * w/h 是逻辑尺寸；画布像素是 w×scale、h×scale（预缩放到最终尺寸，core 关平滑画也不糊）。
   * targetH 省略时用清单里的 h。缺图返回 null（调用方保留代码小人）。
   */
  function makeSpriteSet(key, targetH, opts) {
    opts = opts || {};
    var e = entryOf(key), base = makeCanvas(key, targetH, opts);
    if (!base) return null;
    var id = 'set|' + key + '|' + base.lw + 'x' + base.lh + '@' + base.qxScale;
    if (cache[id]) return cache[id];
    var faceRight = e && e.face === 'right';
    var l = faceRight ? flip(base) : base, r = faceRight ? base : flip(base);
    var set = {
      l: l, r: r,
      wl: tint(l, '#ffffff'), wr: tint(r, '#ffffff'),
      il: tint(l, '#8fd3ff'), ir: tint(r, '#8fd3ff'),
      w: base.lw, h: base.lh, art: true, scale: base.qxScale, ax: base.ax, ay: base.ay
    };
    cache[id] = set;
    return set;
  }

  /** 地面平铺：先 3×3 拼好再缩，裁中间一块，缩放后接缝处也不会出现半透明暗线。返回带 lw/lh 的画布。 */
  function makeTile(key, size, opts) {
    key = key || 'tile'; opts = opts || {};
    var img = get(key), e = entryOf(key);
    if (!img) return null;
    var lw = size || (e && e.w) || img.naturalWidth, lh = size || (e && e.h) || img.naturalHeight;
    var scale = opts.scale || autoScale(), ow = Math.round(lw * scale), oh = Math.round(lh * scale);
    var id = 'tile|' + key + '|' + lw + 'x' + lh + '@' + scale;
    if (cache[id]) return cache[id];
    var iw = img.naturalWidth, ih = img.naturalHeight, big = document.createElement('canvas');
    big.width = iw * 3; big.height = ih * 3;
    var g = big.getContext('2d'), x, y;
    for (y = 0; y < 3; y++) for (x = 0; x < 3; x++) g.drawImage(img, x * iw, y * ih);
    var scaled = scaleTo(big, ow * 3, oh * 3), out = document.createElement('canvas');
    out.width = ow; out.height = oh;
    out.getContext('2d').drawImage(scaled, ow, oh, ow, oh, 0, 0, ow, oh);
    cache[id] = tagLogical(out, lw, lh, scale, e);
    return cache[id];
  }

  /** frames 类（deco / items）：返回数组，每项是带 lw/lh 的画布或 null（按下标单独退回代码图）。 */
  function makeFrames(key, opts) {
    var e = entryOf(key), out = [], i;
    if (!e || e.kind !== 'frames') return out;
    for (i = 0; i < frameCount(e); i++) out.push(makeCanvas(e.file + '_' + i, e.h[i], opts));
    return out;
  }
  function getDecos(opts) { return makeFrames('deco', opts); }
  /** 道具单个：getItem('coin') / getItem(2) */
  function getItem(name, opts) {
    var e = MANIFEST.items, i = typeof name === 'number' ? name : e.names.indexOf(name);
    if (i < 0 || i >= e.names.length) return null;
    return makeCanvas(e.file + '_' + i, e.h[i], opts);
  }
  /** 技能图标：getIcon('fireox') 或 getIcon('icon_fireox')，size 省略用清单 34 */
  function getIcon(name, size, opts) {
    var key = name.indexOf('icon_') === 0 ? name : 'icon_' + name;
    if (!MANIFEST[key]) return null;
    return makeCanvas(key, size || MANIFEST[key].h, opts);
  }
  /** 立绘 / 背景 / 界面图：等同 makeCanvas，便于阅读 */
  function getPicture(key, targetH, opts) { return makeCanvas(key, targetH, opts); }

  /** 统一绘制：按锚点把画布画到逻辑坐标 (x, y)；sc 为额外倍数（默认 1） */
  function draw(g, c, x, y, sc) {
    if (!c) return false;
    sc = sc || 1;
    g.drawImage(c, x - c.ax * sc, y - c.ay * sc, c.lw * sc, c.lh * sc);
    return true;
  }

  function config(o) { for (var k in o) if (o.hasOwnProperty(k) && CFG.hasOwnProperty(k)) CFG[k] = o[k]; return CFG; }
  function anyTainted() { for (var f in images) if (images[f] && images[f].qxTainted) return true; return false; }
  // 只供测试：清空状态以便重新加载
  function _reset() { images = {}; status = {}; cache = {}; loading = false; loaded = false; waiters = []; lastSummary = null; }

  global.QixiongAssets = {
    manifest: MANIFEST,
    config: config,
    files: fileList,
    load: load,
    isLoaded: function () { return loaded; },
    summary: function () { return lastSummary; },
    status: function (file) { return status[file]; },
    get: get,
    has: function (key) { var v = get(key); return !!v && v.length === undefined; },
    anyTainted: anyTainted,
    makeCanvas: makeCanvas,
    makeSpriteSet: makeSpriteSet,
    makeTile: makeTile,
    getDecos: getDecos,
    getItem: getItem,
    getIcon: getIcon,
    getPicture: getPicture,
    draw: draw,
    _hooks: hooks,
    _reset: _reset
  };
})(window);
