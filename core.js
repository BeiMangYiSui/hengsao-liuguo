/**
 * 《横扫六国》核心引擎 —— 纯 Canvas 2D、零外链、Web Audio 合成音效
 * 兼容 Chrome 61：只用 ES5 写法，不使用可选链与空值合并等新语法
 * 戏说战国，非史实。
 */
(function (global) {
  'use strict';

  // ================= 工具 =================
  var TAU = Math.PI * 2;
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function fmtTime(t) {
    t = Math.max(0, Math.floor(t));
    var m = Math.floor(t / 60), s = t % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function angDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  }
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }
  function wrapLines(g, text, maxW) {
    var lines = [], cur = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i), test = cur + ch;
      if (g.measureText(test).width > maxW && cur) { lines.push(cur); cur = ch; } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
  var FONT_T = '"STKaiti","Kaiti SC","KaiTi","STSong","Songti SC","Noto Serif CJK SC",serif';
  var UI = global.QixiongUI;
  function txt(g, s, x, y, size, color, align, stroke, font, weight) {
    g.font = (weight || 'bold') + ' ' + size + 'px ' + (font || FONT);
    g.textAlign = align || 'left';
    g.textBaseline = 'middle';
    if (stroke) { g.lineWidth = Math.max(2, size / 6); g.strokeStyle = stroke; g.lineJoin = 'round'; g.strokeText(s, x, y); }
    g.fillStyle = color;
    g.fillText(s, x, y);
  }

  // ================= 音效（Web Audio 合成） =================
  var Sound = {
    enabled: true, ctx: null, master: null, noiseBuf: null, last: {}, BOOST: 2.2,
    unlock: function () {
      if (this.ctx) { if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume(); return; }
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain(); this.master.gain.value = 1;
        // 2026-11-21 加背景音乐后音效整体加强（见 BOOST），经压限器连到扬声器，防止大量音效叠加时爆音
        try { var cp = this.ctx.createDynamicsCompressor(); cp.threshold.value = -16; cp.knee.value = 8; cp.ratio.value = 6; cp.attack.value = 0.003; cp.release.value = 0.12; this.master.connect(cp); cp.connect(this.ctx.destination); this.out = cp; }
        catch (e2) { this.master.connect(this.ctx.destination); this.out = this.master; }
        var len = Math.floor(this.ctx.sampleRate * 0.6), buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
      } catch (e) { this.ctx = null; }
      Music.init();
    },
    thr: function (n, ms) { var now = Date.now(); if (this.last[n] && now - this.last[n] < ms) return false; this.last[n] = now; return true; },
    tone: function (f, dur, type, vol, slide, delay) {
      if (!this.enabled || !this.ctx) return;
      try {
        var c = this.ctx, t = c.currentTime + (delay || 0), o = c.createOscillator(), g = c.createGain();
        o.type = type || 'square'; o.frequency.setValueAtTime(f, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
        g.gain.setValueAtTime((vol || 0.15) * this.BOOST, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
      } catch (e) { /* 忽略 */ }
    },
    noise: function (dur, vol, freq, delay) {
      if (!this.enabled || !this.ctx || !this.noiseBuf) return;
      try {
        var c = this.ctx, t = c.currentTime + (delay || 0), s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        s.buffer = this.noiseBuf; f.type = 'bandpass'; f.frequency.value = freq || 1200; f.Q.value = 0.9;
        g.gain.setValueAtTime((vol || 0.15) * this.BOOST, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.02);
      } catch (e) { /* 忽略 */ }
    },
    seq: function (fs, step, type, vol, dur) { for (var i = 0; i < fs.length; i++) this.tone(fs[i], dur || 0.16, type, vol, 0, i * step); },
    play: function (n) {
      if (!this.enabled || !this.ctx) return;
      switch (n) {
        case 'hit': if (this.thr(n, 45)) this.noise(0.08, 0.13, 2000); break;
        case 'die': if (this.thr(n, 70)) { this.noise(0.13, 0.12, 3400); this.tone(520, 0.09, 'triangle', 0.05, 180); } break; // 纸兵倒下：撕纸声
        case 'sweep': if (this.thr(n, 90)) this.noise(0.16, 0.16, 650); break;
        case 'bagua': if (this.thr(n, 120)) this.tone(520, 0.22, 'sine', 0.1, 780); break;
        case 'arrow': if (this.thr(n, 100)) this.tone(900, 0.06, 'triangle', 0.05, 380); break;
        case 'coin': if (this.thr(n, 70)) { this.tone(1320, 0.07, 'square', 0.05); this.tone(1760, 0.1, 'square', 0.04, 0, 0.06); } break;
        case 'exp': if (this.thr(n, 50)) this.tone(900 + Math.random() * 400, 0.04, 'sine', 0.04); break;
        case 'level': this.seq([523, 659, 784, 1047], 0.08, 'square', 0.07); break;
        case 'hurt': if (this.thr(n, 220)) this.tone(190, 0.16, 'sawtooth', 0.12, 90); break;
        case 'bell': if (this.thr(n, 150)) { this.tone(392, 0.7, 'sine', 0.14); this.tone(785, 0.45, 'sine', 0.05); } break;
        case 'ox': if (this.thr(n, 200)) { this.noise(0.35, 0.18, 320); this.tone(110, 0.3, 'sawtooth', 0.08, 70); } break;
        case 'horn': this.tone(146, 0.7, 'sawtooth', 0.12, 120); this.tone(146, 0.8, 'sawtooth', 0.12, 110, 0.45); break;
        case 'page': if (this.thr(n, 90)) this.noise(0.22, 0.16, 420); break;
        case 'ult': this.noise(0.7, 0.28, 480); this.tone(220, 0.7, 'sawtooth', 0.14, 55); break;
        case 'win': this.seq([392, 523, 659, 784, 1047], 0.12, 'square', 0.08, 0.3); break;
        case 'lose': this.seq([392, 330, 262, 196], 0.18, 'triangle', 0.1, 0.3); break;
        case 'click': this.tone(660, 0.05, 'square', 0.05); break;
        case 'evolve': this.seq([262, 330, 392, 523, 659, 784, 1047], 0.07, 'sawtooth', 0.06, 0.25); break;
        case 'buy': this.seq([784, 1175], 0.07, 'square', 0.06, 0.12); break;
        case 'suck': this.tone(180, 0.95, 'sawtooth', 0.07, 640); this.tone(90, 0.95, 'sine', 0.1, 260); break; // 缚身预警：上扬的吸气声
        case 'bind': this.noise(0.3, 0.2, 500); this.tone(140, 0.5, 'square', 0.09, 70); break; // 被捆住：沉闷一锁
      }
    }
  };

  // ================= 背景音乐（Flow Music 生成，base64 内嵌于 audio_data.js，Web Audio 无缝循环） =================
  // 曲目：battle 战斗曲、boss 赵括出场曲。set(曲名, 音量倍数) 由 Game.updateMusic 按状态调用；曲名为 null 时淡出。
  var Music = {
    VOL: 0.12, tracks: {}, want: null, level: 1, cur: null, out: null, started: false,
    init: function () {
      var c = Sound.ctx, D = global.QixiongAudioData, self = this;
      if (!c || !D || this.started) return;
      this.started = true;
      try { this.out = c.createGain(); this.out.gain.value = 1; this.out.connect(c.destination); } catch (e) { this.out = null; return; }
      Object.keys(D).forEach(function (k) {
        try {
          var b64 = D[k].src.split(',')[1], bin = global.atob(b64), n = bin.length, u8 = new Uint8Array(n), i;
          for (i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
          c.decodeAudioData(u8.buffer, function (buf) { self.onDecoded(k, buf, D[k].loop); }, function () { /* 解码失败：该曲静默，不影响游戏 */ });
        } catch (e) { /* 忽略 */ }
      });
    },
    onDecoded: function (k, buf, loopLen) {
      // mp3 解码后首部可能有编码器补的静音：找到第一个有声样本作循环起点，循环长度取生成时记录的精确值
      var d = buf.getChannelData(0), sr = buf.sampleRate, lim = Math.min(d.length, Math.floor(sr * 0.3)), i = 0;
      while (i < lim && Math.abs(d[i]) < 1e-4) i++;
      if (i >= lim) i = 0;
      var ls = i / sr, le = ls + loopLen;
      if (!(le <= buf.duration)) { ls = 0; le = buf.duration; }
      this.tracks[k] = { buf: buf, ls: ls, le: le };
      this.apply();
    },
    ready: function (k) { return !!this.tracks[k]; },
    set: function (name, level) { this.want = name; this.level = level == null ? 1 : level; this.apply(); },
    apply: function () {
      var c = Sound.ctx;
      if (!c || !this.out) return;
      var t = c.currentTime, vol = Sound.enabled ? this.VOL * this.level : 0, cur = this.cur;
      try {
        if (cur && cur.name === this.want) { cur.g.gain.setTargetAtTime(vol, t, 0.12); return; }
        if (cur) { cur.g.gain.cancelScheduledValues(t); cur.g.gain.setTargetAtTime(0, t, 0.18); cur.s.stop(t + 1.2); this.cur = null; }
        var tr = this.want && this.tracks[this.want];
        if (!tr) return; // 未解码完成：解码回调里会再 apply
        var s = c.createBufferSource(), g = c.createGain();
        s.buffer = tr.buf; s.loop = true; s.loopStart = tr.ls; s.loopEnd = tr.le;
        g.gain.setValueAtTime(0, t); g.gain.setTargetAtTime(vol, t, 0.15);
        s.connect(g); g.connect(this.out); s.start(t, tr.ls);
        this.cur = { name: this.want, s: s, g: g };
      } catch (e) { /* 忽略 */ }
    },
    // 切后台挂起整个音频上下文（音效与音乐都停），回前台恢复
    sleep: function () { var c = Sound.ctx; if (c && c.state === 'running' && c.suspend) c.suspend(); },
    wake: function () { var c = Sound.ctx; if (c && c.state === 'suspended' && c.resume) c.resume(); }
  };

  // ================= 像素精灵（代码绘制） =================
  var OUT = '#1b1410';
  function makeSprite(rows, pal, s, outline) {
    var h = rows.length, w = 0, x, y, ch;
    for (y = 0; y < h; y++) if (rows[y].length > w) w = rows[y].length;
    var pad = outline ? 1 : 0, c = document.createElement('canvas');
    c.width = (w + pad * 2) * s; c.height = (h + pad * 2) * s;
    var g = c.getContext('2d');
    if (outline) {
      g.fillStyle = outline;
      for (y = 0; y < h; y++) for (x = 0; x < rows[y].length; x++) if (rows[y].charAt(x) !== '.') g.fillRect(x * s, y * s, s * 3, s * 3);
    }
    for (y = 0; y < h; y++) for (x = 0; x < rows[y].length; x++) {
      ch = rows[y].charAt(x);
      if (ch === '.') continue;
      g.fillStyle = pal[ch] || '#ff00ff';
      g.fillRect((x + pad) * s, (y + pad) * s, s, s);
    }
    return c;
  }
  function flipSprite(src) {
    var c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    var g = c.getContext('2d'); g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0); return c;
  }
  function tintSprite(src, color) {
    var c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    var g = c.getContext('2d'); g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height); return c;
  }
  function spriteSet(rows, pal, s) {
    var l = makeSprite(rows, pal, s, OUT), r = flipSprite(l);
    return { l: l, r: r, wl: tintSprite(l, '#ffffff'), wr: tintSprite(r, '#ffffff'), il: tintSprite(l, '#8fd3ff'), ir: tintSprite(r, '#8fd3ff'), w: l.width, h: l.height };
  }

  // 白起：黑甲、方脸、浓眉、短须、高个
  var SPR_BAIQI = [
    '.....RR.....',
    '....RRR.....',
    '...KKKKKK...',
    '..KAAAAAAK..',
    '..KKKKKKKK..',
    '..HHHSSHHH..',
    '..SDDSSDDS..',
    '..SSSSSSSS..',
    '..SSSssSSS..',
    '..HSSSSSSH..',
    '..HHHHHHHH..',
    '...HHHHHH...',
    '.KYKKKKKKYK.',
    'KAKKAAAAKKAK',
    'KAKKKYYKKKAK',
    'SKKKKAAKKKKS',
    '.SKKYYYYKKS.',
    '..KRRRRRRK..',
    '..KRRKKRRK..',
    '..KK....KK..',
    '..AK....KA..',
    '..KK....KK..',
    '.KKK....KKK.'
  ];
  var PAL_BAIQI = { K: '#25262e', A: '#5d6578', R: '#c0392b', H: '#140f0b', S: '#e3b68c', s: '#bf8a5e', D: '#0b0b0b', Y: '#d9a521' };
  // 孙膑：青袍、木轮车、清瘦、长须
  var SPR_SUNBIN = [
    '.....HH.....',
    '....HHHH....',
    '....JJJJ....',
    '...HHHHHH...',
    '...HSSSSH...',
    '...SDSSDS...',
    '...SSSSSS...',
    '...SSssSS...',
    '...GSSSSG...',
    '...GGGGGG...',
    '..CCGGGGCC..',
    '.CCCGGGGCCC.',
    '.CCCCGGCCCC.',
    '.SCCCGGCCCS.',
    '.CCCCGGCCCC.',
    '.CcCCCGCCcC.',
    'WWWWWWWWWWWW',
    'W.W......W.W'
  ];
  var PAL_SUNBIN = { H: '#2a2420', J: '#7fd1c7', S: '#e8c09a', s: '#c99a70', D: '#111111', G: '#6b6f78', C: '#2f8f83', c: '#1f6b62', W: '#8a5a2b' };
  var SPR_PAPER = [
    '..PPPP..',
    '.PIPPIP.',
    '.PPPPPP.',
    '..PQQP..',
    '.PPPPPP.',
    'PPPIIPPP',
    '.PPPPPP.',
    '..PQQP..',
    '..P..P..',
    '.QP..PQ.'
  ];
  var SPR_SHIELD = [
    '...PPPP...',
    '..PIPPIP..',
    '..PPPPPP..',
    '...PQQP...',
    'BbBbBPPPP.',
    'BbBbBPPPPP',
    'BbBbBIIPP.',
    'BbBbBPPP..',
    'BbBbB.PP..',
    '...P..P...',
    '..QP..PQ..'
  ];
  var SPR_KITE = [
    '....R....',
    '...RPR...',
    '..RPPPR..',
    '.RPIPIPR.',
    'RPPPPPPPR',
    '.RPPIPPR.',
    '..RPPPR..',
    '...RPR...',
    '....R....',
    '....I....',
    '...P.....',
    '....P....'
  ];
  var SPR_ELITE = [
    '...RRRR...',
    '..PPPPPP..',
    '.PPIPPIPP.',
    '.PPPPPPPP.',
    '..PPIIPP..',
    '.RPPPPPPR.',
    'PPRPPPPPPP',
    'PPPRPPPPPP',
    '.PPPRPPPP.',
    '..PPPRPP..',
    '..PP..PP..',
    '.QPP..PPQ.'
  ];
  var PAL_PAPER = { P: '#f4ecd6', Q: '#d6cbaa', I: '#2b2b2b', B: '#cdb85a', b: '#8f7d2e', R: '#c0392b' };
  // 赵括：骑竹简、手捧兵书、年轻得意
  var SPR_BOSS = [
    '......KKKK......',
    '.....KKYYKK.....',
    '......KKKK......',
    '.....HHHHHH.....',
    '....HSSSSSSH....',
    '....SSDSSDSS....',
    '....SSSSSSSS....',
    '....SSHSSHSS....',
    '.....SSMMSS.....',
    '......SSSS......',
    '...RRRRRRRRRR...',
    '..RRYRRRRRRYRR..',
    '..RRRRRRRRRRRR..',
    '.SRRRPPPPPRRRRS.',
    '..RRRPIIIPRRRR..',
    '..RRRPPPPPRRRR..',
    '...RRRRRRRRRR...',
    'BBBBBBBBBBBBBBBB',
    'BbBbBbBbBbBbBbBb',
    '.KK..........KK.'
  ];
  var PAL_BOSS = { K: '#1d1d24', Y: '#e0b040', H: '#1a1410', S: '#edc49b', D: '#111111', M: '#b5523b', R: '#9b2d2d', P: '#f4ecd6', I: '#2b2b2b', B: '#cdb85a', b: '#8f7d2e' };
  // 吕不韦：富态商人、紫袍
  var SPR_LV = [
    '...KKKK...',
    '..KKYYKK..',
    '..SSSSSS..',
    '.SSDSSDSS.',
    '.SSSSSSSS.',
    '.SSHHHHSS.',
    '..SSSSSS..',
    '.UUUUUUUU.',
    'UUUYUUYUUU',
    'UUUUUUUUUU',
    'SUUUYYUUUS',
    '.UUUUUUUU.',
    '.UU....UU.'
  ];
  var PAL_LV = { K: '#1d1d24', Y: '#e0b040', S: '#eec7a0', D: '#111', H: '#3a2a20', U: '#6b3fa0' };
  var SPR_OX = [
    '.Y...........FF',
    'YYOO........FFF',
    '.OOOOOOOOOOOOF.',
    'OEOOOOOOOOOOOO.',
    'OOOOOOOOOOOOOO.',
    '.OOOOOOOOOOOO..',
    '..OO..OO..OO...',
    '..OO..OO..OO...'
  ];
  var PAL_OX = { Y: '#f1c40f', O: '#7a4a26', E: '#111', F: '#ff7b1c' };

  function buildSprites() {
    return {
      baiqi: spriteSet(SPR_BAIQI, PAL_BAIQI, 2),
      sunbin: spriteSet(SPR_SUNBIN, PAL_SUNBIN, 2),
      paper: spriteSet(SPR_PAPER, PAL_PAPER, 2),
      shield: spriteSet(SPR_SHIELD, PAL_PAPER, 2),
      kite: spriteSet(SPR_KITE, PAL_PAPER, 2),
      elite: spriteSet(SPR_ELITE, PAL_PAPER, 3),
      boss: spriteSet(SPR_BOSS, PAL_BOSS, 3),
      lv: spriteSet(SPR_LV, PAL_LV, 2),
      ox: spriteSet(SPR_OX, PAL_OX, 2),
      oxBig: spriteSet(SPR_OX, PAL_OX, 3),
      bagua: makeBagua(64),
      tile: makeGroundTile(),
      deco: makeDecos()
    };
  }
  function makeBagua(R) {
    var c = document.createElement('canvas'); c.width = c.height = R * 2 + 8;
    var g = c.getContext('2d'), cx = R + 4, cy = R + 4, k, j;
    g.strokeStyle = '#6ff3e0'; g.lineWidth = 3; g.fillStyle = 'rgba(80,230,210,0.16)';
    g.beginPath();
    for (k = 0; k < 8; k++) { var a = k * TAU / 8 + Math.PI / 8; var px = cx + Math.cos(a) * R, py = cy + Math.sin(a) * R; if (k === 0) g.moveTo(px, py); else g.lineTo(px, py); }
    g.closePath(); g.fill(); g.stroke();
    var tri = [7, 6, 5, 4, 3, 2, 1, 0];
    g.lineWidth = 3;
    for (k = 0; k < 8; k++) {
      var ang = k * TAU / 8;
      for (j = 0; j < 3; j++) {
        var rad = R * (0.62 + j * 0.1), half = R * 0.22 * (1 + j * 0.12);
        var mx = cx + Math.cos(ang) * rad, my = cy + Math.sin(ang) * rad, tx = -Math.sin(ang), ty = Math.cos(ang);
        var solid = (tri[k] >> j) & 1;
        g.beginPath();
        if (solid) { g.moveTo(mx - tx * half, my - ty * half); g.lineTo(mx + tx * half, my + ty * half); }
        else {
          g.moveTo(mx - tx * half, my - ty * half); g.lineTo(mx - tx * half * 0.25, my - ty * half * 0.25);
          g.moveTo(mx + tx * half * 0.25, my + ty * half * 0.25); g.lineTo(mx + tx * half, my + ty * half);
        }
        g.stroke();
      }
    }
    var yr = R * 0.32;
    g.fillStyle = '#e9fffb'; g.beginPath(); g.arc(cx, cy, yr, -Math.PI / 2, Math.PI / 2); g.fill();
    g.fillStyle = '#145c55'; g.beginPath(); g.arc(cx, cy, yr, Math.PI / 2, Math.PI * 1.5); g.fill();
    g.fillStyle = '#e9fffb'; g.beginPath(); g.arc(cx, cy - yr / 2, yr / 2, 0, TAU); g.fill();
    g.fillStyle = '#145c55'; g.beginPath(); g.arc(cx, cy + yr / 2, yr / 2, 0, TAU); g.fill();
    return c;
  }
  function makeGroundTile() {
    var S = 192, c = document.createElement('canvas'); c.width = c.height = S;
    var g = c.getContext('2d'), i;
    g.fillStyle = '#ad8b5b'; g.fillRect(0, 0, S, S);
    var cols = ['#a4824f', '#b6966a', '#9e7c4b', '#b39262'];
    for (i = 0; i < 520; i++) { g.fillStyle = pick(cols); g.fillRect(Math.floor(Math.random() * 64) * 3, Math.floor(Math.random() * 64) * 3, 3, 3); }
    for (i = 0; i < 7; i++) {
      var x = Math.floor(Math.random() * 60) * 3, y = Math.floor(Math.random() * 60) * 3;
      g.fillStyle = '#7f8a3c'; g.fillRect(x, y, 3, 6); g.fillRect(x + 3, y - 3, 3, 9); g.fillRect(x + 6, y + 0, 3, 6);
      g.fillStyle = '#66712c'; g.fillRect(x + 3, y + 6, 3, 3);
    }
    for (i = 0; i < 5; i++) { g.fillStyle = '#8c7048'; g.fillRect(Math.floor(Math.random() * 62) * 3, Math.floor(Math.random() * 62) * 3, 6, 3); }
    return c;
  }
  function makeDecos() {
    var list = [], c, g;
    // 0 石块
    c = document.createElement('canvas'); c.width = 30; c.height = 20; g = c.getContext('2d');
    g.fillStyle = '#6e6458'; g.fillRect(3, 6, 24, 12); g.fillStyle = '#8a8070'; g.fillRect(6, 3, 15, 9); g.fillStyle = '#a49a88'; g.fillRect(9, 3, 6, 3); list.push(c);
    // 1 残旗
    c = document.createElement('canvas'); c.width = 30; c.height = 54; g = c.getContext('2d');
    g.fillStyle = '#5a3a1e'; g.fillRect(4, 2, 3, 52); g.fillStyle = '#b83a2a'; g.fillRect(7, 4, 18, 14); g.fillRect(7, 18, 12, 6); g.fillStyle = '#e0b040'; g.fillRect(12, 8, 6, 6); list.push(c);
    // 2 散落竹简
    c = document.createElement('canvas'); c.width = 36; c.height = 18; g = c.getContext('2d');
    g.fillStyle = '#c8b260'; for (var i = 0; i < 6; i++) g.fillRect(2 + i * 5, 3 + (i % 2) * 2, 3, 12);
    g.fillStyle = '#6a5a24'; g.fillRect(0, 6, 34, 2); list.push(c);
    // 3 拒马木桩
    c = document.createElement('canvas'); c.width = 40; c.height = 26; g = c.getContext('2d');
    g.fillStyle = '#6b4423'; g.fillRect(0, 14, 40, 4);
    g.save(); g.translate(10, 16); g.rotate(-0.6); g.fillRect(-2, -14, 4, 20); g.restore();
    g.save(); g.translate(30, 16); g.rotate(0.6); g.fillRect(-2, -14, 4, 20); g.restore(); list.push(c);
    // 4 草丛
    c = document.createElement('canvas'); c.width = 30; c.height = 18; g = c.getContext('2d');
    g.fillStyle = '#6f7a30'; g.fillRect(3, 6, 3, 12); g.fillRect(9, 0, 3, 18); g.fillRect(15, 3, 3, 15); g.fillRect(21, 6, 3, 12);
    g.fillStyle = '#8f9a44'; g.fillRect(6, 9, 3, 9); g.fillRect(18, 9, 3, 9); list.push(c);
    return list;
  }

  // ================= 数据 =================
  var ST = { MENU: 0, SELECT: 1, PLAY: 2, LEVELUP: 3, SHOP: 4, RESULT: 5, PAUSE: 6 };
  var MAX_E = 340, MAX_SHOT = 220, MAX_ESHOT = 90, MAX_GEM = 120, MAX_ITEM = 160, MAX_DROP = MAX_GEM + MAX_ITEM, GEM_MERGE_R = 40, PICK_R = 72, MAX_PART = 420, MAX_NUM = 48, MAX_FX = 90, MAX_OX = 40;
  var SHOP_TIME = 50, BOSS_TIME = 90, BOSS_HP_BASE = 3600, BOSS_HP_LV = 100;
  var GRID_CELL = 64, GRID_N = 40;
  var MAX_SKILLS = 2, MAX_LV = 3, WEAPON_MAX = 5, POWER_STEP = 0.08, AUTO_LEVELS = [2, 5]; // 2026-11-19 第三次试玩：不弹窗，第 2 / 5 级自动获得武将固定技能 // 2026-11-19 第二次试玩：一局只选 3 次，技能拿到即满（内部 3 级 = 原 5 级效果）
  var EFF = [0, 1, 3, 5]; // 3 级制：每级对应原 5 级制的效果档位（1→1、2→3、3→5）

  var HEROES = [
    { id: 'baiqi', name: '白起', title: '秦 · 武安君', weapon: 'halberd', hp: 160, speed: 150,
      l1: '长戟横扫：近身扇形横扫', l2: '杀意：杀敌越多，攻击越高', l3: '大招·杀神降世：三连旋风斩', ult: '杀神降世', auto: ['swordring', 'fireox'], l4: '自动获得：剑环 → 火牛' },
    { id: 'sunbin', name: '孙膑', title: '齐 · 军师', weapon: 'crossbow', hp: 120, speed: 116, // 2026-11-21 用户：开局用弩箭，八卦阵改为第 2 级自动获得
      l1: '弩箭：自动连射最近的敌人', l2: '运筹：冷却 -20%，但移动较慢', l3: '大招·天罗八阵：全屏布阵定身', ult: '天罗八阵', auto: ['bagua', 'fireox'], grow: ['bagua'], l4: '自动获得：八卦阵 → 火牛' } // grow：拿到时 1 级，之后与主武器轮流随升级成长
  ];
  var SKILLS = {
    halberd: { name: '长戟横扫', short: '长戟', ch: '戟', color: '#5d6578', tip: '自动横扫身前的敌人', desc: ['扇形横扫身前敌军', '横扫范围变大', '出手更快', '横扫范围再扩大', '回马戟：前后同时横扫'] },
    bagua: { name: '八卦阵', short: '八卦', ch: '卦', color: '#2f8f83', tip: '自动在敌群中布阵连击', full: '在敌群中同时布 3 座八卦阵，连击三次', desc: ['在敌群中布阵，连击三次', '阵数 +1', '阵更大、更痛', '阵数 +1，出手更快', '阵更大，伤害大幅提升'] },
    crossbow: { name: '秦弩齐射', short: '弩箭', ch: '弩', color: '#8a5a2b', tip: '自动射击最近的敌人', full: '自动射最近的敌人，一次 6 支弩箭，能穿透', desc: ['自动射最近的敌人，一次 2 支弩箭', '弩箭 +1，出手更快', '弩箭 +1，能穿透 1 个敌人', '弩箭 +1，连射更快', '弩箭 +1，穿透 2 个，伤害提升'] },
    swordring: { name: '青铜剑气环', short: '剑环', ch: '剑', color: '#3c8f6a', tip: '飞剑绕身转圈，碰到就伤', full: '6 柄飞剑绕身转圈，碰到敌人就伤' },
    fireox: { name: '火牛冲阵', short: '火牛', ch: '牛', color: '#d35400', tip: '火牛朝敌人冲锋，一路撞穿', full: '3 头火牛朝敌人冲锋撞穿（买田单兵符可进化）' },
    bell: { name: '编钟震波', ch: '钟', color: '#b8860b', desc: ['敲响编钟，震波击退四周', '震波范围扩大', '伤害提升，冷却缩短', '震波范围扩大', '双响：连震两次'] },
    bird: { name: '墨家机关鸟', ch: '鸟', color: '#795548', desc: ['1 只机关鸟自动啄击敌人', '机关鸟 +1', '机关鸟 +1，伤害提升', '机关鸟 +1', '机关鸟 +2，飞得更快'] },
    allies: { name: '合纵援军', short: '援军', ch: '援', color: '#8e44ad', tip: '六国小兵跟着你一起砍', full: '6 名六国小兵跟着你一起砍' },
    cavalry: { name: '胡服骑射', short: '骑射', ch: '骑', color: '#16a085', tip: '跑得更快，并向四周放箭', full: '移速 +35%，同时向四周连射 5 箭' },
    reform: { name: '商鞅变法', ch: '法', color: '#c0392b', desc: ['军功（经验）+12%，攻击 +6%', '经验 +12%，攻击 +6%', '经验 +12%，攻击 +6%', '经验 +12%，攻击 +6%', '经验 +12%，攻击 +6%'] }
  };
  var SKILL_ORDER = ['crossbow', 'swordring', 'fireox', 'cavalry', 'allies']; // 2026-11-19 试玩后精简：去掉商鞅变法、编钟震波、墨家机关鸟
  var BIRD_COUNT = [0, 1, 2, 3, 4, 6];
  var NATION = [['齐', '#2e86de'], ['楚', '#8e44ad'], ['燕', '#16a085'], ['韩', '#e67e22'], ['赵', '#c0392b'], ['魏', '#f1c40f']];
  var ETYPES = [
    { name: '纸甲兵', hp: 6, speed: 54, r: 8, dps: 8, exp: 1, coin: 0.05, spr: 'paper', kb: 1 },
    { name: '竹简盾兵', hp: 30, speed: 36, r: 11, dps: 14, exp: 3, coin: 0.15, spr: 'shield', kb: 0.35 },
    { name: '纸鸢弓手', hp: 10, speed: 60, r: 9, dps: 6, exp: 2, coin: 0.1, spr: 'kite', kb: 0.8 },
    { name: '纸将军', hp: 220, speed: 44, r: 16, dps: 20, exp: 25, coin: 1, spr: 'elite', kb: 0.2 },
    { name: '赵括', hp: 5000, speed: 52, r: 26, dps: 30, exp: 0, coin: 0, spr: 'boss', kb: 0.04 }
  ];
  var RANKS = ['公士', '上造', '簪袅', '不更', '大夫', '官大夫', '公大夫', '公乘', '五大夫', '左庶长', '右庶长', '左更', '中更', '右更', '少上造', '大上造', '驷车庶长', '大庶长', '关内侯', '彻侯'];
  var RANK_NEED = [];
  (function () { for (var i = 0; i < 20; i++) RANK_NEED.push(Math.round(30 * Math.pow(i + 1, 1.7)) * 10); })();
  function rankOf(merit) { var idx = -1; for (var i = 0; i < 20; i++) if (merit >= RANK_NEED[i]) idx = i; return idx; }
  function rankName(idx) { return idx < 0 ? '士卒（未授爵）' : RANKS[idx]; }
  // 2026-11-21 Boss 新招「兵书缚身」：预警 → 吸附 → 定身（用户：离 Boss 太近会被吸住控制几秒，躲不开）
  var PULL_R = 230, BIND_R = 72, PULL_WIND = 1.0, PULL_DUR = 1.3, BIND_DUR = 1.8, PULL_SPEED = 300, BIND_DPS = 10;
  var BOSS_LINES = ['兵书在手，天下我有！', '书上说：以多胜少！', '此阵第三卷有载，必胜！', '看我翻页变兵！'];
  var BOSS_LINES_LOW = ['咦？这招书上没写……', '快翻页！快翻页！', '兵书……兵书被撕了！'];

  var SAVE_KEY = 'qixiong_survivors_v1';
  function loadSave() {
    var d = { merit: 0, runs: 0, wins: 0, best: 0 };
    try { var s = global.localStorage.getItem(SAVE_KEY); if (s) { var o = JSON.parse(s); for (var k in d) if (typeof o[k] === 'number') d[k] = o[k]; } } catch (e) { /* 无存储 */ }
    return d;
  }
  function writeSave(d) { try { global.localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch (e) { /* 无存储 */ } }

  // ================= 游戏 =================
  function Game(canvas, opts) {
    var self = this;
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.opts = opts || {};
    this.W = 375; this.H = 812; this.dpr = 1;
    this.state = ST.MENU; this.time = 0; this.buttons = [];
    this.sprites = buildSprites();
    this.artReady = !global.QixiongAssets; this.artLoad = 0;
    if (global.QixiongAssets) {
      if (global.QixiongAssetsData) global.QixiongAssets.config({ useFiles: false }); // 发布包只有数据文件，不再去 img/ 找，免得控制台报缺文件
      global.QixiongAssets.load(function (done, total) { self.artLoad = total ? done / total : 1; },
        function () { try { self.applyArt(); } catch (e) { /* 出错就保留代码小人 */ } self.artReady = true; });
    }
    this.selHero = 0; this.heroIdx = 0;
    this.save = loadSave();
    this.quality = 2; this.maxEnemies = 300;
    this.fps = 60; this.fpsFrames = 0; this.fpsAcc = 0; this.lowSec = 0; this.vlowSec = 0; this.fpsLog = [];
    this.keys = {}; this.joy = { active: false, id: null, bx: 0, by: 0, x: 0, y: 0 };
    this.lastTap = { t: -1, x: 0, y: 0 };
    this.debug = { god: false, showFps: /debug=1/.test(String(global.location && global.location.search)) };
    this.cardCanvas = null; this.lastResult = null;
    this.initPools();
    this.bindInput();
    this.resize();
    global.addEventListener('resize', function () { self.resize(); });
    this.lastFrame = 0;
    function loop(ts) { self.frame(ts); global.requestAnimationFrame(loop); }
    global.requestAnimationFrame(loop);
  }
  var P = Game.prototype;

  P.initPools = function () {
    var i;
    this.enemies = []; for (i = 0; i < MAX_E; i++) this.enemies.push({ active: false, idx: i });
    this.shots = []; for (i = 0; i < MAX_SHOT; i++) this.shots.push({ active: false, hits: [] });
    this.eshots = []; for (i = 0; i < MAX_ESHOT; i++) this.eshots.push({ active: false });
    this.drops = []; for (i = 0; i < MAX_DROP; i++) this.drops.push({ active: false });
    this.parts = []; for (i = 0; i < MAX_PART; i++) this.parts.push({ active: false });
    this.nums = []; for (i = 0; i < MAX_NUM; i++) this.nums.push({ active: false });
    this.fx = []; for (i = 0; i < MAX_FX; i++) this.fx.push({ active: false });
    this.oxen = []; for (i = 0; i < MAX_OX; i++) this.oxen.push({ active: false, hits: [] });
    this.gridHead = new Int16Array(GRID_N * GRID_N); this.gridNext = new Int16Array(MAX_E);
    this.qres = new Int16Array(MAX_E); this.qn = 0; this.gox = 0; this.goy = 0;
    this.pages = []; this.birds = []; this.allies = [];
  };
  function freeSlot(pool) { for (var i = 0; i < pool.length; i++) if (!pool[i].active) return pool[i]; return null; }

  P.resize = function () {
    var parent = this.canvas.parentNode, w = parent ? parent.clientWidth : global.innerWidth, h = parent ? parent.clientHeight : global.innerHeight;
    this.W = Math.max(300, w || 375); this.H = Math.max(480, h || 812);
    this.dpr = Math.min(global.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(this.W * this.dpr); this.canvas.height = Math.floor(this.H * this.dpr);
    this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
    UI.setDpr(this.dpr);
  };
  P.setState = function (s) {
    this.state = s; this.joy.active = false; this.joy.id = null;
    this.updateMusic();
    if (this.opts.onStateChange) this.opts.onStateChange(s, this);
  };
  // 背景音乐跟随状态：战斗放战斗曲、赵括在场放 Boss 曲；升级/货栈压低，暂停静音；胜负结算、菜单、选将不放
  P.updateMusic = function () {
    var s = this.state, name = null, lv = 1;
    if ((s === ST.PLAY || s === ST.LEVELUP || s === ST.SHOP || s === ST.PAUSE) && !this.ending) {
      name = this.boss ? 'boss' : 'battle';
      if (s === ST.PAUSE) lv = 0; else if (s !== ST.PLAY) lv = 0.6;
    }
    Music.set(name, lv);
  };

  // ---------- 输入 ----------
  P.bindInput = function () {
    var self = this, cv = this.canvas;
    function pos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    cv.addEventListener('touchstart', function (e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i], p = pos(t); self.onDown(p.x, p.y, t.identifier); }
    }, { passive: false });
    cv.addEventListener('touchmove', function (e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i], p = pos(t); self.onMove(p.x, p.y, t.identifier); }
    }, { passive: false });
    function tend(e) { e.preventDefault(); for (var i = 0; i < e.changedTouches.length; i++) self.onUp(e.changedTouches[i].identifier); }
    cv.addEventListener('touchend', tend, { passive: false });
    cv.addEventListener('touchcancel', tend, { passive: false });
    var mdown = false;
    cv.addEventListener('mousedown', function (e) { mdown = true; var p = pos(e); self.onDown(p.x, p.y, 'm'); });
    global.addEventListener('mousemove', function (e) { if (mdown) { var p = pos(e); self.onMove(p.x, p.y, 'm'); } });
    global.addEventListener('mouseup', function () { if (mdown) { mdown = false; self.onUp('m'); } });
    global.addEventListener('keydown', function (e) {
      var k = e.key; self.keys[k.length === 1 ? k.toLowerCase() : k] = true;
      Sound.unlock();
      if (self.state === ST.PLAY && (k === ' ' || k === 'Spacebar')) { self.tryUlt(); e.preventDefault(); }
      if (self.state === ST.LEVELUP && (k === '1' || k === '2' || k === '3')) self.chooseSkill(parseInt(k, 10) - 1);
      if ((self.state === ST.MENU || self.state === ST.SELECT) && k === 'Enter') { if (self.state === ST.MENU) self.setState(ST.SELECT); else self.startRun(self.selHero); }
      if (self.state === ST.SHOP && k === 'Escape') self.closeShop();
      else if ((self.state === ST.PLAY || self.state === ST.PAUSE) && (k === 'Escape' || k === 'p' || k === 'P')) self.togglePause();
    });
    var doc = global.document;
    if (doc && doc.addEventListener) {
      doc.addEventListener('visibilitychange', function () { if (doc.hidden) { self.onBackground(); Music.sleep(); } else { self.lastFrame = 0; Music.wake(); } });
    }
    global.addEventListener('pagehide', function () { self.onBackground(); });
    global.addEventListener('keyup', function (e) { var k = e.key; self.keys[k.length === 1 ? k.toLowerCase() : k] = false; });
  };
  P.onDown = function (x, y, id) {
    Sound.unlock();
    if (this.state === ST.PLAY) {
      var now = this.time;
      if (now - this.lastTap.t < 0.32 && Math.abs(x - this.lastTap.x) < 60 && Math.abs(y - this.lastTap.y) < 60) { this.tryUlt(); this.lastTap.t = -1; }
      else { this.lastTap.t = now; this.lastTap.x = x; this.lastTap.y = y; }
      if (!this.joy.active) { this.joy.active = true; this.joy.id = id; this.joy.bx = x; this.joy.by = y; this.joy.x = x; this.joy.y = y; }
      return;
    }
    for (var i = this.buttons.length - 1; i >= 0; i--) {
      var b = this.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { Sound.play('click'); b.fn(); return; }
    }
  };
  P.onMove = function (x, y, id) { if (this.joy.active && this.joy.id === id) { this.joy.x = x; this.joy.y = y; } };
  P.onUp = function (id) { if (this.joy.id === id) { this.joy.active = false; this.joy.id = null; } };

  // ---------- 局开始 ----------
  P.startRun = function (hi) {
    var h = HEROES[hi], i;
    this.heroIdx = hi; this.hero = h;
    this.player = { x: 0, y: 0, hp: h.hp, maxHp: h.hp, face: 1, ang: 0, moving: false, hurtT: 0, walkT: 0, swingT: 0 };
    this.gameTime = 0; this.kills = 0; this.coins = 0; this.exp = 0; this.level = 1; this.expNeed = this.needFor(1); this.pendingLevels = 0;
    this.rage = 0; this.rageMax = 120;
    this.skills = {}; this.skillList = []; this.timers = {};
    this.hasTally = false; this.evolved = false;
    var pools = [this.enemies, this.shots, this.eshots, this.drops, this.parts, this.nums, this.fx, this.oxen];
    for (var k = 0; k < pools.length; k++) for (i = 0; i < pools[k].length; i++) pools[k][i].active = false;
    this.pages = []; this.birds = []; this.allies = [];
    this.activeE = 0; this.boss = null; this.bossAI = null; this.bossSpawned = false; this.bindT = 0; this.pulled = false; this.shop = null; this.shopSpawned = false;
    this.events = [
      { t: 18, type: 'swarm' }, { t: 32, type: 'kites' }, { t: 34, type: 'elite' }, { t: 62, type: 'wall' },
      { t: 70, type: 'swarm' }, { t: 72, type: 'elite' }, { t: 75, type: 'warn' }
    ];
    for (i = 0; i < this.events.length; i++) this.events[i].done = false;
    this.spawnAcc = 0; this.groupAng = rand(0, TAU); this.groupT = 0;
    this.banners = []; this.shake = 0; this.flash = 0; this.timeScale = 1; this.ending = null;
    this.moved = false; this.magnetT = 0; this.swordAng = 0; this.cavAng = 0; this.stampedeT = 3;
    this.choices = []; this.shopOffers = []; this.shopMsg = ''; this.powerUps = 0; this.picks = 0;
    this.gemDropped = 0; this.gemCollected = 0; this.lastTap.t = -1;
    this.addSkill(h.weapon);
    this.setState(ST.PLAY);
    this.banner('长平 · 纸上谈兵', '撑过 1 分半，赵括亲自来战！', 2.8, '#f6d77a');
  };
  P.needFor = function (lv) { return Math.round(10 + lv * 8 + lv * lv * 1.5); }; // 第 2/4/6 级弹窗选技能，其余等级自动强化
  P.addSkill = function (id) {
    var base = this.isGrow(id); // 主武器与成长技能：1~5 级逐级强化；其他技能拿到即满
    if (!this.skills[id]) {
      this.skills[id] = base ? 1 : MAX_LV; this.skillList.push(id); this.timers[id] = 0.3; // 新技能拿到即满效果
      if (id !== this.weaponId()) this.banner('获得 · ' + SKILLS[id].name, base ? SKILLS[id].desc[0] : SKILLS[id].tip, 2.6, '#bfe9ff');
    } else if (base && this.skills[id] < WEAPON_MAX) this.skills[id]++;
    this.checkEvolve();
  };
  P.weaponId = function () { return this.hero.weapon; };
  // 效果档位（1~5）：主武器直接用等级，技能按 3 级制映射（拿到即满 = 5 档）
  P.isGrow = function (id) { var gr = this.hero.grow; return id === this.weaponId() || !!(gr && gr.indexOf(id) >= 0); };
  P.skLv = function (id) { var v = this.skills[id] || 0; return this.isGrow(id) ? v : EFF[v]; };
  // 自动强化目标：主武器与已拿到的成长技能中等级最低、未满的那个（同级先主武器）
  P.growTarget = function () {
    var ids = [this.weaponId()].concat(this.hero.grow || []), best = null, i, id;
    for (i = 0; i < ids.length; i++) { id = ids[i]; if (this.skills[id] && this.skills[id] < WEAPON_MAX && (!best || this.skills[id] < this.skills[best])) best = id; }
    return best;
  };
  P.canPickNew = function () { return this.skillList.length - 1 < MAX_SKILLS && this.newPool().length > 0; };
  P.newPool = function () { var out = []; for (var i = 0; i < SKILL_ORDER.length; i++) if (!this.skills[SKILL_ORDER[i]]) out.push(SKILL_ORDER[i]); return out; };
  // 选满 3 个技能后，升级不弹窗：先强化主武器，强化到顶后每级攻击 +8%
  P.autoPower = function (only) {
    var w = only || this.growTarget() || this.weaponId(), sk = SKILLS[w];
    if (this.skills[w] < WEAPON_MAX) { this.skills[w]++; this.banner(sk.short + '强化', sk.desc[this.skills[w] - 1], 1.4, '#ffe08a'); }
    else { this.powerUps++; this.banner('军功加身', '攻击 +' + Math.round(POWER_STEP * 100) + '%', 1.2, '#ffe08a'); }
    Sound.play('level');
  };
  P.checkEvolve = function () {
    if (!this.evolved && this.hasTally && this.skills.fireox) {
      this.evolved = true; this.stampedeT = 1.2;
      this.banner('进化 · 即墨火牛阵', '火牛冲阵 + 田单兵符：千牛奔腾！', 3, '#ff9a3c');
      Sound.play('evolve'); this.flash = 0.6;
    }
  };
  P.dmgMul = function () {
    var m = (1 + EFF[this.skills.reform || 0] * 0.06) * (1 + this.powerUps * POWER_STEP);
    if (this.hero.id === 'baiqi') m *= 1 + this.killBonus();
    return m;
  };
  P.killBonus = function () { return Math.min(1.5, this.kills * 0.004); };
  P.cdMul = function () { return this.hero.id === 'sunbin' ? 0.8 : 1; };
  P.speed = function () { return this.hero.speed * (1 + EFF[this.skills.cavalry || 0] * 0.07); };
  P.banner = function (text, sub, dur, color) { this.banners.push({ text: text, sub: sub || '', t: 0, dur: dur || 2.5, color: color || '#fff' }); if (this.banners.length > 3) this.banners.shift(); };

  // ---------- 主循环 ----------
  P.frame = function (ts) {
    if (!this.lastFrame) this.lastFrame = ts;
    var rdt = (ts - this.lastFrame) / 1000; this.lastFrame = ts;
    if (rdt > 0.25) rdt = 0.25; if (rdt < 0) rdt = 0;
    this.time += rdt;
    this.trackFps(rdt);
    if (this.state === ST.PLAY) this.update(rdt);
    this.render();
  };
  P.trackFps = function (rdt) {
    this.fpsFrames++; this.fpsAcc += rdt;
    if (this.fpsAcc >= 1) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc); this.fpsFrames = 0; this.fpsAcc = 0;
      if (this.state === ST.PLAY) {
        this.fpsLog.push(this.fps); if (this.fpsLog.length > 600) this.fpsLog.shift();
        if (this.fps < 42) this.lowSec++; else this.lowSec = 0;
        if (this.fps < 30) this.vlowSec++; else this.vlowSec = 0;
        if (this.lowSec >= 2 && this.quality > 1) { this.quality = 1; this.lowSec = 0; }
        if (this.vlowSec >= 3 && this.maxEnemies > 180) { this.maxEnemies = 180; this.quality = 0; }
      }
    }
  };

  P.update = function (rdt) {
    var p = this.player, i;
    for (i = this.banners.length - 1; i >= 0; i--) { this.banners[i].t += rdt; if (this.banners[i].t > this.banners[i].dur) this.banners.splice(i, 1); }
    if (this.flash > 0) this.flash -= rdt;
    if (this.ending) {
      this.ending.t += rdt;
      if (this.ending.win) this.timeScale = this.ending.t < 1.5 ? 0.2 : Math.min(1, 0.2 + (this.ending.t - 1.5));
      else this.timeScale = 0.35;
      if (this.ending.t >= this.ending.dur) { this.endRun(this.ending.win); return; }
    }
    var dt = Math.min(rdt, 0.05) * this.timeScale;
    if (!this.ending) this.gameTime += dt;
    this.updatePlayer(dt);
    this.buildGrid();
    this.updateSpawns(dt);
    this.updateEnemies(dt, rdt);
    this.separate();
    this.updateWeapons(dt);
    this.updateShots(dt); this.updateEShots(dt); this.updatePages(dt); this.updateOxen(dt); this.updateFx(dt);
    this.updateDrops(dt); this.updateParts(dt); this.updateNums(dt); this.updateShop();
    if (this.shake > 0) this.shake = Math.max(0, this.shake - rdt * 25);
    if (this.magnetT > 0) this.magnetT -= dt;
    if (this.state !== ST.PLAY) return;
    if (this.pendingLevels > 0 && !this.ending) { this.openLevelUp(); return; }
    if (p.hp <= 0 && !this.ending) {
      p.hp = 0; this.ending = { win: false, t: 0, dur: 1.8 };
      this.banner('力竭……', '纸兵太多，再战一局！', 2, '#ff8a80'); Sound.play('lose'); this.updateMusic();
    }
  };

  P.updatePlayer = function (dt) {
    var p = this.player, mx = 0, my = 0, k = this.keys;
    if (k.a || k.ArrowLeft) mx -= 1; if (k.d || k.ArrowRight) mx += 1;
    if (k.w || k.ArrowUp) my -= 1; if (k.s || k.ArrowDown) my += 1;
    if (mx || my) { var l = Math.sqrt(mx * mx + my * my); mx /= l; my /= l; }
    else if (this.joy.active) {
      var dx = this.joy.x - this.joy.bx, dy = this.joy.y - this.joy.by, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 6) { var m = Math.min(1, d / 46); mx = dx / d * m; my = dy / d * m; }
    }
    if (this.bindT > 0) { this.bindT -= dt; mx = 0; my = 0; } // 被兵书缚住：不能移动（武器照常自动攻击）
    p.moving = !!(mx || my);
    if (p.moving) {
      if (this.ending && this.ending.win) { mx *= 0.3; my *= 0.3; }
      var sp = this.speed();
      p.x += mx * sp * dt; p.y += my * sp * dt; p.ang = Math.atan2(my, mx); this.moved = true;
      if (Math.abs(mx) > 0.15) p.face = mx < 0 ? 0 : 1;
      p.walkT += dt * 10;
    }
    if (p.hurtT > 0) p.hurtT -= dt;
    if (p.swingT > 0) p.swingT -= dt;
  };

  // ---------- 空间网格 ----------
  P.buildGrid = function () {
    var head = this.gridHead, next = this.gridNext, E = this.enemies, i, e, cx, cy, half = GRID_N * GRID_CELL / 2;
    for (i = 0; i < head.length; i++) head[i] = -1;
    this.gox = this.player.x - half; this.goy = this.player.y - half;
    for (i = 0; i < MAX_E; i++) {
      e = E[i]; next[i] = -1;
      if (!e.active) continue;
      cx = Math.floor((e.x - this.gox) / GRID_CELL); cy = Math.floor((e.y - this.goy) / GRID_CELL);
      if (cx < 0 || cy < 0 || cx >= GRID_N || cy >= GRID_N) continue;
      var c = cy * GRID_N + cx; next[i] = head[c]; head[c] = i;
    }
  };
  P.query = function (x, y, r) {
    var res = this.qres, n = 0, head = this.gridHead, next = this.gridNext, E = this.enemies;
    var x0 = Math.max(0, Math.floor((x - r - 30 - this.gox) / GRID_CELL)), x1 = Math.min(GRID_N - 1, Math.floor((x + r + 30 - this.gox) / GRID_CELL));
    var y0 = Math.max(0, Math.floor((y - r - 30 - this.goy) / GRID_CELL)), y1 = Math.min(GRID_N - 1, Math.floor((y + r + 30 - this.goy) / GRID_CELL));
    for (var cy = y0; cy <= y1; cy++) for (var cx = x0; cx <= x1; cx++) {
      var i = head[cy * GRID_N + cx];
      while (i !== -1) {
        var e = E[i];
        if (e.active && !(e.dieT > 0)) { var dx = e.x - x, dy = e.y - y, q = r + e.r; if (dx * dx + dy * dy <= q * q) res[n++] = i; }
        i = next[i];
      }
    }
    this.qn = n; return n;
  };
  P.nearest = function (x, y, R) {
    var n = this.query(x, y, R), best = null, bd = 1e12;
    for (var k = 0; k < n; k++) { var e = this.enemies[this.qres[k]], dx = e.x - x, dy = e.y - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = e; } }
    return best;
  };
  P.separate = function () {
    var head = this.gridHead, next = this.gridNext, E = this.enemies;
    for (var c = 0; c < head.length; c++) {
      var a = head[c], cnt = 0;
      while (a !== -1 && cnt < 14) {
        var ea = E[a], b = next[a], inner = 0;
        while (b !== -1 && inner < 10) {
          var eb = E[b];
          if (ea.active && eb.active) {
            var dx = eb.x - ea.x, dy = eb.y - ea.y, d2 = dx * dx + dy * dy, q = (ea.r + eb.r) * 0.85;
            if (d2 < q * q && d2 > 0.01) {
              var d = Math.sqrt(d2), push = (q - d) * 0.5 / d;
              var wa = ea.type === 4 ? 0 : 1, wb = eb.type === 4 ? 0 : 1;
              if (wa && !wb) wa = 2; if (wb && !wa) wb = 2;
              ea.x -= dx * push * wa; ea.y -= dy * push * wa; eb.x += dx * push * wb; eb.y += dy * push * wb;
            }
          }
          b = next[b]; inner++;
        }
        a = next[a]; cnt++;
      }
    }
  };

  // ---------- 刷怪 ----------
  P.edgePos = function (ang) {
    var p = this.player, hw = this.W / 2 + 40, hh = this.H / 2 + 40, c = Math.cos(ang), s = Math.sin(ang);
    var t = Math.min(hw / Math.max(0.001, Math.abs(c)), hh / Math.max(0.001, Math.abs(s)));
    return { x: p.x + c * t, y: p.y + s * t };
  };
  P.spawnEnemy = function (type, x, y) {
    if (type !== 4 && this.activeE >= this.maxEnemies) return null;
    var e = freeSlot(this.enemies); if (!e) return null;
    var d = ETYPES[type], scale = type === 4 ? 1 : 1 + this.gameTime / 72;
    e.active = true; e.type = type; e.x = x; e.y = y; e.hp = d.hp * scale; e.maxHp = e.hp;
    e.speed = d.speed * rand(0.9, 1.12); e.r = d.r; e.dps = d.dps; e.kx = 0; e.ky = 0; e.flash = 0; e.frozen = 0;
    e.dmgAcc = 0; e.dmgT = 0; e.ringT = 0; e.dieT = 0; e.shootT = rand(1.5, 3); e.face = 0; e.seed = Math.random() * 10;
    this.activeE++;
    return e;
  };
  P.pickType = function (t) {
    var r = Math.random();
    if (t > 32 && r < Math.min(0.12, 0.04 + (t - 32) / 340)) return 2;
    r = Math.random();
    if (t > 45 && r < Math.min(0.2, 0.06 + (t - 45) / 340)) return 1;
    return 0;
  };
  P.updateSpawns = function (dt) {
    if (this.ending) return;
    var t = this.gameTime, i, p = this.player;
    for (i = 0; i < this.events.length; i++) {
      var ev = this.events[i];
      if (ev.done || t < ev.t) continue;
      ev.done = true;
      if (ev.type === 'swarm') {
        var n = 34 + Math.floor(t / 6);
        for (var k = 0; k < n; k++) { var q = this.edgePos(k * TAU / n); this.spawnEnemy(0, q.x, q.y); }
        this.banner('纸兵合围！', '快走位，别被围死', 1.6, '#ffffff');
      } else if (ev.type === 'elite') {
        var q2 = this.edgePos(rand(0, TAU)); this.spawnEnemy(3, q2.x, q2.y);
        this.banner('纸将军来袭', '目标：击败它，夺虎符和铜钱', 2, '#ffcf6b');
      } else if (ev.type === 'kites') {
        for (var m = 0; m < 5; m++) { var q3 = this.edgePos(rand(0, TAU)); this.spawnEnemy(2, q3.x, q3.y); }
        this.banner('纸鸢弓手登场', '会远远放箭，靠近砍掉它们', 2, '#cfe8ff');
      } else if (ev.type === 'warn') {
        this.banner('赵括要来了！', '还有 15 秒，抓紧变强', 2.4, '#ff8a6a');
        Sound.play('horn');
      } else if (ev.type === 'wall') {
        var side = Math.random() < 0.5 ? -1 : 1;
        for (var w = 0; w < 12; w++) this.spawnEnemy(1, p.x + side * (this.W / 2 + 40), p.y - 180 + w * 32);
        this.banner('竹简盾阵！', '', 1.4, '#e8d27a');
      }
    }
    if (!this.shopSpawned && t >= SHOP_TIME) this.spawnShop();
    if (!this.bossSpawned && t >= BOSS_TIME) this.spawnBoss();
    var rate;
    if (this.bossSpawned) rate = 3.5;
    else if (t < 30) rate = 1.6 + t / 30 * 2.4;
    else if (t < 75) rate = 4 + (t - 30) / 45 * 5;
    else rate = 9 + (t - 75) / 15 * 3;
    this.groupT -= dt; if (this.groupT <= 0) { this.groupT = rand(0.6, 1.2); this.groupAng = rand(0, TAU); }
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (this.activeE >= this.maxEnemies) { this.spawnAcc = 0; break; }
      var pos = this.edgePos(this.groupAng + rand(-0.45, 0.45));
      this.spawnEnemy(this.pickType(t), pos.x + rand(-15, 15), pos.y + rand(-15, 15));
    }
  };
  P.spawnShop = function () {
    var p = this.player;
    this.shopSpawned = true;
    this.shop = { x: p.x + Math.cos(p.ang) * 150, y: p.y + Math.sin(p.ang) * 150 - 40, ready: true };
    this.banner('吕不韦货栈开张', '奇货可居 · 走过去用铜钱买技能', 2.8, '#d7b2ff');
    Sound.play('coin');
  };
  P.spawnBoss = function () {
    var p = this.player;
    this.bossSpawned = true;
    var e = this.spawnEnemy(4, p.x, p.y - this.H / 2 - 60);
    e.hp = e.maxHp = BOSS_HP_BASE + this.level * BOSS_HP_LV;
    this.boss = e;
    this.bossAI = { mode: 'move', t: 0, throwT: 2.5, chargeT: 6, pullT: 4, dirx: 0, diry: 1, sayT: 1, say: '', sayLeft: 0 };
    this.banner('赵括 · 纸上谈兵', '「兵书在手，天下我有！」', 3, '#ff6b5a');
    Sound.play('horn'); this.shake = 6;
    this.updateMusic();
  };

  // ---------- 敌人 ----------
  P.updateEnemies = function (dt, rdt) {
    var p = this.player, E = this.enemies, contact = 0, lim = this.W / 2 + 260, limy = this.H / 2 + 260;
    for (var i = 0; i < MAX_E; i++) {
      var e = E[i]; if (!e.active) continue;
      if (e.dieT > 0) { e.dieT -= rdt; if (e.dieT <= 0) this.killEnemy(e, true); continue; }
      if (e.flash > 0) e.flash -= dt;
      if (e.ringT > 0) e.ringT -= dt;
      if (e.dmgT > 0) { e.dmgT -= dt; if (e.dmgT <= 0 && e.dmgAcc > 0) { this.spawnNum(e.x, e.y - e.r * 2.4, e.dmgAcc); e.dmgAcc = 0; } }
      var dx = p.x - e.x, dy = p.y - e.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      e.face = dx < 0 ? 0 : 1;
      if (e.type === 4) this.updateBoss(e, dt, dx, dy, d);
      else if (e.frozen > 0) e.frozen -= dt;
      else {
        var sp = e.speed;
        if (e.type === 2) {
          if (d < 140) sp = -e.speed * 0.6; else if (d < 185) sp = 0;
          e.shootT -= dt;
          if (e.shootT <= 0 && d < 330 && !this.ending) { e.shootT = rand(2.4, 3.2); this.fireEShot(e.x, e.y, dx / d, dy / d); }
        }
        e.x += (dx / d) * sp * dt + e.kx * dt; e.y += (dy / d) * sp * dt + e.ky * dt;
        var f = Math.min(1, dt * 8); e.kx -= e.kx * f; e.ky -= e.ky * f;
        if (Math.abs(dx) > lim || Math.abs(dy) > limy) {
          var q = this.edgePos((p.moving ? p.ang : Math.atan2(-dy, -dx) + Math.PI) + rand(-0.9, 0.9));
          e.x = q.x; e.y = q.y;
        }
      }
      if (d < e.r + 12 && !(e.frozen > 0)) contact += (e.type === 4 && this.bossAI && this.bossAI.mode === 'dash') ? 60 : e.dps;
    }
    if (contact > 0) this.hurtPlayer(contact * dt, true);
  };
  P.updateBoss = function (e, dt, dx, dy, d) {
    var b = this.bossAI;
    if (this.ending) return;
    if (e.frozen > 0) { e.frozen -= dt; return; }
    b.throwT -= dt; b.chargeT -= dt; b.pullT -= dt; b.sayT -= dt;
    if (b.sayLeft > 0) b.sayLeft -= dt;
    if (b.sayT <= 0) {
      b.sayT = rand(5, 7); b.sayLeft = 2.2;
      b.say = e.hp < e.maxHp * 0.35 ? pick(BOSS_LINES_LOW) : pick(BOSS_LINES);
    }
    if (b.mode === 'move') {
      var sp = d > 140 ? e.speed : (d < 90 ? -e.speed * 0.5 : 0);
      if (d > 520) sp = e.speed * 4;
      e.x += dx / d * sp * dt; e.y += dy / d * sp * dt;
      if (b.throwT <= 0) { b.throwT = e.hp < e.maxHp * 0.5 ? 2.3 : 3.2; this.bossThrow(e); }
      if (b.pullT <= 0 && d < PULL_R - 20) { b.mode = 'pullAim'; b.t = PULL_WIND; b.say = '看我兵书缚身！'; b.sayLeft = 1.6; b.sayT = 4; Sound.play('suck'); }
      else if (b.chargeT <= 0 && d < 420) { b.mode = 'aim'; b.t = 0.85; b.dirx = dx / d; b.diry = dy / d; }
    } else if (b.mode === 'pullAim') { // 预警：原地蓄力，玩家可在这 1 秒内跑出圈
      b.t -= dt; if (b.t <= 0) { b.mode = 'pull'; b.t = PULL_DUR; }
    } else if (b.mode === 'pull') { // 吸附：圈内玩家被拽向 Boss，拽速快于任何英雄
      var p = this.player; b.t -= dt;
      if (d < PULL_R + 10) {
        var step = Math.min(PULL_SPEED * dt, Math.max(0, d - BIND_R * 0.9));
        p.x -= dx / d * step; p.y -= dy / d * step; this.pulled = true;
        if (d - step <= BIND_R) {
          b.mode = 'bind'; b.t = BIND_DUR; this.bindT = BIND_DUR; this.pulled = false;
          this.banner('被兵书缚住！', '挣不脱……撑过这几秒！', 1.6, '#c58bff'); Sound.play('bind'); this.shake = Math.max(this.shake, 5);
          this.bossThrow(e);
        }
      } else this.pulled = false;
      if (b.mode === 'pull' && b.t <= 0) { b.mode = 'move'; this.pulled = false; b.pullT = this.pullCd(e); }
    } else if (b.mode === 'bind') { // 定身：玩家不能移动，持续掉血，书页砸下
      b.t -= dt; this.hurtPlayer(BIND_DPS * dt, true);
      if (b.t <= 0) { b.mode = 'move'; this.bindT = 0; b.pullT = this.pullCd(e); b.chargeT = Math.max(b.chargeT, 1.5); }
    } else if (b.mode === 'aim') {
      b.t -= dt; if (b.t <= 0) { b.mode = 'dash'; b.t = 0.55; Sound.play('ox'); }
    } else if (b.mode === 'dash') {
      e.x += b.dirx * 560 * dt; e.y += b.diry * 560 * dt; b.t -= dt;
      if (this.quality > 0 && Math.random() < 0.6) this.spawnPart(e.x + rand(-20, 20), e.y + rand(-10, 10), 0, 0, 0.4, '#f4ecd6', 3, 0);
      if (b.t <= 0) { b.mode = 'move'; b.chargeT = rand(7, 9.5); }
    }
  };
  P.pullCd = function (e) { return e.hp < e.maxHp * 0.5 ? rand(5, 6.5) : rand(7, 9); };
  P.bossThrow = function (e) {
    var p = this.player, n = e.hp < e.maxHp * 0.5 ? 6 : 4;
    for (var k = 0; k < n; k++) {
      var a = rand(0, TAU), r = k === 0 ? 0 : rand(40, 120);
      this.pages.push({ x0: e.x, y0: e.y - 40, tx: p.x + Math.cos(a) * r, ty: p.y + Math.sin(a) * r, t: 0, dur: 1.15 + k * 0.08, rot: rand(0, TAU) });
    }
    Sound.play('page');
  };
  P.updatePages = function (dt) {
    var p = this.player;
    for (var i = this.pages.length - 1; i >= 0; i--) {
      var pg = this.pages[i]; pg.t += dt; pg.rot += dt * 8;
      if (pg.t >= pg.dur) {
        this.pages.splice(i, 1);
        var dx = p.x - pg.tx, dy = p.y - pg.ty;
        if (dx * dx + dy * dy < 44 * 44) this.hurtPlayer(14, false);
        for (var k = 0; k < 3; k++) { var a = k * TAU / 3; this.spawnEnemy(0, pg.tx + Math.cos(a) * 18, pg.ty + Math.sin(a) * 18); }
        this.burst(pg.tx, pg.ty, 10, '#f4ecd6'); this.shake = Math.max(this.shake, 3); Sound.play('page');
      }
    }
  };
  P.fireEShot = function (x, y, nx, ny) {
    var s = freeSlot(this.eshots); if (!s) return;
    s.active = true; s.x = x; s.y = y; s.vx = nx * 150; s.vy = ny * 150; s.life = 3;
  };
  P.updateEShots = function (dt) {
    var p = this.player;
    for (var i = 0; i < MAX_ESHOT; i++) {
      var s = this.eshots[i]; if (!s.active) continue;
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0) { s.active = false; continue; }
      var dx = s.x - p.x, dy = s.y - p.y;
      if (dx * dx + dy * dy < 14 * 14) { s.active = false; this.hurtPlayer(7, false); }
    }
  };
  P.hurtPlayer = function (amt, cont) {
    if (this.debug.god || this.ending) return;
    var p = this.player;
    p.hp -= amt; p.hurtT = 0.12;
    this.rage = Math.min(this.rageMax, this.rage + amt * 0.25);
    if (!cont || Math.random() < 0.15) Sound.play('hurt');
    if (!cont) this.shake = Math.max(this.shake, 4);
  };
  P.hitEnemy = function (e, dmg, kx, ky) {
    if (!e.active || e.dieT > 0) return;
    e.hp -= dmg; e.flash = 0.08;
    var kb = ETYPES[e.type].kb;
    if (kx || ky) { e.kx += kx * kb; e.ky += ky * kb; }
    e.dmgAcc += dmg; if (e.dmgT <= 0) e.dmgT = 0.18;
    Sound.play('hit');
    if (e.hp <= 0) this.killEnemy(e, false);
  };
  P.killEnemy = function (e, rout) {
    if (!e.active) return;
    e.active = false; this.activeE--;
    var d = ETYPES[e.type];
    this.kills++;
    if (!rout) Sound.play('die');
    if (!this.ending) this.rage = Math.min(this.rageMax, this.rage + (e.type === 3 ? 10 : 1));
    this.burst(e.x, e.y - 6, this.quality > 1 ? (e.type >= 3 ? 26 : 6) : 3, e.type === 1 ? '#cdb85a' : '#f4ecd6');
    if (e.dmgAcc > 0) { this.spawnNum(e.x, e.y - e.r * 2.4, e.dmgAcc); e.dmgAcc = 0; }
    if (e.type === 4) { this.onBossDown(e); return; }
    if (rout) return;
    if (d.exp) this.spawnDrop(0, e.x, e.y, d.exp);
    if (Math.random() < d.coin) this.spawnDrop(1, e.x + rand(-6, 6), e.y + rand(-6, 6), e.type === 3 ? 10 : 1);
    if (e.type === 3) { this.spawnDrop(3, e.x + 12, e.y, 1); this.spawnDrop(2, e.x - 12, e.y, 1); }
    else if (Math.random() < 0.004) this.spawnDrop(2, e.x, e.y, 1);
    else if (Math.random() < 0.002) this.spawnDrop(3, e.x, e.y, 1);
  };
  P.onBossDown = function (e) {
    this.boss = null; this.bindT = 0; this.pulled = false;
    this.ending = { win: true, t: 0, dur: 3.8 };
    this.flash = 1; this.shake = 12;
    this.banner('破 · 纸上谈兵', '赵括兵书尽碎，纸军溃散！', 3.6, '#ffd54a');
    Sound.play('win'); this.updateMusic();
    this.burst(e.x, e.y - 20, 60, '#f4ecd6');
    var p = this.player;
    for (var i = 0; i < MAX_E; i++) {
      var o = this.enemies[i];
      if (o.active) { var dx = o.x - p.x, dy = o.y - p.y; o.dieT = 0.2 + Math.sqrt(dx * dx + dy * dy) / 400 + rand(0, 0.4); }
    }
    this.pages = [];
    for (i = 0; i < MAX_ESHOT; i++) this.eshots[i].active = false;
  };

  // ---------- 武器 ----------
  P.updateWeapons = function (dt) {
    if (this.ending && this.ending.win) return;
    var s = this.skills, t = this.timers, cdm = this.cdMul(), p = this.player, dm = this.dmgMul(), lv, k, e;
    for (var id in t) if (t.hasOwnProperty(id)) t[id] -= dt;
    if (s.halberd && t.halberd <= 0) {
      lv = s.halberd; t.halberd = (1.05 - 0.07 * lv) * cdm;
      var r = 76 + lv * 8, arc = (120 + lv * 12) * Math.PI / 180, dmg = (14 + lv * 5) * dm;
      e = this.nearest(p.x, p.y, r * 1.5);
      var ang = e ? Math.atan2(e.y - p.y, e.x - p.x) : p.ang;
      this.sweepAt(ang, r, arc, dmg);
      if (lv >= 5) this.sweepAt(ang + Math.PI, r * 0.85, arc, dmg * 0.8);
    }
    if (s.bagua && t.bagua <= 0) {
      lv = this.skLv('bagua'); t.bagua = (1.5 - 0.08 * lv) * cdm;
      var cnt = 1 + Math.floor(lv / 2), br = 46 + lv * 6 + (lv >= 5 ? 10 : 0), bd = (8 + lv * 3) * (lv >= 5 ? 1.3 : 1) * dm;
      for (k = 0; k < cnt; k++) {
        var pos = this.pickCluster(290);
        if (!pos) pos = { x: p.x + Math.cos(p.ang) * 90 + rand(-40, 40), y: p.y + Math.sin(p.ang) * 90 + rand(-40, 40) };
        this.addFx('bagua', pos.x, pos.y, { r: br, dur: 0.95, dmg: bd, ticks: 0 });
      }
      Sound.play('bagua');
    }
    if (s.crossbow && t.crossbow <= 0) {
      lv = this.skLv('crossbow'); t.crossbow = (1.25 - (lv >= 4 ? 0.3 : 0.06 * lv)) * cdm;
      var na = 1 + lv, pierce = lv >= 5 ? 2 : (lv >= 3 ? 1 : 0), cd = (9 + lv * 3) * dm;
      var n = this.query(p.x, p.y, 340), list = [];
      for (k = 0; k < n; k++) { e = this.enemies[this.qres[k]]; list.push({ e: e, d: (e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y) }); }
      list.sort(function (a, b) { return a.d - b.d; });
      for (k = 0; k < na; k++) {
        var a2;
        if (list.length) { var tg = list[k % list.length].e; a2 = Math.atan2(tg.y - p.y, tg.x - p.x) + (k >= list.length ? rand(-0.2, 0.2) : 0); }
        else a2 = p.ang + (k - na / 2) * 0.15;
        this.fireShot(p.x, p.y - 12, a2, 460, cd, pierce, 0);
      }
      Sound.play('arrow');
    }
    if (s.swordring) {
      lv = EFF[s.swordring]; this.swordAng += dt * (lv >= 4 ? 4.2 : 3.2);
      var sc = lv + 1, sr = 58, sdmg = (7 + lv * 3) * (lv >= 5 ? 1.4 : 1) * dm;
      for (k = 0; k < sc; k++) {
        var aa = this.swordAng + k * TAU / sc, sx = p.x + Math.cos(aa) * sr, sy = p.y - 10 + Math.sin(aa) * sr;
        var m = this.query(sx, sy, 12);
        for (var j = 0; j < m; j++) { e = this.enemies[this.qres[j]]; if (e.ringT <= 0) { e.ringT = 0.4; this.hitEnemy(e, sdmg, Math.cos(aa) * 80, Math.sin(aa) * 80); } }
      }
    }
    if (s.fireox && t.fireox <= 0) {
      lv = EFF[s.fireox]; t.fireox = (3.2 - (lv >= 4 ? 0.8 : 0.15 * lv)) * cdm;
      var oc = 1 + Math.floor((lv - 1) / 2);
      for (k = 0; k < oc; k++) {
        e = this.nearest(p.x, p.y, 300);
        var oa = (e ? Math.atan2(e.y - p.y, e.x - p.x) : p.ang) + (k - (oc - 1) / 2) * 0.5;
        this.launchOx(p.x, p.y, Math.cos(oa) * 300, Math.sin(oa) * 300, 1.3, (18 + lv * 6) * dm, 14 + lv * 2, false);
      }
      Sound.play('ox');
    }
    if (this.evolved) {
      this.stampedeT -= dt;
      if (this.stampedeT <= 0) {
        this.stampedeT = 5 * cdm;
        var side = Math.random() < 0.5 ? -1 : 1, lanes = 9, x0 = p.x - side * (this.W / 2 + 50), life = (this.W + 140) / 420;
        for (k = 0; k < lanes; k++) {
          var ly = p.y - this.H / 2 + 70 + k * (this.H - 140) / (lanes - 1) + rand(-12, 12);
          this.launchOx(x0 - side * rand(0, 60), ly, side * 420, 0, life + 0.2, 55 * dm, 24, true);
        }
        this.shake = Math.max(this.shake, 5); Sound.play('ox');
      }
    }
    if (s.bell && t.bell <= 0) {
      lv = EFF[s.bell]; t.bell = (2.6 - (lv >= 3 ? 0.5 : 0)) * cdm;
      var rmax = 85 + lv * 18, bdmg = (10 + lv * (lv >= 3 ? 5 : 4)) * dm;
      this.addFx('ring', p.x, p.y, { r: 14, r0: 14, rMax: rmax, dur: 0.5, dmg: bdmg, prev: 0 });
      if (lv >= 5) this.addFx('ring', p.x, p.y, { r: 14, r0: 14, rMax: rmax * 0.8, dur: 0.5, dmg: bdmg * 0.7, prev: 0, delay: 0.35 });
      Sound.play('bell');
    }
    if (s.bird) this.updateBirds(dt, EFF[s.bird], dm);
    if (s.allies) this.updateAllies(dt, EFF[s.allies], dm);
    if (s.cavalry && t.cavalry <= 0) {
      lv = EFF[s.cavalry]; t.cavalry = 1.1 * cdm;
      this.cavAng += 0.55;
      for (k = 0; k < lv; k++) this.fireShot(p.x, p.y - 12, this.cavAng + k * TAU / lv, 400, (7 + lv * 2) * (lv >= 5 ? 1.3 : 1) * dm, 1, 1);
      Sound.play('arrow');
    }
  };
  P.sweepAt = function (ang, r, arc, dmg) {
    var p = this.player, n = this.query(p.x, p.y - 8, r), ids = [];
    for (var k = 0; k < n; k++) ids.push(this.qres[k]);
    for (k = 0; k < ids.length; k++) {
      var e = this.enemies[ids[k]];
      var a = Math.atan2(e.y - p.y, e.x - p.x);
      if (Math.abs(angDiff(a, ang)) <= arc / 2 + 0.2) this.hitEnemy(e, dmg, Math.cos(a) * 160, Math.sin(a) * 160);
    }
    this.addFx('sweep', p.x, p.y - 8, { ang: ang, arc: arc, r: r, dur: 0.22 });
    p.swingT = 0.22; Sound.play('sweep');
  };
  P.pickCluster = function (R) {
    var p = this.player, n = this.query(p.x, p.y, R);
    if (!n) return null;
    var cands = [], k;
    for (k = 0; k < Math.min(6, n); k++) { var e = this.enemies[this.qres[Math.floor(Math.random() * n)]]; cands.push({ x: e.x, y: e.y }); }
    var best = cands[0], bc = -1;
    for (k = 0; k < cands.length; k++) { var c = this.query(cands[k].x, cands[k].y, 50); if (c > bc) { bc = c; best = cands[k]; } }
    return best;
  };
  P.fireShot = function (x, y, ang, sp, dmg, pierce, kind) {
    var s = freeSlot(this.shots); if (!s) return;
    s.active = true; s.x = x; s.y = y; s.vx = Math.cos(ang) * sp; s.vy = Math.sin(ang) * sp; s.dmg = dmg; s.pierce = pierce; s.life = 1.1; s.kind = kind; s.hits.length = 0; s.ang = ang;
  };
  P.updateShots = function (dt) {
    for (var i = 0; i < MAX_SHOT; i++) {
      var s = this.shots[i]; if (!s.active) continue;
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0) { s.active = false; continue; }
      var n = this.query(s.x, s.y, 5);
      for (var k = 0; k < n; k++) {
        var id = this.qres[k]; if (s.hits.indexOf(id) >= 0) continue;
        var e = this.enemies[id];
        s.hits.push(id); this.hitEnemy(e, s.dmg, s.vx * 0.15, s.vy * 0.15);
        s.pierce--; if (s.pierce < 0) { s.active = false; break; }
      }
    }
  };
  P.launchOx = function (x, y, vx, vy, life, dmg, r, big) {
    var o = freeSlot(this.oxen); if (!o) return;
    o.active = true; o.x = x; o.y = y; o.vx = vx; o.vy = vy; o.life = life; o.dmg = dmg; o.r = r; o.big = big; o.hits.length = 0;
  };
  P.updateOxen = function (dt) {
    for (var i = 0; i < MAX_OX; i++) {
      var o = this.oxen[i]; if (!o.active) continue;
      o.x += o.vx * dt; o.y += o.vy * dt; o.life -= dt;
      if (o.life <= 0) { o.active = false; continue; }
      var n = this.query(o.x, o.y - 6, o.r), sp = Math.sqrt(o.vx * o.vx + o.vy * o.vy) || 1;
      for (var k = 0; k < n; k++) {
        var id = this.qres[k]; if (o.hits.indexOf(id) >= 0) continue;
        o.hits.push(id); this.hitEnemy(this.enemies[id], o.dmg, o.vx / sp * 220, o.vy / sp * 220);
      }
      if (this.quality > 0 && Math.random() < (o.big ? 0.5 : 0.7)) this.spawnPart(o.x - o.vx / sp * 14 + rand(-4, 4), o.y - 14 + rand(-4, 4), rand(-20, 20), rand(-50, -10), 0.4, pick(['#ff7b1c', '#ffb340', '#ff3d1c']), 4, 0);
    }
  };
  P.updateBirds = function (dt, lv, dm) {
    var p = this.player, want = BIRD_COUNT[lv], dmg = (8 + lv * 3) * (lv >= 3 ? 1.2 : 1) * dm, sp = lv >= 5 ? 400 : 320;
    while (this.birds.length < want) this.birds.push({ x: p.x, y: p.y - 30, tgt: null, cool: 0, ang: rand(0, TAU) });
    for (var i = 0; i < this.birds.length; i++) {
      var b = this.birds[i];
      b.ang += dt * 3;
      if (b.cool > 0) b.cool -= dt;
      if (b.tgt && (!b.tgt.active || b.tgt.dieT > 0)) b.tgt = null;
      if (!b.tgt && b.cool <= 0) { var n = this.query(p.x, p.y, 280); if (n) b.tgt = this.enemies[this.qres[Math.floor(Math.random() * n)]]; }
      var tx, ty;
      if (b.tgt) { tx = b.tgt.x; ty = b.tgt.y - 8; } else { tx = p.x + Math.cos(b.ang + i) * 40; ty = p.y - 30 + Math.sin(b.ang + i) * 16; }
      var dx = tx - b.x, dy = ty - b.y, d = Math.sqrt(dx * dx + dy * dy) || 1, step = Math.min(d, sp * dt);
      b.x += dx / d * step; b.y += dy / d * step; b.dir = dx < 0 ? -1 : 1;
      if (b.tgt && d < 10 + b.tgt.r) { this.hitEnemy(b.tgt, dmg, dx / d * 60, dy / d * 60); this.burst(b.x, b.y, 3, '#a1887f'); b.tgt = null; b.cool = 0.2; }
    }
  };
  P.updateAllies = function (dt, lv, dm) {
    var p = this.player, want = lv + 1, dmg = (8 + lv * 3) * (lv >= 3 ? 1.2 : 1) * dm, iv = lv >= 5 ? 0.38 : 0.55;
    while (this.allies.length < want) { var nn = this.allies.length; this.allies.push({ x: p.x, y: p.y, tgt: null, atkT: 0, anim: 0, nation: nn % 6 }); }
    for (var i = 0; i < this.allies.length; i++) {
      var a = this.allies[i];
      if (a.atkT > 0) a.atkT -= dt; if (a.anim > 0) a.anim -= dt;
      if (a.tgt && (!a.tgt.active || a.tgt.dieT > 0)) a.tgt = null;
      if (!a.tgt) {
        var e = this.nearest(a.x, a.y, 130);
        if (e && (e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y) < 180 * 180) a.tgt = e;
      }
      var tx, ty, slotA = this.time * 0.6 + i * TAU / this.allies.length;
      if (a.tgt) { tx = a.tgt.x; ty = a.tgt.y; } else { tx = p.x + Math.cos(slotA) * 36; ty = p.y + Math.sin(slotA) * 24; }
      var dx = tx - a.x, dy = ty - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      var reach = a.tgt ? a.tgt.r + 12 : 2;
      if (d > reach) { var st = Math.min(d - reach, 175 * dt); a.x += dx / d * st; a.y += dy / d * st; }
      a.dir = dx < 0 ? -1 : 1;
      if (a.tgt && d <= reach + 4 && a.atkT <= 0) { a.atkT = iv; a.anim = 0.15; this.hitEnemy(a.tgt, dmg, dx / d * 70, dy / d * 70); }
      var pdx = a.x - p.x, pdy = a.y - p.y;
      if (pdx * pdx + pdy * pdy > 240 * 240) { a.x = p.x; a.y = p.y; a.tgt = null; }
    }
  };
  P.addFx = function (type, x, y, o) {
    var f = freeSlot(this.fx); if (!f) return null;
    f.active = true; f.type = type; f.x = x; f.y = y; f.t = 0;
    f.r = 0; f.dur = 0.3; f.dmg = 0; f.ticks = 0; f.ang = 0; f.arc = 0; f.r0 = 0; f.rMax = 0; f.prev = 0; f.delay = 0; f.stage = 0;
    for (var k in o) if (o.hasOwnProperty(k)) f[k] = o[k];
    return f;
  };
  P.updateFx = function (dt) {
    var p = this.player, k, n, e, ids;
    for (var i = 0; i < MAX_FX; i++) {
      var f = this.fx[i]; if (!f.active) continue;
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.t += dt;
      if (f.type === 'bagua') {
        var tickAt = [0.12, 0.42, 0.72];
        while (f.ticks < 3 && f.t >= tickAt[f.ticks]) {
          f.ticks++;
          n = this.query(f.x, f.y, f.r); ids = [];
          for (k = 0; k < n; k++) ids.push(this.qres[k]);
          for (k = 0; k < ids.length; k++) this.hitEnemy(this.enemies[ids[k]], f.dmg, 0, 0);
        }
      } else if (f.type === 'ring') {
        f.x = p.x; f.y = p.y;
        var r = f.r0 + (f.rMax - f.r0) * Math.min(1, f.t / f.dur);
        n = this.query(f.x, f.y, r); ids = [];
        for (k = 0; k < n; k++) { e = this.enemies[this.qres[k]]; var dx = e.x - f.x, dy = e.y - f.y, d = Math.sqrt(dx * dx + dy * dy); if (d + e.r >= f.prev) ids.push(this.qres[k]); }
        for (k = 0; k < ids.length; k++) { e = this.enemies[ids[k]]; var a = Math.atan2(e.y - f.y, e.x - f.x); this.hitEnemy(e, f.dmg, Math.cos(a) * 220, Math.sin(a) * 220); }
        f.prev = r; f.r = r;
      } else if (f.type === 'ult') {
        var stages = [0, 0.28, 0.56];
        while (f.stage < 3 && f.t >= stages[f.stage]) {
          f.stage++;
          n = this.query(p.x, p.y, 215); ids = [];
          for (k = 0; k < n; k++) ids.push(this.qres[k]);
          for (k = 0; k < ids.length; k++) { e = this.enemies[ids[k]]; var a2 = Math.atan2(e.y - p.y, e.x - p.x); this.hitEnemy(e, f.dmg, Math.cos(a2) * 320, Math.sin(a2) * 320); }
          this.shake = 9; Sound.play('sweep');
        }
        f.x = p.x; f.y = p.y;
      } else if (f.type === 'mega') { f.x = p.x; f.y = p.y; }
      if (f.t >= f.dur) f.active = false;
    }
  };
  P.tryUlt = function () {
    if (this.state !== ST.PLAY || this.ending || this.rage < this.rageMax) return false;
    this.rage = 0; this.ultCount = (this.ultCount || 0) + 1;
    var p = this.player, dm = this.dmgMul(), k;
    Sound.play('ult'); this.flash = 0.35;
    if (this.hero.id === 'baiqi') {
      this.addFx('ult', p.x, p.y, { dur: 0.9, dmg: (70 + this.level * 4) * dm });
      this.banner('杀神降世', '', 1.4, '#ff5a4a');
    } else {
      for (var i = 0; i < MAX_E; i++) { var e = this.enemies[i]; if (e.active) e.frozen = e.type === 4 ? 1.2 : 2.6; }
      for (k = 0; k < 8; k++) { var a = k * TAU / 8; this.addFx('bagua', p.x + Math.cos(a) * 130, p.y + Math.sin(a) * 130, { r: 78, dur: 1.1, dmg: (32 + this.level * 2) * dm, ticks: 0 }); }
      this.addFx('bagua', p.x, p.y, { r: 90, dur: 1.1, dmg: (32 + this.level * 2) * dm, ticks: 0 });
      this.addFx('mega', p.x, p.y, { r: 200, dur: 1.3 });
      this.banner('天罗八阵', '全军定身！', 1.4, '#6ff3e0');
    }
    return true;
  };

  // ---------- 掉落 / 粒子 / 数字 ----------
  // 经验玉（type 0）占前 MAX_GEM 个槽位，铜钱/饭团/虎符占后 MAX_ITEM 个槽位，互不挤占。
  // 新玉 40px 内已有玉则并入；玉池满时并入最近的玉。只合并不丢经验（加成在拾取时按总值结算）。
  P.spawnDrop = function (type, x, y, v) {
    var i, d, o;
    if (type === 0) {
      this.gemDropped = (this.gemDropped || 0) + v;
      var near = null, nd = GEM_MERGE_R * GEM_MERGE_R, any = null, ad = Infinity, free = null;
      for (i = 0; i < MAX_GEM; i++) {
        o = this.drops[i];
        if (!o.active) { if (!free) free = o; continue; }
        var ddx = o.x - x, ddy = o.y - y, d2 = ddx * ddx + ddy * ddy;
        if (!o.mag && d2 <= nd) { nd = d2; near = o; }
        if (d2 < ad) { ad = d2; any = o; }
      }
      var into = near || (free ? null : any);
      if (into) { into.v += v; into.pop = 0.18; return; }
      d = free;
    } else {
      for (i = MAX_GEM; i < MAX_DROP; i++) if (!this.drops[i].active) { d = this.drops[i]; break; }
      if (!d) {
        if (type !== 1) return;
        for (i = MAX_GEM; i < MAX_DROP; i++) { o = this.drops[i]; if (o.type === 1) { o.v += v; return; } } // 铜钱满了也并入，不丢
        return;
      }
    }
    d.active = true; d.type = type; d.x = x; d.y = y; d.v = v; d.mag = false; d.t = 0; d.pop = 0;
  };
  P.gemTier = function (v) { return v >= 15 ? 2 : (v >= 5 ? 1 : 0); }; // 绿 <5、蓝 <15、金 ≥15
  P.drawGem = function (g, d) {
    var tier = this.gemTier(d.v), x = d.x, y = d.y, s = 1 + (d.pop > 0 ? d.pop * 2 : 0);
    if (tier === 0) {
      g.fillStyle = OUT; g.fillRect(x - 3, y - 5, 6, 10); g.fillStyle = '#6fe39a'; g.fillRect(x - 2, y - 4, 4, 8); g.fillStyle = '#fff'; g.fillRect(x - 1, y - 3, 1, 2);
      return;
    }
    var hw = (tier === 1 ? 5 : 7) * s, hh = (tier === 1 ? 7 : 9) * s;
    if (tier === 2 && this.quality > 0) {
      g.globalAlpha = 0.28 + Math.sin(this.time * 6 + x * 0.05) * 0.12; g.fillStyle = '#ffd54a';
      g.beginPath(); g.arc(x, y, 15 * s, 0, TAU); g.fill(); g.globalAlpha = 1;
    }
    g.fillStyle = OUT; g.beginPath(); g.moveTo(x, y - hh - 1.5); g.lineTo(x + hw + 1.5, y); g.lineTo(x, y + hh + 1.5); g.lineTo(x - hw - 1.5, y); g.closePath(); g.fill();
    g.fillStyle = tier === 1 ? '#57b8ff' : '#ffc928'; g.beginPath(); g.moveTo(x, y - hh); g.lineTo(x + hw, y); g.lineTo(x, y + hh); g.lineTo(x - hw, y); g.closePath(); g.fill();
    g.fillStyle = tier === 1 ? '#b8e6ff' : '#fff3b0'; g.beginPath(); g.moveTo(x, y - hh); g.lineTo(x + hw * 0.45, y - hh * 0.25); g.lineTo(x, y); g.lineTo(x - hw * 0.45, y - hh * 0.25); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.fillRect(x - 1, y - hh * 0.6, 2, 2);
  };
  P.updateDrops = function (dt) {
    var p = this.player, pr = PICK_R, i;
    for (i = 0; i < MAX_DROP; i++) {
      var d = this.drops[i]; if (!d.active) continue;
      d.t += dt; if (d.pop > 0) d.pop -= dt;
      var dx = p.x - d.x, dy = (p.y - 12) - d.y, dd = Math.sqrt(dx * dx + dy * dy) || 1;
      if (!d.mag && (dd < pr || (this.magnetT > 0 && d.type === 0) || (this.ending && this.ending.win))) { d.mag = true; d.t = 0; }
      if (d.mag) {
        var sp = 220 + d.t * 700, st = Math.min(dd, sp * dt);
        d.x += dx / dd * st; d.y += dy / dd * st;
        if (dd < 14) { d.active = false; this.collect(d); }
      }
    }
  };
  P.collect = function (d) {
    var p = this.player;
    if (d.type === 0) {
      this.gemCollected = (this.gemCollected || 0) + d.v;
      this.exp += d.v * (1 + EFF[this.skills.reform || 0] * 0.12);
      Sound.play('exp');
      while (this.exp >= this.expNeed) { this.exp -= this.expNeed; this.level++; this.expNeed = this.needFor(this.level); this.pendingLevels++; }
    } else if (d.type === 1) { this.coins += d.v; Sound.play('coin'); }
    else if (d.type === 2) { p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3); this.banner('黍米饭团 · 回血', '', 1, '#9cff9c'); Sound.play('buy'); }
    else if (d.type === 3) { this.magnetT = 1.5; this.banner('虎符 · 吸纳全场军功', '', 1.2, '#ffd54a'); Sound.play('buy'); }
  };
  P.spawnPart = function (x, y, vx, vy, life, color, size, grav) {
    var lim = this.quality > 1 ? MAX_PART : (this.quality > 0 ? 160 : 60);
    if (this.partCount >= lim) return;
    var q = freeSlot(this.parts); if (!q) return;
    q.active = true; q.x = x; q.y = y; q.vx = vx; q.vy = vy; q.life = life; q.max = life; q.color = color; q.size = size; q.g = grav;
  };
  P.burst = function (x, y, n, color) {
    for (var k = 0; k < n; k++) {
      var a = rand(0, TAU), s = rand(40, 150);
      this.spawnPart(x, y, Math.cos(a) * s, Math.sin(a) * s - 30, rand(0.35, 0.8), Math.random() < 0.18 ? '#2b2b2b' : color, rand(2, 4.5), 200);
    }
  };
  P.updateParts = function (dt) {
    var c = 0;
    for (var i = 0; i < MAX_PART; i++) {
      var q = this.parts[i]; if (!q.active) continue;
      q.life -= dt; if (q.life <= 0) { q.active = false; continue; }
      q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.97; c++;
    }
    this.partCount = c;
  };
  P.spawnNum = function (x, y, v) {
    if (this.quality < 2) return;
    var n = freeSlot(this.nums); if (!n) return;
    n.active = true; n.x = x + rand(-6, 6); n.y = y; n.v = Math.round(v); n.t = 0;
  };
  P.updateNums = function (dt) {
    for (var i = 0; i < MAX_NUM; i++) { var n = this.nums[i]; if (!n.active) continue; n.t += dt; n.y -= 30 * dt; if (n.t > 0.6) n.active = false; }
  };

  // ---------- 升级三选一 ----------
  P.openLevelUp = function () {
    this.pendingLevels--;
    var reached = this.level - this.pendingLevels, k = AUTO_LEVELS.indexOf(reached); // 本次处理的是升到第几级
    var next = k >= 0 ? this.hero.auto[k] : null;
    if (next && !this.skills[next]) { this.addSkill(next); this.picks++; Sound.play('evolve'); this.flash = Math.max(this.flash, 0.25); }
    else this.autoPower();
  };
  P.buildChoices = function (n) {
    var pool = shuffle(this.newPool()), out = [];
    for (var i = 0; i < pool.length && out.length < n; i++) out.push({ kind: 'skill', id: pool[i] });
    return out;
  };
  P.chooseSkill = function (i) {
    if (this.state !== ST.LEVELUP) return;
    var c = this.choices[i]; if (!c) return;
    this.addSkill(c.id); this.picks++;
    this.setState(ST.PLAY); // 剩余升级由主循环逐帧处理（选满后自动强化，不再弹窗）
  };

  // ---------- 吕不韦货栈 ----------
  P.updateShop = function () {
    if (!this.shop || this.ending) return;
    var p = this.player, dx = p.x - this.shop.x, dy = p.y - this.shop.y, d2 = dx * dx + dy * dy;
    if (d2 < 36 * 36 && this.shop.ready) { this.shop.ready = false; this.openShop(); }
    else if (d2 > 80 * 80) this.shop.ready = true;
  };
  P.openShop = function () {
    this.rollShop(); this.shopMsg = '奇货可居，童叟无欺！'; Sound.play('coin');
    this.setState(ST.SHOP);
  };
  P.rollShop = function () {
    var offers = [];
    if (!this.hasTally) offers.push({ kind: 'tally', cost: 20 });
    var wl = this.skills[this.weaponId()];
    offers.push(wl < WEAPON_MAX ? { kind: 'weapon', cost: 12 + wl * 4 } : { kind: 'power', cost: 18 });
    offers.push({ kind: 'heal', cost: 8 });
    this.shopOffers = offers.slice(0, 3);
  };
  P.buyOffer = function (i) {
    var o = this.shopOffers[i]; if (!o || o.sold) return false;
    if (this.coins < o.cost) { this.shopMsg = '铜钱不够，客官再去割点草～'; return false; }
    if (o.kind === 'up' && (this.skills[o.id] || !this.canPickNew())) return false;
    if (o.kind === 'weapon' && this.skills[this.weaponId()] >= WEAPON_MAX) return false;
    this.coins -= o.cost; o.sold = true; Sound.play('buy');
    if (o.kind === 'tally') { this.hasTally = true; this.shopMsg = this.skills.fireox ? '田单兵符到手！火牛进化！' : '田单兵符到手！拿到火牛冲阵时自动进化'; this.checkEvolve(); }
    else if (o.kind === 'up') { this.addSkill(o.id); this.shopMsg = '新技能「' + SKILLS[o.id].name + '」到手！'; }
    else if (o.kind === 'weapon') { this.autoPower(this.weaponId()); this.shopMsg = SKILLS[this.weaponId()].name + '强化！'; }
    else if (o.kind === 'power') { this.autoPower(this.weaponId()); this.shopMsg = '攻击 +' + Math.round(POWER_STEP * 100) + '%！'; }
    else if (o.kind === 'heal') { this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.5); this.shopMsg = '饱餐一顿，气力恢复！'; }
    return true;
  };
  P.closeShop = function () { if (this.state === ST.SHOP) this.setState(ST.PLAY); };

  // ---------- 结算 ----------
  P.endRun = function (win) {
    var merit = this.kills + (win ? 800 : 0) + Math.floor(this.gameTime);
    var before = rankOf(this.save.merit);
    this.save.merit += merit; this.save.runs++; if (win) this.save.wins++;
    if (this.kills > this.save.best) this.save.best = this.kills;
    writeSave(this.save);
    var after = rankOf(this.save.merit);
    var title;
    if (win) title = this.kills >= 700 ? '一人破万军' : (this.kills >= 350 ? '纸上谈兵终结者' : '长平破阵者');
    else title = this.gameTime >= BOSS_TIME ? '差一步破阵' : (this.gameTime >= 55 ? '纸堆里的硬骨头' : '新卒初阵');
    this.lastResult = { win: win, kills: this.kills, time: this.gameTime, level: this.level, merit: merit, total: this.save.merit, rank: after, rankUp: after > before, title: title, hero: this.hero, skills: this.skillList.slice(), skillLv: JSON.parse(JSON.stringify(this.skills)), evolved: this.evolved };
    this.cardCanvas = this.buildCard(this.lastResult);
    this.timeScale = 1;
    this.setState(ST.RESULT);
  };
  var ART_SPRITES = ['baiqi', 'sunbin', 'paper', 'shield', 'kite', 'elite', 'boss', 'lv', 'ox', 'oxBig'];
  var ART_ICONS = ['halberd', 'bagua', 'swordring', 'crossbow', 'fireox', 'fireox_evo', 'tally'];
  P.applyArt = function () {
    var A = global.QixiongAssets, sp = this.sprites, i, s2;
    if (!A) return;
    for (i = 0; i < ART_SPRITES.length; i++) { s2 = A.makeSpriteSet(ART_SPRITES[i]); if (s2) sp[ART_SPRITES[i]] = s2; } // 缺哪张就保留哪张的代码小人
    s2 = A.makeTile(); if (s2) sp.tile = s2;
    var decos = A.getDecos(); for (i = 0; decos && i < decos.length && i < sp.deco.length; i++) if (decos[i]) sp.deco[i] = decos[i];
    sp.icons = {}; for (i = 0; i < ART_ICONS.length; i++) { s2 = A.getIcon(ART_ICONS[i], 44); if (s2) sp.icons[ART_ICONS[i]] = s2; }
    sp.bgMenu = A.getPicture('bg_menu');
  };
  // 立绘：按区域高度缩放、脚底居中；没有立绘图返回 false
  P.drawPortrait = function (g, id, cx, footY, maxW, maxH, scale) {
    var A = global.QixiongAssets; if (!A) return false;
    var opts = scale ? { scale: scale } : null, c = A.getPicture('portrait_' + id, Math.round(maxH), opts);
    if (!c) return false;
    if (maxW && c.lw > maxW) { c = A.getPicture('portrait_' + id, Math.round(maxH * maxW / c.lw), opts); if (!c) return false; }
    g.drawImage(c, cx - c.lw / 2, footY - c.lh, c.lw, c.lh);
    return true;
  };
  P.drawHero = function (g, id, x, y, sc, t, face, moving) {
    var spr = this.sprites[id], k = 1, A = global.QixiongAssets;
    if (spr.art && sc !== 1 && A) { // 放大显示时按最终尺寸重新预缩放，避免马赛克
      var big = A.makeSpriteSet(id, Math.round(spr.h * sc), { scale: g === this.ctx ? this.dpr : 1 });
      if (big) { spr = big; k = sc; sc = 1; }
    }
    var img = face === 0 ? spr.l : spr.r;
    var w = spr.w * sc, h = spr.h * sc, bob = moving ? Math.abs(Math.sin(t)) * 2 * sc * k : 0;
    g.imageSmoothingEnabled = false;
    if (id === 'baiqi' && !spr.art) {
      var side = face === 0 ? -1 : 1, hx = x + side * 13 * sc, hy = y - 4 * sc - bob, tx = x + side * 17 * sc, ty = y - 60 * sc - bob;
      g.strokeStyle = '#5a3a1e'; g.lineWidth = 3 * sc; g.beginPath(); g.moveTo(hx, hy); g.lineTo(tx, ty); g.stroke();
      g.fillStyle = '#d8dee3'; g.beginPath(); g.moveTo(tx - 3 * sc, ty); g.lineTo(tx + 3 * sc, ty); g.lineTo(tx, ty - 11 * sc); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(tx, ty + 4 * sc); g.quadraticCurveTo(tx + side * 12 * sc, ty + 2 * sc, tx + side * 10 * sc, ty + 13 * sc); g.lineTo(tx, ty + 9 * sc); g.closePath(); g.fill();
      g.fillStyle = '#c0392b'; g.fillRect(tx - 3 * sc, ty + 10 * sc, 6 * sc, 4 * sc);
    }
    if (spr.art && moving) { // 单帧图的走路感：轻微左右摆 + 落地压扁
      var sq = 1 - Math.abs(Math.cos(t)) * 0.05;
      g.save(); g.translate(x, y - bob); g.rotate(Math.sin(t) * 0.06); g.drawImage(img, -w / 2, -h * sq, w, h * sq); g.restore();
    } else g.drawImage(img, x - w / 2, y - h - bob, w, h);
    if (id === 'sunbin' && !spr.art) {
      var rot = t * 0.6;
      for (var s = -1; s <= 1; s += 2) {
        var cx = x + s * 15 * sc, cy = y - 7 * sc, R = 7.5 * sc;
        g.strokeStyle = OUT; g.lineWidth = 4.5 * sc; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
        g.strokeStyle = '#a0692f'; g.lineWidth = 2.5 * sc; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
        g.lineWidth = 1.2 * sc; g.beginPath();
        for (var k = 0; k < 4; k++) { var a = rot + k * Math.PI / 4; g.moveTo(cx - Math.cos(a) * R, cy - Math.sin(a) * R); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); }
        g.stroke();
        g.fillStyle = '#5a3a1e'; g.fillRect(cx - 1.5 * sc, cy - 1.5 * sc, 3 * sc, 3 * sc);
      }
    }
  };
  P.buildCard = function (r) {
    var c = document.createElement('canvas'); c.width = 750; c.height = 1334;
    var self = this, next = r.rank + 1 < 20 ? RANK_NEED[r.rank + 1] : 0, prev = r.rank >= 0 ? RANK_NEED[r.rank] : 0;
    UI.reportCard(c.getContext('2d'), {
      win: r.win, heroName: r.hero.name, heroTitle: r.hero.title.split(' · ')[1],
      kills: r.kills, time: r.time, level: r.level, merit: r.merit,
      rankName: rankName(r.rank), rankUp: r.rankUp,
      rankSub: (r.rank >= 0 ? '秦二十等军功爵 · 第 ' + (r.rank + 1) + ' 级' : '秦二十等军功爵') + ' · 累计军功 ' + r.total,
      nextText: next ? '距「' + RANKS[r.rank + 1] + '」还差 ' + (next - r.total) : '',
      nextProgress: next ? clamp((r.total - prev) / (next - prev), 0, 1) : null,
      title: r.title, stage: '长平 · 纸上谈兵', portraitBg: r.hero.id === 'baiqi' ? '#8aa6d8' : '#7fd6c0',
      portrait: function (pg, cx, footY, sc) { if (!self.drawPortrait(pg, r.hero.id, cx, footY, 300, 330, 1)) self.drawHero(pg, r.hero.id, cx, footY, sc, 0, 1, false); }
    });
    return c;
  };
  // ================= 渲染 =================
  P.render = function () {
    var g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    this.buttons = [];
    if (this.state === ST.MENU) this.renderMenu(g);
    else if (this.state === ST.SELECT) this.renderSelect(g);
    else {
      this.renderWorld(g);
      this.renderHud(g);
      if (this.state === ST.LEVELUP) this.renderLevelUp(g);
      else if (this.state === ST.SHOP) this.renderShop(g);
      else if (this.state === ST.RESULT) this.renderResult(g);
      else if (this.state === ST.PAUSE) this.renderPause(g);
    }
    if (this.debug.showFps) txt(g, 'FPS ' + this.fps + ' 敌 ' + (this.activeE || 0) + ' Q' + this.quality, 8, this.H - 10, 11, '#0f0', 'left', '#000');
  };
  P.button = function (g, x, y, w, h, label, fn, style) {
    var st = style === 'dark' ? 'wood' : (style || 'primary');
    var r = UI.button(g, x, y, w, h, label, { style: st });
    if (fn) this.buttons.push({ x: r.x, y: r.y, w: r.w, h: r.h, fn: fn, label: label });
    return r;
  };
  P.drawBgPlain = function (g) { UI.sceneBg(g, this.W, this.H, this.time, { groundY: 0.72 }); };
  P.renderMenu = function (g) {
    var W = this.W, H = this.H, self = this, t = this.time, i;
    if (!this.artReady) { UI.loadingScreen(g, W, H, this.artLoad, { time: t, tip: '整军中…' }); return; } // 图未就绪不放按钮
    var bm = this.sprites.bgMenu;
    if (bm) { var bk = Math.max(W / bm.lw, H / bm.lh); g.drawImage(bm, (W - bm.lw * bk) / 2, (H - bm.lh * bk) / 2, bm.lw * bk, bm.lh * bk); }
    else UI.sceneBg(g, W, H, t, { groundY: 0.72 });
    UI.titleText(g, '横扫六国', W / 2, H * 0.17, Math.min(66, W * 0.17), { maxW: W - 20, sparkle: true });
    UI.label(g, '一人破万军 · 手指一拖，刀枪自砍', W / 2, H * 0.17 + 56, { size: 15, color: '#ffffff', weight: '900' });
    this.drawHero(g, 'baiqi', W * 0.32, H * 0.84, 2.2, t * 6, 1, true);
    this.drawHero(g, 'sunbin', W * 0.68, H * 0.84, 2.2, t * 6, 0, true);
    var pp = this.sprites.paper;
    for (i = 0; i < 7; i++) {
      var px = ((i * 70 + t * 40) % (W + 80)) - 40, py = H * 0.9 + (i % 3) * 12;
      g.drawImage(pp.r, px - pp.w / 2, py - pp.h - Math.abs(Math.sin(t * 8 + i)) * 3, pp.w, pp.h);
    }
    var bw = Math.min(260, W - 80);
    this.button(g, (W - bw) / 2, H * 0.38, bw, 64, '开始出征', function () { self.setState(ST.SELECT); });
    var rk = rankOf(this.save.merit), iw = Math.min(300, W - 40), iy = H * 0.38 + 84;
    UI.panel(g, (W - iw) / 2, iy, iw, 58, { kind: 'paper', corners: false });
    UI.label(g, '当前爵位：' + rankName(rk) + '　累计军功 ' + this.save.merit, W / 2, iy + 19, { size: 13, color: UI.PAL.text, stroke: null, weight: '900' });
    UI.label(g, '关卡：长平 · 纸上谈兵（约 1 分 50 秒）', W / 2, iy + 38, { size: 12, color: UI.PAL.textSub, stroke: null });
    UI.label(g, '戏说战国，非史实', W / 2, H - 16, { size: 11, color: '#fff6dc', stroke: 'rgba(120,60,20,0.6)' });
  };
  P.renderSelect = function (g) {
    var W = this.W, H = this.H, self = this, i;
    UI.sceneBg(g, W, H, this.time, { groundY: 0.9 });
    UI.titleText(g, '择将出征', W / 2, 50, 38, { maxW: W - 40 });
    UI.label(g, '两人手感完全不同，点卡片选择', W / 2, 90, { size: 13, color: '#ffffff', weight: '900' });
    var top = 116, bottom = H - 100, ch = Math.min(250, (bottom - top - 18) / 2);
    var STATS = [[['体魄', 4], ['脚力', 4]], [['体魄', 3], ['脚力', 2]]], BG = ['#8aa6d8', '#7fd6c0'];
    for (i = 0; i < 2; i++) {
      (function (idx) {
        var h = HEROES[idx], sel = self.selHero === idx;
        var r = UI.heroCard(g, 16, top + idx * (ch + 18), W - 32, ch, {
          name: h.name, title: h.title, selected: sel, portraitBg: BG[idx], stats: STATS[idx],
          lines: [{ text: h.l1 }, { text: h.l2 }, { text: h.l3, color: '#e2452c' }, { text: h.l4, color: '#2a8fc0' }],
          portrait: function (pg, cx, footY, aw, ah) {
            var sc = Math.min(2.4, (ah - 16) / 55) * (h.id === 'sunbin' ? 1.1 : 1);
            if (!self.drawPortrait(pg, h.id, cx, footY, aw - 8, ah - 10)) self.drawHero(pg, h.id, cx, footY, sc, self.time * 6, 1, sel);
          }
        });
        self.buttons.push({ x: r.x, y: r.y, w: r.w, h: r.h, fn: function () { self.selHero = idx; } });
      })(i);
    }
    var bw = Math.min(290, W - 50);
    this.button(g, (W - bw) / 2, H - 84, bw, 62, '出征长平 · ' + HEROES[this.selHero].name, function () { self.startRun(self.selHero); });
  };
  P.renderWorld = function (g) {
    var W = this.W, H = this.H, p = this.player, sp = this.sprites, i, k;
    var sx = this.shake > 0 ? rand(-this.shake, this.shake) : 0, sy = this.shake > 0 ? rand(-this.shake, this.shake) : 0;
    var camX = p.x - W / 2 + sx, camY = p.y - H / 2 + sy;
    this.camX = camX; this.camY = camY;
    // 地面
    var tile = sp.tile, ts = tile.lw || tile.width, ox = -((camX % ts) + ts) % ts, oy = -((camY % ts) + ts) % ts;
    for (var ty = oy; ty < H; ty += ts) for (var tx = ox; tx < W; tx += ts) g.drawImage(tile, tx, ty, ts, ts);
    // 装饰
    var CS = 220, c0 = Math.floor(camX / CS) - 1, c1 = Math.floor((camX + W) / CS) + 1, r0 = Math.floor(camY / CS) - 1, r1 = Math.floor((camY + H) / CS) + 1;
    for (var cy = r0; cy <= r1; cy++) for (var cx = c0; cx <= c1; cx++) {
      var hsh = ((cx * 73856093) ^ (cy * 19349663)) >>> 0;
      if (hsh % 10 < 4) { var dimg = sp.deco[hsh % 5]; g.drawImage(dimg, Math.floor(cx * CS + (hsh % 157) - camX), Math.floor(cy * CS + ((hsh >> 8) % 157) - camY), dimg.lw || dimg.width, dimg.lh || dimg.height); }
    }
    g.save(); g.translate(-camX, -camY);
    // 货栈
    if (this.shop) this.drawShop(g, this.shop.x, this.shop.y);
    // 书页预警圈
    for (i = 0; i < this.pages.length; i++) {
      var pg = this.pages[i], pr = pg.t / pg.dur;
      g.fillStyle = 'rgba(220,40,30,' + (0.12 + pr * 0.2) + ')'; g.beginPath(); g.arc(pg.tx, pg.ty, 44, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,70,50,0.9)'; g.lineWidth = 2; g.beginPath(); g.arc(pg.tx, pg.ty, 44, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(255,90,60,0.35)'; g.beginPath(); g.arc(pg.tx, pg.ty, 44 * pr, 0, TAU); g.fill();
    }
    // Boss 冲锋预警
    if (this.boss && this.bossAI && this.bossAI.mode === 'aim') {
      var b = this.boss, ang = Math.atan2(this.bossAI.diry, this.bossAI.dirx);
      g.save(); g.translate(b.x, b.y); g.rotate(ang);
      g.fillStyle = 'rgba(255,40,30,' + (0.2 + 0.15 * Math.sin(this.time * 30)) + ')'; g.fillRect(0, -26, 310, 52);
      g.restore();
    }
    // Boss「兵书缚身」：预警圈（内圈收缩到外圈 = 开始吸）、吸附旋涡、竹简锁链
    if (this.boss && this.bossAI && /^(pullAim|pull|bind)$/.test(this.bossAI.mode)) {
      var bb = this.boss, bm = this.bossAI.mode, pul = 0.5 + 0.5 * Math.sin(this.time * 18);
      if (bm !== 'bind') {
        g.fillStyle = 'rgba(140,60,210,' + (bm === 'pull' ? 0.22 : 0.1 + 0.08 * pul) + ')'; g.beginPath(); g.arc(bb.x, bb.y, PULL_R, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(200,120,255,0.95)'; g.lineWidth = 3; g.beginPath(); g.arc(bb.x, bb.y, PULL_R, 0, TAU); g.stroke();
        if (bm === 'pullAim') { var prog = 1 - this.bossAI.t / PULL_WIND; g.strokeStyle = 'rgba(255,230,120,0.9)'; g.lineWidth = 4; g.beginPath(); g.arc(bb.x, bb.y, PULL_R * (0.15 + 0.85 * prog), 0, TAU); g.stroke(); }
        else for (k = 0; k < 4; k++) { var sa = -this.time * 7 + k * TAU / 4; g.strokeStyle = 'rgba(230,190,255,0.7)'; g.lineWidth = 3; g.beginPath(); g.arc(bb.x, bb.y, PULL_R * (0.35 + 0.15 * k), sa, sa + 1.2); g.stroke(); }
      }
      if (bm === 'bind' || this.pulled) {
        var cx = p.x - bb.x, cy = p.y - 12 - bb.y, cl = Math.sqrt(cx * cx + cy * cy) || 1, segs = Math.max(3, Math.floor(cl / 14));
        for (k = 0; k < segs; k++) { // 一节节竹简
          var u = (k + 0.5) / segs, wob = Math.sin(this.time * 20 + k) * 2;
          g.save(); g.translate(bb.x + cx * u - cy / cl * wob, bb.y + cy * u + cx / cl * wob); g.rotate(Math.atan2(cy, cx));
          g.fillStyle = '#e9cd7c'; g.fillRect(-6, -4, 11, 8); g.strokeStyle = '#7a4a1c'; g.lineWidth = 1.5; g.strokeRect(-6, -4, 11, 8); g.restore();
        }
        if (bm === 'bind') { g.strokeStyle = 'rgba(255,214,90,' + (0.6 + 0.4 * pul) + ')'; g.lineWidth = 4; g.beginPath(); g.ellipse(p.x, p.y - 14, 24, 30, 0, 0, TAU); g.stroke(); }
      }
    }
    // 八卦阵、震波（地面层）
    for (i = 0; i < MAX_FX; i++) {
      var f = this.fx[i]; if (!f.active || f.delay > 0) continue;
      if (f.type === 'bagua') {
        var a = f.t < 0.15 ? f.t / 0.15 : (f.t > f.dur - 0.2 ? (f.dur - f.t) / 0.2 : 1);
        g.globalAlpha = clamp(a, 0, 1); g.save(); g.translate(f.x, f.y); g.rotate(f.t * 2.4);
        var sz = f.r * 2 * (64 + 4) / 64; g.drawImage(sp.bagua, -sz / 2, -sz / 2, sz, sz); g.restore(); g.globalAlpha = 1;
      } else if (f.type === 'mega') {
        g.globalAlpha = clamp(1 - f.t / f.dur, 0, 1) * 0.6; g.save(); g.translate(f.x, f.y); g.rotate(-f.t * 1.5);
        g.drawImage(sp.bagua, -f.r, -f.r, f.r * 2, f.r * 2); g.restore(); g.globalAlpha = 1;
      } else if (f.type === 'ring') {
        var al = 1 - f.t / f.dur;
        g.strokeStyle = 'rgba(255,214,90,' + clamp(al, 0, 1) + ')'; g.lineWidth = 6; g.beginPath(); g.arc(f.x, f.y, f.r, 0, TAU); g.stroke();
        g.strokeStyle = 'rgba(255,240,180,' + clamp(al * 0.6, 0, 1) + ')'; g.lineWidth = 2; g.beginPath(); g.arc(f.x, f.y, f.r * 0.8, 0, TAU); g.stroke();
      }
    }
    // 掉落
    for (i = 0; i < MAX_DROP; i++) {
      var d = this.drops[i]; if (!d.active) continue;
      if (d.x < camX - 20 || d.x > camX + W + 20 || d.y < camY - 20 || d.y > camY + H + 20) continue;
      if (d.type === 0) this.drawGem(g, d);
      else if (d.type === 1) { g.fillStyle = OUT; g.beginPath(); g.arc(d.x, d.y, 6, 0, TAU); g.fill(); g.fillStyle = '#d9a521'; g.beginPath(); g.arc(d.x, d.y, 5, 0, TAU); g.fill(); g.fillStyle = OUT; g.fillRect(d.x - 1.5, d.y - 1.5, 3, 3); }
      else if (d.type === 2) { g.fillStyle = OUT; g.fillRect(d.x - 7, d.y - 4, 14, 9); g.fillStyle = '#7a4a26'; g.fillRect(d.x - 6, d.y, 12, 4); g.fillStyle = '#f6e7b0'; g.fillRect(d.x - 5, d.y - 3, 10, 4); }
      else { g.fillStyle = OUT; g.fillRect(d.x - 8, d.y - 5, 16, 10); g.fillStyle = '#f1c40f'; g.fillRect(d.x - 7, d.y - 4, 14, 8); g.fillStyle = '#9a6a00'; g.fillRect(d.x - 1, d.y - 4, 2, 8); }
    }
    // 阴影
    if (this.quality > 0) {
      g.fillStyle = 'rgba(40,25,10,0.25)';
      for (i = 0; i < MAX_E; i++) { var e = this.enemies[i]; if (!e.active || e.type === 2) continue; g.fillRect(e.x - e.r, e.y - 2, e.r * 2, 4); }
    }
    // 敌人
    var t = this.time;
    for (i = 0; i < MAX_E; i++) {
      var en = this.enemies[i]; if (!en.active) continue;
      if (en.x < camX - 60 || en.x > camX + W + 60 || en.y < camY - 20 || en.y > camY + H + 90) continue;
      var s = sp[ETYPES[en.type].spr], img;
      if (en.flash > 0) img = en.face ? s.wr : s.wl; else img = en.face ? s.r : s.l;
      var bob = en.type === 2 ? Math.sin(t * 4 + en.seed) * 4 + 14 : (en.frozen > 0 ? 0 : Math.abs(Math.sin(t * 9 + en.seed)) * 2);
      if (en.type === 4) bob = Math.sin(t * 3) * 4 + 10;
      var dx0 = Math.floor(en.x - s.w / 2), dy0 = Math.floor(en.y - s.h - bob);
      if (en.dieT > 0) g.globalAlpha = 0.7;
      g.drawImage(img, dx0, dy0, s.w, s.h);
      if (en.frozen > 0) { g.globalAlpha = 0.5; g.drawImage(en.face ? s.ir : s.il, dx0, dy0, s.w, s.h); }
      g.globalAlpha = 1;
      if (en.type === 3) { g.fillStyle = '#300'; g.fillRect(en.x - 16, dy0 - 6, 32, 4); g.fillStyle = '#e74c3c'; g.fillRect(en.x - 16, dy0 - 6, 32 * Math.max(0, en.hp / en.maxHp), 4); }
    }
    // 火牛
    for (i = 0; i < MAX_OX; i++) {
      var o = this.oxen[i]; if (!o.active) continue;
      var os = o.big ? sp.oxBig : sp.ox, oimg = o.vx < 0 ? os.l : os.r;
      g.drawImage(oimg, Math.floor(o.x - os.w / 2), Math.floor(o.y - os.h - Math.abs(Math.sin(t * 20 + i)) * 2), os.w, os.h);
    }
    // 玩家光圈与英雄
    g.strokeStyle = 'rgba(255,215,90,0.75)'; g.lineWidth = 2; g.beginPath(); g.ellipse(p.x, p.y, 16, 6, 0, 0, TAU); g.stroke();
    this.drawHero(g, this.hero.id, p.x, p.y, 1, p.walkT, p.face, p.moving);
    if (p.hurtT > 0) { g.globalAlpha = 0.5; var hs = sp[this.hero.id]; g.drawImage(p.face ? hs.wr : hs.wl, p.x - hs.w / 2, p.y - hs.h, hs.w, hs.h); g.globalAlpha = 1; }
    g.fillStyle = '#300'; g.fillRect(p.x - 17, p.y + 5, 34, 5); g.fillStyle = p.hp / p.maxHp < 0.3 ? '#ff5a4a' : '#5fe06a'; g.fillRect(p.x - 17, p.y + 5, 34 * clamp(p.hp / p.maxHp, 0, 1), 5);
    // 剑气环
    if (this.skills.swordring) {
      var sc2 = this.skills.swordring + 1;
      g.strokeStyle = 'rgba(120,255,190,0.18)'; g.lineWidth = 8; g.beginPath(); g.arc(p.x, p.y - 10, 58, 0, TAU); g.stroke();
      for (k = 0; k < sc2; k++) {
        var aa = this.swordAng + k * TAU / sc2, bx = p.x + Math.cos(aa) * 58, by = p.y - 10 + Math.sin(aa) * 58;
        g.save(); g.translate(bx, by); g.rotate(aa + Math.PI / 2);
        g.fillStyle = OUT; g.fillRect(-3, -12, 6, 22); g.fillStyle = '#9fe3c0'; g.fillRect(-2, -11, 4, 14); g.fillStyle = '#b8860b'; g.fillRect(-4, 3, 8, 3); g.fillStyle = '#5a3a1e'; g.fillRect(-1, 6, 2, 4);
        g.restore();
      }
    }
    // 援军
    for (i = 0; i < this.allies.length; i++) {
      var al2 = this.allies[i], nc = NATION[al2.nation][1], lunge = al2.anim > 0 ? 4 * al2.dir : 0;
      g.fillStyle = OUT; g.fillRect(al2.x - 5 + lunge, al2.y - 15, 10, 15);
      g.fillStyle = nc; g.fillRect(al2.x - 4 + lunge, al2.y - 9, 8, 8);
      g.fillStyle = '#e8c09a'; g.fillRect(al2.x - 3 + lunge, al2.y - 14, 6, 5);
      g.fillStyle = '#5a3a1e'; g.fillRect(al2.x - al2.dir * 6, al2.y - 24, 2, 22);
      g.fillStyle = nc; g.fillRect(al2.x - al2.dir * 6 + (al2.dir < 0 ? 2 : -7), al2.y - 24, 7, 6);
      g.fillStyle = '#cfd8dc'; g.fillRect(al2.x + al2.dir * 5 + lunge, al2.y - 10, al2.dir * 9, 2);
    }
    // 机关鸟
    for (i = 0; i < this.birds.length; i++) {
      var bd = this.birds[i], fl = Math.sin(t * 24 + i) * 4;
      g.fillStyle = OUT; g.fillRect(bd.x - 6, bd.y - 3, 12, 6);
      g.fillStyle = '#a1774f'; g.fillRect(bd.x - 5, bd.y - 2, 10, 4);
      g.fillStyle = '#7a5230'; g.beginPath(); g.moveTo(bd.x - 2, bd.y - 1); g.lineTo(bd.x - 9, bd.y - 5 - fl); g.lineTo(bd.x + 2, bd.y - 1); g.fill();
      g.beginPath(); g.moveTo(bd.x - 2, bd.y - 1); g.lineTo(bd.x + 7, bd.y - 5 - fl); g.lineTo(bd.x + 2, bd.y - 1); g.fill();
      g.fillStyle = '#f1c40f'; g.fillRect(bd.x + (bd.dir || 1) * 5, bd.y - 1, (bd.dir || 1) * 3, 2);
    }
    // 弩箭
    g.lineWidth = 2;
    for (i = 0; i < MAX_SHOT; i++) {
      var sh = this.shots[i]; if (!sh.active) continue;
      var cs = Math.cos(sh.ang), sn = Math.sin(sh.ang);
      g.strokeStyle = sh.kind ? '#1e6b4f' : '#3a2410'; g.beginPath(); g.moveTo(sh.x - cs * 12, sh.y - sn * 12); g.lineTo(sh.x, sh.y); g.stroke();
      g.fillStyle = '#eef'; g.fillRect(sh.x - 1.5, sh.y - 1.5, 3, 3);
    }
    // 纸镖
    for (i = 0; i < MAX_ESHOT; i++) {
      var es = this.eshots[i]; if (!es.active) continue;
      g.fillStyle = OUT; g.fillRect(es.x - 4, es.y - 4, 8, 8); g.fillStyle = '#ffffff'; g.fillRect(es.x - 3, es.y - 3, 6, 6); g.fillStyle = '#c0392b'; g.fillRect(es.x - 1, es.y - 1, 2, 2);
    }
    // 飞行书页
    for (i = 0; i < this.pages.length; i++) {
      var pg2 = this.pages[i], q = pg2.t / pg2.dur, px = pg2.x0 + (pg2.tx - pg2.x0) * q, py = pg2.y0 + (pg2.ty - pg2.y0) * q - Math.sin(q * Math.PI) * 110;
      g.save(); g.translate(px, py); g.rotate(pg2.rot);
      g.fillStyle = OUT; g.fillRect(-9, -11, 18, 22); g.fillStyle = '#f4ecd6'; g.fillRect(-8, -10, 16, 20); g.fillStyle = '#555'; g.fillRect(-5, -6, 10, 1); g.fillRect(-5, -2, 10, 1); g.fillRect(-5, 2, 7, 1);
      g.restore();
    }
    // 横扫特效
    for (i = 0; i < MAX_FX; i++) {
      var fx = this.fx[i]; if (!fx.active || fx.delay > 0) continue;
      if (fx.type === 'sweep') {
        var pr2 = fx.t / fx.dur, start = fx.ang - fx.arc / 2, cur = start + fx.arc * Math.min(1, pr2 * 1.6);
        g.globalAlpha = clamp(1 - pr2, 0, 1);
        g.fillStyle = 'rgba(255,245,230,0.55)'; g.beginPath(); g.moveTo(fx.x, fx.y); g.arc(fx.x, fx.y, fx.r, start, cur); g.closePath(); g.fill();
        g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.beginPath(); g.arc(fx.x, fx.y, fx.r - 3, start, cur); g.stroke();
        g.strokeStyle = '#ff5a4a'; g.lineWidth = 2; g.beginPath(); g.arc(fx.x, fx.y, fx.r * 0.7, start, cur); g.stroke();
        g.globalAlpha = 1;
      } else if (fx.type === 'ult') {
        var pr3 = fx.t / fx.dur;
        g.globalAlpha = clamp(1 - pr3, 0, 1);
        g.strokeStyle = '#ff3b2a'; g.lineWidth = 12; g.beginPath(); g.arc(fx.x, fx.y, 210 * Math.min(1, pr3 * 3), 0, TAU); g.stroke();
        g.strokeStyle = '#fff3d0'; g.lineWidth = 4; g.beginPath(); g.arc(fx.x, fx.y, 150 * Math.min(1, pr3 * 3), fx.t * 20, fx.t * 20 + 4); g.stroke();
        g.globalAlpha = 1;
      }
    }
    // 粒子
    for (i = 0; i < MAX_PART; i++) {
      var pa = this.parts[i]; if (!pa.active) continue;
      g.globalAlpha = clamp(pa.life / pa.max * 1.5, 0, 1); g.fillStyle = pa.color; g.fillRect(pa.x, pa.y, pa.size, pa.size);
    }
    g.globalAlpha = 1;
    // 伤害数字
    for (i = 0; i < MAX_NUM; i++) {
      var nm = this.nums[i]; if (!nm.active) continue;
      g.globalAlpha = clamp(1 - nm.t / 0.6, 0, 1);
      txt(g, String(nm.v), nm.x, nm.y, nm.v >= 60 ? 15 : 11, nm.v >= 60 ? '#ffd54a' : '#ffffff', 'center', '#2a1a10');
    }
    g.globalAlpha = 1;
    // Boss 台词
    if (this.boss && this.bossAI && this.bossAI.sayLeft > 0) UI.bubble(g, this.bossAI.say, this.boss.x, this.boss.y - 80);
    g.restore();
    // 货栈方向指示
    if (this.shop && this.state === ST.PLAY) {
      var sdx = this.shop.x - p.x, sdy = this.shop.y - p.y;
      if (Math.abs(sdx) > W / 2 - 20 || Math.abs(sdy) > H / 2 - 20) {
        var sa = Math.atan2(sdy, sdx), ix = clamp(W / 2 + Math.cos(sa) * W, 26, W - 26), iy = clamp(H / 2 + Math.sin(sa) * H, 90, H - 110);
        g.save(); g.translate(ix, iy); g.rotate(sa); g.fillStyle = '#d7b2ff'; g.beginPath(); g.moveTo(12, 0); g.lineTo(-6, -8); g.lineTo(-6, 8); g.closePath(); g.fill(); g.restore();
        txt(g, '货栈', ix, iy + 16, 11, '#f2e2ff', 'center', '#2a1040');
      }
    }
    if (this.flash > 0) { g.fillStyle = 'rgba(255,250,235,' + clamp(this.flash, 0, 0.8) + ')'; g.fillRect(0, 0, W, H); }
  };
  P.drawShop = function (g, x, y) {
    var t = this.time;
    g.fillStyle = 'rgba(40,25,10,0.3)'; g.fillRect(x - 36, y + 2, 72, 6);
    g.fillStyle = OUT; g.fillRect(x - 36, y - 26, 72, 28);
    g.fillStyle = '#8a5a2b'; g.fillRect(x - 34, y - 24, 68, 24);
    g.fillStyle = '#6b4423'; g.fillRect(x - 34, y - 12, 68, 3);
    var lv = this.sprites.lv; g.drawImage(lv.r, x - lv.w / 2, y - 24 - lv.h + 10, lv.w, lv.h);
    g.fillStyle = OUT; g.fillRect(x - 32, y - 66, 3, 42); g.fillRect(x + 29, y - 66, 3, 42);
    for (var k = 0; k < 6; k++) { g.fillStyle = k % 2 ? '#e0b040' : '#b83a2a'; g.fillRect(x - 40 + k * 13.3, y - 72, 13.3, 12); }
    g.fillStyle = OUT; g.fillRect(x - 40, y - 60, 80, 2);
    g.fillStyle = '#3a2414'; rr(g, x - 32, y - 92, 64, 18, 3); g.fill();
    txt(g, '奇货可居', x, y - 83, 11, '#f2cf7a', 'center');
    for (k = 0; k < 3; k++) { var cx = x - 20 + k * 16, cy = y - 20 - Math.abs(Math.sin(t * 3 + k)) * 3; g.fillStyle = '#d9a521'; g.beginPath(); g.arc(cx, cy, 4, 0, TAU); g.fill(); }
  };
  P.renderHud = function (g) {
    var W = this.W, H = this.H, p = this.player, i, b;
    // 顶部状态条（含经验细条；右侧 W-94 以外留给 DOM 暂停键 + 声音键）
    UI.topBar(g, 6, 10, W - 100, { level: this.level, kills: this.kills, time: this.gameTime, coins: this.coins, exp: this.exp / this.expNeed });
    if (this.hero.id === 'baiqi') UI.label(g, '杀意 +' + Math.round(this.killBonus() * 100) + '%', 12, 58, { size: 12, color: '#ffd0c4', align: 'left', weight: '900' });
    // Boss 血条（lag 为受击残影，缓慢追上真实血量）
    if (this.boss) {
      b = this.boss;
      var hpf = clamp(b.hp / b.maxHp, 0, 1);
      if (this.bossLag === undefined || this.bossLag < hpf) this.bossLag = hpf; else this.bossLag += (hpf - this.bossLag) * 0.06;
      UI.bossBar(g, 14, 68, W - 28, { name: '赵括 · 纸上谈兵', hp: hpf, lag: this.bossLag });
    } else this.bossLag = undefined;
    // 横幅：从 Boss 条下方开始排，矮屏缩小
    var shortH = H < 700, bTop = Math.max(H * 0.22, 152), bGap = shortH ? 60 : 74, bSize = shortH ? 19 : 22;
    for (i = 0; i < (this.state === ST.PLAY ? this.banners.length : 0); i++) {
      var bn = this.banners[i], a = bn.t < 0.25 ? bn.t / 0.25 : (bn.t > bn.dur - 0.4 ? (bn.dur - bn.t) / 0.4 : 1);
      var kind = bn.text.indexOf('破 · ') === 0 ? 'big' : (/^(获得|进化)/.test(bn.text) || /^#(9cff9c|6ff3e0|bfe9ff|cfe8ff)$/i.test(bn.color) ? 'gain' : (/^#ff[5-8]/i.test(bn.color) ? 'warn' : 'info'));
      var big = kind === 'big', by = big ? H * 0.36 : bTop + (this.banners.length - 1 - i) * bGap;
      UI.bannerText(g, bn.text, W / 2, by, { kind: kind, sub: bn.sub, alpha: clamp(a, 0, 1), scale: big ? 1 + Math.max(0, 0.6 - bn.t) * 1.5 : 1, maxW: W - 24, size: big ? (shortH ? 28 : 34) : bSize });
    }
    // 技能栏（如 assets.js 提供技能图标，传 img 与 imgKey 即可替换色块单字）
    var IS = 44, ix = 8, iy = H - 142, sr;
    for (i = 0; i < this.skillList.length; i++) {
      var id = this.skillList[i], sk = SKILLS[id], ev = id === 'fireox' && this.evolved;
      var ik = ev ? 'fireox_evo' : id, icn = this.sprites.icons && this.sprites.icons[ik];
      sr = UI.skillSlot(g, ix, iy, IS, { ch: ev ? '焰' : sk.ch, name: ev ? '火牛阵' : sk.short, color: ev ? '#ff6a00' : sk.color, evolved: ev, time: this.time, img: icn, imgKey: icn ? ik : '' });
      ix += sr.w + 2;
    }
    if (this.hasTally) { var tic = this.sprites.icons && this.sprites.icons.tally; UI.skillSlot(g, ix, iy, IS, { ch: '符', name: '兵符', color: '#d9a521', time: this.time, img: tic, imgKey: tic ? 'tally' : '' }); }
    // 怒气
    var full = this.rage >= this.rageMax;
    UI.rageBar(g, 46, H - 44, W - 92, { value: this.rage / this.rageMax, full: full, time: this.time, hint: full && this.state === ST.PLAY ? '怒气已满 · 双击屏幕释放「' + this.hero.ult + '」' : '' });
    // 摇杆
    if (this.joy.active && this.state === ST.PLAY) {
      var jdx = this.joy.x - this.joy.bx, jdy = this.joy.y - this.joy.by, jd = Math.sqrt(jdx * jdx + jdy * jdy), jm = Math.min(jd, 46);
      var kx = this.joy.bx + (jd ? jdx / jd * jm : 0), ky = this.joy.by + (jd ? jdy / jd * jm : 0);
      g.fillStyle = 'rgba(255,240,210,0.14)'; g.beginPath(); g.arc(this.joy.bx, this.joy.by, 48, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,240,210,0.45)'; g.lineWidth = 2; g.beginPath(); g.arc(this.joy.bx, this.joy.by, 48, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(242,207,122,0.6)'; g.beginPath(); g.arc(kx, ky, 20, 0, TAU); g.fill();
    }
    if (!this.moved && this.gameTime < 12 && this.state === ST.PLAY) {
      var hy = H * 0.68, hx = W / 2 + Math.sin(this.time * 3) * 40;
      UI.toast(g, '按住屏幕任意处拖动走位 · 攻击全自动', W / 2, hy);
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(hx, hy + 40, 10, 0, TAU); g.fill();
    }
  };
  P.drawCard = function (g, x, y, w, h, icon, color, name, tag, desc, gold) {
    g.fillStyle = gold ? '#fff0c8' : '#f3e6c4'; rr(g, x, y, w, h, 10); g.fill();
    g.strokeStyle = gold ? '#e0a020' : '#8a6a3a'; g.lineWidth = gold ? 3 : 2; rr(g, x, y, w, h, 10); g.stroke();
    var isz = Math.min(52, h - 24);
    g.fillStyle = color; rr(g, x + 12, y + (h - isz) / 2, isz, isz, 8); g.fill();
    txt(g, icon, x + 12 + isz / 2, y + h / 2, isz * 0.5, '#ffffff', 'center', 'rgba(0,0,0,0.35)');
    var tx = x + isz + 24, tw = w - isz - 34;
    txt(g, name, tx, y + 24, 17, '#3a2414', 'left');
    if (tag) txt(g, tag, x + w - 12, y + 24, 13, tag === '新！' ? '#c0392b' : '#7a5a2a', 'right');
    g.font = 'normal 13px ' + FONT;
    var lines = wrapLines(g, desc, tw);
    for (var i = 0; i < Math.min(2, lines.length); i++) txt(g, lines[i], tx, y + 50 + i * 18, 13, '#5a4030', 'left', null, FONT, 'normal');
  };
  P.renderLevelUp = function (g) {
    var W = this.W, H = this.H, self = this;
    UI.dim(g, W, H, 0.7);
    UI.titleText(g, '选一个新技能', W / 2, H * 0.18, 36, { maxW: W - 30 });
    UI.label(g, '第 ' + (this.picks + 1) + ' / ' + MAX_SKILLS + ' 个 · 拿到就是完整效果', W / 2, H * 0.18 + 42, { size: 13, color: '#ffffff', weight: '900' });
    var ch = 92, y0 = H * 0.18 + 70;
    for (var i = 0; i < this.choices.length; i++) {
      var c = this.choices[i], sk = SKILLS[c.id];
      var r = UI.shopCard(g, 20, y0 + i * (ch + 14), W - 40, ch, { ch: sk.ch, color: sk.color, name: sk.name, desc: sk.full, gold: c.id === 'fireox' && this.hasTally });
      (function (idx, rr2) { self.buttons.push({ x: rr2.x, y: rr2.y, w: rr2.w, h: rr2.h, fn: function () { self.chooseSkill(idx); } }); })(i, r);
    }
  };
  P.renderShop = function (g) {
    var W = this.W, H = this.H, self = this, i;
    UI.dim(g, W, H, 0.7);
    var top = Math.max(16, H * 0.08); // 让开顶部状态条
    var tt = UI.titleText(g, '吕不韦货栈', W / 2, top + 30, 40, { scheme: 'purple', maxW: W - 30 });
    var by = tt.y + tt.h + 2;
    UI.bubble(g, this.shopMsg, W / 2, by + 38);
    var chip = UI.panel(g, W / 2 - 70, by + 46, 140, 34, { kind: 'paper', corners: false, radius: 17 });
    UI.coinIcon(g, chip.x + 22, chip.y + 16, 9);
    UI.label(g, '持有铜钱 ' + this.coins, chip.x + 80, chip.y + 16, { size: 15, color: UI.PAL.text, stroke: null, weight: '900' });
    var y0 = chip.y + chip.h + 14, btnH = 56, gap = 12, ch = Math.min(92, (H - y0 - btnH - 24 - gap * 3) / 3);
    for (i = 0; i < this.shopOffers.length; i++) {
      var o = this.shopOffers[i], d, ws, sk;
      if (o.kind === 'tally') d = { ch: '符', color: '#d9a521', name: '田单兵符', tag: '进化', desc: '进化信物：有火牛冲阵时，进化为「即墨火牛阵」', gold: true };
      else if (o.kind === 'weapon') { ws = SKILLS[this.weaponId()]; d = { ch: ws.ch, color: ws.color, name: '强化 · ' + ws.name, desc: ws.desc[Math.min(WEAPON_MAX - 1, this.skills[this.weaponId()])] }; }
      else if (o.kind === 'power') d = { ch: '功', color: '#9b2d2d', name: '军功加身', desc: '攻击 +' + Math.round(POWER_STEP * 100) + '%' };
      else if (o.kind === 'heal') d = { ch: '饭', color: '#b0703a', name: '黍米饭团', desc: '恢复 50% 气血' };
      else { sk = SKILLS[o.id]; d = { ch: sk.ch, color: sk.color, name: '新技能 · ' + sk.name, desc: sk.full, tag: '新！' }; }
      d.price = o.cost; d.sold = o.sold; d.afford = this.coins >= o.cost;
      var oik = o.kind === 'tally' ? 'tally' : (o.kind === 'weapon' ? this.weaponId() : (o.id || '')), oic = this.sprites.icons && this.sprites.icons[oik];
      if (oic) { d.img = oic; d.imgKey = oik; }
      var r = UI.shopCard(g, 18, y0 + i * (ch + gap), W - 36, ch, d);
      (function (idx, rr2) { self.buttons.push({ x: rr2.x, y: rr2.y, w: rr2.w, h: rr2.h, fn: function () { self.buyOffer(idx); } }); })(i, r);
    }
    var bby = y0 + 3 * (ch + gap) + 2, bw = (W - 48) / 2;
    this.button(g, 18, bby, bw, btnH, '刷新货物 3 铜', function () { if (self.coins >= 3) { self.coins -= 3; self.rollShop(); self.shopMsg = '新货到！'; } else self.shopMsg = '铜钱不够刷新啦'; }, this.coins >= 3 ? 'dark' : 'off');
    this.button(g, 30 + bw, bby, bw, btnH, '离开货栈', function () { self.closeShop(); });
  };
  // 暂停面板（独立函数，界面组件窗口换皮时只替换这里）
  P.renderPause = function (g) {
    var self = this;
    var r = UI.pausePanel(g, this.W, this.H, { title: '军令暂歇', tip: '战场已停住 · ' + fmtTime(this.gameTime || 0) });
    this.buttons.push({ x: r.resume.x, y: r.resume.y, w: r.resume.w, h: r.resume.h, fn: function () { self.resume(); }, label: '继续' });
    this.buttons.push({ x: r.restart.x, y: r.restart.y, w: r.restart.w, h: r.restart.h, fn: function () { self.startRun(self.heroIdx); }, label: '重新开始' });
    this.buttons.push({ x: r.home.x, y: r.home.y, w: r.home.w, h: r.home.h, fn: function () { self.setState(ST.MENU); }, label: '返回主菜单' });
  };
  P.pause = function () {
    if (this.state !== ST.PLAY) return false;
    this.keys = {}; this.lastTap.t = -1;
    this.setState(ST.PAUSE);
    return true;
  };
  P.resume = function () {
    if (this.state !== ST.PAUSE) return false;
    this.lastFrame = 0; this.lastTap.t = -1; this.keys = {};
    this.setState(ST.PLAY);
    return true;
  };
  P.togglePause = function () { return this.state === ST.PAUSE ? this.resume() : this.pause(); };
  // 切后台：战斗中自动暂停；货栈/升级/结算本就不推进战斗，只重置帧时钟
  P.onBackground = function () {
    this.joy.active = false; this.joy.id = null; this.keys = {};
    if (this.state === ST.PLAY) this.pause();
    this.lastFrame = 0;
  };
  P.renderResult = function (g) {
    var W = this.W, H = this.H;
    UI.dim(g, W, H, 0.78);
    if (!this.cardCanvas) return;
    var avH = H - 180, avW = W - 32, s = Math.min(avW / 750, avH / 1334), cw = 750 * s, chh = 1334 * s;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.cardCanvas, (W - cw) / 2, 14, cw, chh);
    g.imageSmoothingEnabled = false;
  };

  // ================= 调试接口（供 e2e 与开发） =================
  P.debugLevelUp = function () { if (this.state === ST.PLAY) { this.pendingLevels++; this.level++; this.expNeed = this.needFor(this.level); } };
  P.debugSetTime = function (t) {
    this.gameTime = t;
    for (var i = 0; i < this.events.length; i++) if (this.events[i].t < t - 1) this.events[i].done = true;
  };
  P.debugGrant = function (id, lv) { for (var i = 0; i < lv; i++) this.addSkill(id); };
  P.debugCoins = function (n) { this.coins += n; };
  P.debugSpawn = function (n, type) { for (var i = 0; i < n; i++) { var q = this.edgePos(rand(0, TAU)); this.spawnEnemy(type || 0, q.x + rand(-40, 40), q.y + rand(-40, 40)); } };
  P.debugSpawnNear = function (n) { var p = this.player; for (var i = 0; i < n; i++) { var a = rand(0, TAU), r = rand(70, 240); this.spawnEnemy(0, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r); } };
  P.debugFillRage = function () { this.rage = this.rageMax; };
  P.debugHitBoss = function (frac) { if (this.boss) this.hitEnemy(this.boss, this.boss.maxHp * frac + 1, 0, 0); };
  P.debugOpenShop = function () { if (!this.shop) this.spawnShop(); this.player.x = this.shop.x; this.player.y = this.shop.y; };
  P.debugKillPlayer = function () { this.debug.god = false; this.player.hp = 0; };
  P.getStats = function () {
    var log = this.fpsLog, sum = 0, mn = 999;
    for (var i = 0; i < log.length; i++) { sum += log[i]; if (log[i] < mn) mn = log[i]; }
    return { state: this.state, fps: this.fps, avgFps: log.length ? Math.round(sum / log.length) : 0, minFps: log.length ? mn : 0, enemies: this.activeE || 0, quality: this.quality, level: this.level, kills: this.kills, coins: this.coins, time: this.gameTime, skills: this.skills, evolved: this.evolved, boss: !!this.boss, rage: this.rage, hp: this.player ? this.player.hp : 0, shop: !!this.shop, paused: this.state === ST.PAUSE, gems: this.gemStats().count, gemValue: this.gemStats().value, gemTiers: this.gemStats().tiers, gemDropped: this.gemDropped || 0, gemCollected: this.gemCollected || 0, items: this.gemStats().items };
  };
  P.gemStats = function () {
    var c = 0, v = 0, it = 0, tiers = [0, 0, 0];
    for (var i = 0; i < MAX_DROP; i++) { var d = this.drops[i]; if (!d.active) continue; if (d.type === 0) { c++; v += d.v; tiers[this.gemTier(d.v)]++; } else it++; }
    return { count: c, value: v, tiers: tiers, items: it };
  };
  P.renderIcon = function (size) {
    var c = document.createElement('canvas'); c.width = c.height = size;
    var g = c.getContext('2d'), s = size / 512;
    var bg = g.createRadialGradient(size / 2, size * 0.45, 20 * s, size / 2, size / 2, size * 0.7);
    bg.addColorStop(0, '#c0392b'); bg.addColorStop(1, '#3a0d08');
    g.fillStyle = bg; g.fillRect(0, 0, size, size);
    g.strokeStyle = '#e0b050'; g.lineWidth = 14 * s; g.strokeRect(18 * s, 18 * s, size - 36 * s, size - 36 * s);
    g.strokeStyle = 'rgba(255,245,220,0.85)'; g.lineWidth = 22 * s; g.beginPath(); g.arc(size / 2, size * 0.56, 190 * s, Math.PI * 1.05, Math.PI * 1.75); g.stroke();
    for (var i = 0; i < 26; i++) { g.fillStyle = i % 5 ? '#f4ecd6' : '#2b2b2b'; g.fillRect((40 + (i * 97) % 430) * s, (60 + (i * 61) % 400) * s, 12 * s, 12 * s); }
    g.imageSmoothingEnabled = false;
    this.drawHero(g, 'baiqi', size / 2 - 20 * s, size * 0.9, 6.2 * s, 0, 1, false);
    return c.toDataURL('image/png');
  };

  global.QixiongGame = Game;
  global.QixiongSound = Sound;
  global.QixiongMusic = Music;
  global.QixiongData = { HEROES: HEROES, SKILLS: SKILLS, RANKS: RANKS, RANK_NEED: RANK_NEED, ST: ST };
})(window);
