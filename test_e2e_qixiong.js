#!/usr/bin/env node
/**
 * 《横扫六国》端到端验收脚本（Node 22 原生 WebSocket + Chrome DevTools Protocol）
 * - 自行启动独立的无头 Chrome（--headless=new、随机调试端口、临时 user-data-dir），
 *   不连接任何已有浏览器实例，不弹窗。
 * - 用法：node test_e2e_qixiong.js            全流程（两名英雄各一局）
 *         node test_e2e_qixiong.js --icon     只用核心引擎渲染 icon.png（512×512）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const DIR = __dirname;
const SHOTS = path.join(DIR, 'test_screenshots');
const URL = 'file://' + path.join(DIR, 'index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VW = 375, VH = 812;
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 等资源层加载完（加载界面期间没有按钮）
async function waitMusic(pg, name) { for (let i = 0; i < 60; i++) { if (await pg.evalJs('!!(QixiongMusic.cur && QixiongMusic.cur.name === "' + name + '")')) return true; await sleep(100); } return false; }
async function waitArt(pg) { for (let i = 0; i < 100; i++) { if (await pg.evalJs('!!(window.gameInstance && gameInstance.artReady)')) return true; await sleep(100); } return false; }

async function launch() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qixiong-e2e-profile-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + tmp,
    '--disable-features=OptimizationGuideModelDownloading,OptimizationHints',
    '--disable-component-update', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--disable-background-networking',
    '--autoplay-policy=no-user-gesture-required', 'about:blank'
  ], { stdio: 'ignore' });
  const portFile = path.join(tmp, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  await sleep(200);
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  const ws = new WebSocket('ws://127.0.0.1:' + port + wsPath);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method) listeners.forEach((fn) => fn(m));
  };
  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId }));
  });
  return { tmp, proc, ws, send, on: (fn) => listeners.push(fn), port };
}

async function openPage(b, log) {
  const { targetId } = await b.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => b.send(m, p, sessionId);
  b.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) log.console.push(m.params.type + ': ' + m.params.args.map((a) => a.value || a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') log.errors.push(m.params.exceptionDetails.text + ' ' + ((m.params.exceptionDetails.exception || {}).description || ''));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') log.console.push('log: ' + m.params.entry.text);
    if (m.method === 'Network.requestWillBeSent') log.requests.push(m.params.request.url);
  });
  await s('Runtime.enable'); await s('Page.enable'); await s('Network.enable'); await s('Log.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
  await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const evalJs = async (expr) => {
    const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval 失败: ' + expr + ' -> ' + (r.exceptionDetails.exception || {}).description);
    return r.result.value;
  };
  const touch = (type, pts) => s('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tap = async (x, y) => { await touch('touchStart', [{ x, y, id: 1 }]); await sleep(40); await touch('touchEnd', []); await sleep(120); };
  const shot = async (name) => {
    const r = await s('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('   📸 ' + name + '.png');
  };
  const settle = async () => {
    for (let k = 0; k < 60; k++) {
      const st = await evalJs('gameInstance.state');
      if (st !== 3) return k;
      await tap(VW / 2, VH * 0.2 + 64 + 46); await sleep(60);
    }
    return 60;
  };
  return { s, evalJs, touch, tap, shot, sessionId, settle };
}

async function makeIcon() {
  const b = await launch(); const log = { console: [], errors: [], requests: [] };
  try {
    const pg = await openPage(b, log);
    await pg.s('Page.navigate', { url: URL }); await sleep(900); await waitArt(pg);
    const data = await pg.evalJs('gameInstance.renderIcon(512)');
    fs.writeFileSync(path.join(DIR, 'icon.png'), Buffer.from(data.split(',')[1], 'base64'));
    console.log('icon.png 已生成');
  } finally { b.proc.kill(); }
  return b.tmp;
}

const ST = { MENU: 0, SELECT: 1, PLAY: 2, LEVELUP: 3, SHOP: 4, RESULT: 5, PAUSE: 6 };
const GEM_CAP = 120;
// 2026-11-19 第三次试玩调整：不弹窗，武将固定 2 个技能自动获得
const GRANTS = [
  [['swordring', 3], ['fireox', 3]],
  [['bagua', 3], ['fireox', 3]]
];

async function runHero(b, hi, dlDir, report) {
  const tag = hi === 0 ? 'baiqi' : 'sunbin';
  const log = { console: [], errors: [], requests: [] };
  const fails = [];
  const check = (cond, msg) => { if (!cond) { fails.push(msg); console.log('   ❌ ' + msg); } else console.log('   ✅ ' + msg); };
  const pg = await openPage(b, log);
  await pg.s('Page.navigate', { url: URL }); await sleep(1000); await waitArt(pg);
  console.log('\n===== 英雄 ' + (hi === 0 ? '白起' : '孙膑') + ' =====');
  check((await pg.evalJs('document.title')).indexOf('横扫六国') >= 0, '标题正确');
  check(await pg.evalJs('gameInstance.artReady === true'), '资源层加载完成（缺图自动退回代码小人）');
  report.artSummary = await pg.evalJs('JSON.stringify(window.QixiongAssets && QixiongAssets.summary())');
  if (hi === 0) await pg.shot('01_menu');
  await pg.tap(VW / 2, VH * 0.38 + 29);
  check(await pg.evalJs('gameInstance.state') === ST.SELECT, '点击「开始出征」进入选将');
  await pg.tap(VW / 2, hi === 0 ? 240 : 516); await sleep(200);
  check(await pg.evalJs('gameInstance.selHero') === hi, '选中英雄卡片');
  await pg.shot(tag + '_02_select');
  await pg.tap(VW / 2, VH - 54); await sleep(600);
  check(await pg.evalJs('gameInstance.state') === ST.PLAY, '点击「出征」开局');
  check(await waitMusic(pg, 'battle') && await pg.evalJs('QixiongMusic.ready("battle") && QixiongMusic.ready("boss")'), '开局播放战斗曲（两首背景音乐均解码成功）');
  if (tag === 'sunbin') check(await pg.evalJs('gameInstance.hero.weapon === "crossbow" && gameInstance.skillList.join() === "crossbow" && gameInstance.skills.crossbow === 1 && !gameInstance.skills.bagua'), '孙膑开局只有弩箭（1 级），还没有八卦阵');
  check(await pg.evalJs('(function(t){return t.ls < 0.2 && Math.abs(t.le - t.ls - QixiongAudioData.battle.loop) < 0.001 && t.le <= t.buf.duration;})(QixiongMusic.tracks.battle)'), '战斗曲循环区间正确（跳过编码器静音）');
  await pg.shot(tag + '_03_start');
  // 模拟单指拖动
  const p0 = await pg.evalJs('({x:gameInstance.player.x,y:gameInstance.player.y})');
  await pg.touch('touchStart', [{ x: 187, y: 600, id: 1 }]);
  for (let k = 1; k <= 10; k++) { await pg.touch('touchMove', [{ x: 187 + k * 7, y: 600 - k * 6, id: 1 }]); await sleep(40); }
  await sleep(1400);
  await pg.shot(tag + '_04_drag_joystick');
  await pg.touch('touchEnd', []);
  const p1 = await pg.evalJs('({x:gameInstance.player.x,y:gameInstance.player.y})');
  check(Math.hypot(p1.x - p0.x, p1.y - p0.y) > 80, '拖动摇杆后英雄移动（位移 ' + Math.round(Math.hypot(p1.x - p0.x, p1.y - p0.y)) + 'px）');
  // 升级：不弹窗，第 2 / 5 级自动获得固定技能
  const auto = GRANTS[hi].map((x) => x[0]);
  await pg.evalJs('gameInstance.debug.god = true; gameInstance.debugLevelUp()'); await sleep(400);
  check(await pg.evalJs('gameInstance.state') === ST.PLAY, '第 2 级不弹窗');
  check(await pg.evalJs(`gameInstance.skillList[1] === '${auto[0]}' && gameInstance.banners.some(function(b){return b.text.indexOf('获得')===0;})`), '第 2 级自动获得「' + auto[0] + '」并有屏幕提示');
  if (tag === 'sunbin') check(await pg.evalJs('gameInstance.skillList[1] === "bagua" && gameInstance.skLv("bagua") === 1 && gameInstance.skLv("crossbow") === 1'), '孙膑第 2 级获得 1 级八卦阵（只布 1 座小阵），弩箭仍是 1 级主武器');
  await pg.shot(tag + '_05_auto_skill');
  const w0 = await pg.evalJs('gameInstance.skills[gameInstance.hero.weapon]');
  await pg.evalJs('gameInstance.debugLevelUp()'); await sleep(400);
  check(await pg.evalJs('gameInstance.state') === ST.PLAY && await pg.evalJs('gameInstance.skills[gameInstance.hero.weapon]') === w0 + 1, '第 3 级自动强化主武器');
  await pg.shot(tag + '_05b_auto_power');
  await pg.evalJs('gameInstance.debugLevelUp(); gameInstance.debugLevelUp()'); await sleep(400);
  check(await pg.evalJs(`gameInstance.state === 2 && gameInstance.skillList.length === 3 && gameInstance.skillList[2] === '${auto[1]}'`), '第 5 级自动获得「' + auto[1] + '」，技能栏 3 格');
  if (tag === 'sunbin') check(await pg.evalJs('gameInstance.skills.crossbow === 2 && gameInstance.skills.bagua === 2'), '孙膑第 3、4 级弩箭与八卦阵轮流强化（均为 2 级）');
  // 授予技能 + 200 敌压测
  for (const [id, lv] of GRANTS[hi]) await pg.evalJs(`gameInstance.debugGrant('${id}', 3)`);
  await pg.evalJs(`(function(){var g=gameInstance;var keep=${JSON.stringify(GRANTS[hi].map((x) => x[0]))};for(var i=g.skillList.length-1;i>=1;i--){if(keep.indexOf(g.skillList[i])<0){delete g.skills[g.skillList[i]];g.skillList.splice(i,1);}}${GRANTS[hi].map(([id, lv]) => `g.skills['${id}']=${lv};`).join('')}})()`);
  await pg.evalJs('gameInstance.debugSetTime(40); gameInstance.fpsLog=[]; gameInstance.maxEnemies=300; gameInstance.debugSpawnNear(120); gameInstance.debugSpawn(120)');
  if (hi === 0) {
    check(await pg.evalJs('["crossbow","swordring","fireox","cavalry","allies"].every(function(k){return !!QixiongData.SKILLS[k].short && !!QixiongData.SKILLS[k].full;})'), '技能池 5 个，每个有两字名字和一句完整说明');
  }
  check(await pg.evalJs('gameInstance.skillList.length') === 3, '技能栏 = 主武器 + 2 个技能（共 ' + (await pg.evalJs('gameInstance.skillList.length')) + ' 格）');
  const pw = await pg.evalJs('JSON.stringify([gameInstance.skills[gameInstance.hero.weapon], gameInstance.skills.bagua || 0, gameInstance.powerUps])');
  await pg.evalJs('gameInstance.debugLevelUp(); gameInstance.debugLevelUp(); gameInstance.debugLevelUp()'); await sleep(500);
  check(await pg.evalJs('gameInstance.state') === ST.PLAY && await pg.evalJs('JSON.stringify([gameInstance.skills[gameInstance.hero.weapon], gameInstance.skills.bagua || 0, gameInstance.powerUps])') !== pw, '之后升级不弹窗，自动变强');
  await sleep(1200);
  await pg.shot(tag + '_06_battle_crowd');
  let maxE = 0, maxGem = 0;
  for (let k = 0; k < 8; k++) { maxE = Math.max(maxE, await pg.evalJs('(gameInstance.activeE<200 && gameInstance.debugSpawn(200-gameInstance.activeE), gameInstance.activeE)')); await sleep(500); maxGem = Math.max(maxGem, await pg.evalJs('gameInstance.getStats().gems')); } // 刷兵后立即计数（远程技能清怪快，等半秒再数会偏低）
  const st = await pg.evalJs('gameInstance.getStats()');
  check(maxGem <= GEM_CAP, '压测时同屏经验玉 ≤ ' + GEM_CAP + '（峰值 ' + maxGem + '，当前分档 绿/蓝/金 = ' + st.gemTiers.join('/') + '）');
  check(st.gemDropped > 0 && st.gemDropped === st.gemCollected + st.gemValue, '经验玉合并不丢经验（掉落 ' + st.gemDropped + ' = 已拾 ' + st.gemCollected + ' + 地上 ' + st.gemValue + '）');
  report.fps[tag] = { avg: st.avgFps, min: st.minFps, maxEnemies: maxE, quality: st.quality };
  check(maxE >= 180, '同屏敌人压测（峰值 ' + maxE + '）');
  console.log('   ℹ️ 压测帧率 avg=' + st.avgFps + ' min=' + st.minFps + ' 画质档=' + st.quality);
  await pg.shot(tag + '_07_battle_200');
  // 货栈 + 进化
  console.log('   ℹ️ 处理排队升级 ' + (await pg.settle()) + ' 次');
  await pg.evalJs('gameInstance.debugSetTime(48)'); await sleep(300);
  check(await pg.evalJs('!gameInstance.shop'), '0:48 货栈尚未出现');
  await pg.evalJs('gameInstance.debugSetTime(51)'); await sleep(500);
  check(await pg.evalJs('!!gameInstance.shop'), '0:50 吕不韦货栈出现');
  await pg.shot(tag + '_08_shop_banner');
  await pg.evalJs('gameInstance.debugCoins(60); gameInstance.debugOpenShop()'); await sleep(500);
  check(await pg.evalJs('gameInstance.state') === ST.SHOP, '走入货栈打开商店');
  check(await pg.evalJs('gameInstance.shopOffers.every(function(o){return o.kind!=="up";})'), '货栈不卖新技能');
  await pg.shot(tag + '_09_shop');
  const lvH = 30, top = VH * 0.1, y0 = top + lvH * 2 + 98;
  await pg.tap(VW / 2, y0 + 43); await sleep(300);
  check(await pg.evalJs('gameInstance.hasTally && gameInstance.evolved'), '购买田单兵符 → 进化即墨火牛阵');
  const bw = (VW - 52) / 2;
  await pg.tap(32 + bw + bw / 2, y0 + 3 * 98 + 6 + 25); await sleep(300);
  check([ST.PLAY, ST.LEVELUP].indexOf(await pg.evalJs('gameInstance.state')) >= 0, '离开货栈');
  console.log('   ℹ️ 处理排队升级 ' + (await pg.settle()) + ' 次');
  await pg.evalJs('gameInstance.player.x += 140; gameInstance.debugSpawnNear(60)');
  await sleep(1300);
  await pg.shot(tag + '_10_evolve_stampede');
  // 大招：双击
  await pg.settle(); await pg.evalJs('gameInstance.debugFillRage()'); await sleep(100);
  await pg.shot(tag + '_11_rage_full');
  const ultBefore = await pg.evalJs('(gameInstance.ultCount||0)');
  await pg.tap(187, 420); await sleep(60); await pg.tap(187, 420);
  await sleep(250);
  check(await pg.evalJs('(gameInstance.ultCount||0)') === ultBefore + 1, '怒气满后双击释放大招');
  await pg.shot(tag + '_12_ultimate');
  // Boss
  await pg.settle(); await pg.evalJs('gameInstance.debugSetTime(74.5)'); await sleep(900); await pg.settle();
  check(await pg.evalJs('gameInstance.banners.some(function(b){return b.text.indexOf("赵括要来了")>=0;})'), '1:15「赵括要来了」预告');
  await pg.shot(tag + '_12b_boss_warning');
  await pg.evalJs('gameInstance.debugSetTime(90)'); await sleep(600); await pg.settle();
  check(await pg.evalJs('!!gameInstance.boss'), '1:30 Boss 赵括登场');
  check(await waitMusic(pg, 'boss'), '赵括登场切换为 Boss 曲');
  // ---- Boss「兵书缚身」----
  const bd = () => pg.evalJs('(function(g){var b=g.boss,p=g.player;return Math.hypot(p.x-b.x,p.y-b.y);})(gameInstance)');
  const mode = () => pg.evalJs('gameInstance.bossAI.mode');
  const waitMode = async (m, ms) => { for (let i = 0; i < ms / 50; i++) { if (await mode() === m) return true; await sleep(50); } return false; };
  await pg.evalJs('(function(g){var b=g.boss;g.player.x=b.x+150;g.player.y=b.y;g.bossAI.mode="move";g.bossAI.pullT=0;g.bossAI.chargeT=99;g.bossAI.throwT=99;})(gameInstance)');
  check(await waitMode('pullAim', 600), '玩家靠近（150px）触发「兵书缚身」预警');
  await sleep(500); await pg.shot(tag + '_13c_boss_pull_warning');
  check(await waitMode('bind', 3000), '预警后被吸到赵括身边并定身');
  check(await pg.evalJs('gameInstance.bindT > 0') && await bd() <= 80, '定身时贴在赵括身边（距离 ' + Math.round(await bd()) + 'px）');
  await pg.shot(tag + '_13d_boss_bind');
  const pb = await pg.evalJs('JSON.stringify([Math.round(gameInstance.player.x),Math.round(gameInstance.player.y)])');
  await pg.evalJs('gameInstance.keys.d = true'); await sleep(500);
  check(await pg.evalJs('JSON.stringify([Math.round(gameInstance.player.x),Math.round(gameInstance.player.y)])') === pb, '定身期间按方向键也不能移动');
  check(await waitMode('move', 2500) && await pg.evalJs('gameInstance.bindT') === 0, '约 1.8 秒后挣脱，赵括恢复走位');
  const px1 = await pg.evalJs('gameInstance.player.x'); await sleep(400);
  check(await pg.evalJs('gameInstance.player.x') > px1 + 20, '挣脱后可以正常移动');
  await pg.evalJs('gameInstance.keys = {}');
  await pg.evalJs('(function(g){var b=g.boss;g.player.x=b.x+150;g.player.y=b.y;g.bossAI.pullT=0;g.bossAI.chargeT=99;})(gameInstance)');
  check(await waitMode('pullAim', 600), '再次触发预警');
  await pg.evalJs('(function(g){var b=g.boss;g.player.x=b.x+' + 290 + ';g.player.y=b.y;})(gameInstance)'); // 预警期间跑出圈
  check(await waitMode('move', 3500) && await pg.evalJs('gameInstance.bindT') === 0 && await bd() > 230, '预警期间跑出圈即可躲开，不被定身');
  await pg.evalJs('gameInstance.bossAI.chargeT = 6; gameInstance.bossAI.throwT = 2; gameInstance.bossAI.pullT = 99');
  await pg.shot(tag + '_13_boss_enter');
  await sleep(2700); await pg.settle();
  const pages = await pg.evalJs('gameInstance.pages.length');
  check(pages > 0, 'Boss 抛书页（预警圈 ' + pages + ' 个）');
  await pg.shot(tag + '_14_boss_pages');
  await sleep(1200); await pg.settle();
  await pg.evalJs('gameInstance.debugHitBoss(1)'); await sleep(700);
  check(await pg.evalJs('!!gameInstance.ending && gameInstance.ending.win'), '击败赵括触发慢动作结局');
  check(await pg.evalJs('QixiongMusic.want === null && QixiongMusic.cur === null'), '胜利后背景音乐淡出');
  await pg.shot(tag + '_15_victory_slowmo');
  await sleep(4200);
  check(await pg.evalJs('gameInstance.state') === ST.RESULT, '进入结算');
  check(await pg.evalJs('document.getElementById("result-overlay").style.display') === 'flex', '结算按钮浮层显示');
  check(await pg.evalJs('getComputedStyle(document.getElementById("btn-pause")).display') === 'none', '结算页隐藏暂停键');
  await pg.shot(tag + '_16_result');
  const dims = await pg.evalJs('[gameInstance.cardCanvas.width, gameInstance.cardCanvas.height]');
  check(dims[0] === 750 && dims[1] === 1334, '战报卡尺寸 750×1334');
  const card = await pg.evalJs('gameInstance.cardCanvas.toDataURL("image/png")');
  fs.writeFileSync(path.join(SHOTS, tag + '_card_750x1334.png'), Buffer.from(card.split(',')[1], 'base64'));
  const dlBefore = fs.readdirSync(dlDir).length;
  await pg.evalJs('document.getElementById("btn-save").click()'); await sleep(1200);
  const toast = await pg.evalJs('document.getElementById("toast").textContent');
  check(toast.length > 0, '点击保存图片有提示：' + toast);
  check(fs.readdirSync(dlDir).length > dlBefore, '无宿主时降级下载 PNG 成功');
  // 失败可重来
  await pg.evalJs('document.getElementById("btn-replay").click()'); await sleep(500);
  check(await pg.evalJs('gameInstance.state') === ST.PLAY, '「再来一局」重新开局');
  await pg.evalJs('gameInstance.debugKillPlayer()'); await sleep(2600);
  check(await pg.evalJs('gameInstance.state === 5 && gameInstance.lastResult.win === false'), '战败进入结算（可再来一局）');
  await pg.shot(tag + '_17_defeat_result');
  report.heroes[tag] = { fails, errors: log.errors, console: log.console };
  report.requests = report.requests.concat(log.requests);

}

// 暂停 / 切后台 / 经验玉合并（独立页面，避免影响两名英雄的原有流程）
async function runPauseSuite(b, report) {
  const log = { console: [], errors: [], requests: [] };
  const fails = [];
  const check = (cond, msg) => { if (!cond) { fails.push(msg); console.log('   ❌ ' + msg); } else console.log('   ✅ ' + msg); };
  const pg = await openPage(b, log);
  await pg.s('Page.navigate', { url: URL }); await sleep(1000); await waitArt(pg);
  console.log('\n===== 暂停 / 切后台 / 经验玉 =====');
  const disp = (id) => pg.evalJs('getComputedStyle(document.getElementById("' + id + '")).display');
  const rect = (id) => pg.evalJs('(function(){var r=document.getElementById("' + id + '").getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};})()');
  const tapEl = async (id) => { const r = await rect(id); await pg.tap(r.x + r.w / 2, r.y + r.h / 2); await sleep(150); };
  const btnOf = (label) => pg.evalJs('(function(){var b=gameInstance.buttons.filter(function(x){return x.label===' + JSON.stringify(label) + ';})[0];return b?{x:b.x,y:b.y,w:b.w,h:b.h}:null;})()');
  const tapLabel = async (label) => { await sleep(80); const r = await btnOf(label); if (!r) return false; await pg.tap(r.x + r.w / 2, r.y + r.h / 2); await sleep(200); return true; };
  const state = () => pg.evalJs('gameInstance.state');
  const gt = () => pg.evalJs('gameInstance.gameTime');
  check(await disp('btn-pause') === 'none', '主菜单隐藏暂停键');
  await pg.tap(VW / 2, VH * 0.38 + 29); await sleep(200);
  check(await disp('btn-pause') === 'none', '选将页隐藏暂停键');
  await pg.tap(VW / 2, 240); await sleep(200); await pg.tap(VW / 2, VH - 54); await sleep(600);
  check(await state() === ST.PLAY && await disp('btn-pause') !== 'none', '战斗中显示暂停键');
  const rp = await rect('btn-pause'), rs = await rect('btn-sound');
  check(rp.x + rp.w <= rs.x && rp.y === rs.y && rp.w === rs.w && rp.h === rs.h && rp.x >= 0, '暂停键在声音键左侧、同尺寸不重叠（暂停 x=' + Math.round(rp.x) + '，声音 x=' + Math.round(rs.x) + '）');
  await pg.evalJs('gameInstance.debug.god = true');
  // ---- 经验玉：合并 / 分档 / 上限 / 不挤占其他掉落 ----
  const clump = await pg.evalJs(`(function(){var g=gameInstance,p=g.player,a=g.getStats();for(var i=0;i<30;i++)g.spawnDrop(0,p.x+150+Math.random()*16,p.y-150+Math.random()*16,1);var b=g.getStats();return {dn:b.gems-a.gems,dv:b.gemValue-a.gemValue,gold:b.gemTiers[2]-a.gemTiers[2]};})()`);
  check(clump.dn === 1 && clump.dv === 30 && clump.gold === 1, '40px 内的新玉并入同一颗（30 颗 → ' + clump.dn + ' 颗，价值 ' + clump.dv + '，升为金玉）');
  await pg.evalJs(`(function(){var g=gameInstance,p=g.player;g.spawnDrop(0,p.x-110,p.y+110,1);g.spawnDrop(0,p.x,p.y+120,8);g.spawnDrop(0,p.x+110,p.y+110,20);})()`);
  check(await pg.evalJs('[0,1,2].map(function(v){return gameInstance.gemTier([1,8,20][v]);}).join()') === '0,1,2', '经验玉三档：1→绿、8→蓝、20→金');
  await sleep(120); await pg.shot('pause_01_gem_tiers');
  const fill = await pg.evalJs(`(function(){var g=gameInstance,p=g.player,a=g.getStats(),add=0;for(var i=0;i<500;i++){var v=1+(i%3);add+=v;g.spawnDrop(0,p.x+500+Math.random()*1500,p.y-750+Math.random()*1500,v);}var b=g.getStats();var it0=b.items;for(var k=0;k<5;k++)g.spawnDrop(1,p.x+520+k*30,p.y+300,1);g.spawnDrop(2,p.x+520,p.y+340,1);var c=g.getStats();return {n:b.gems,dv:b.gemValue-a.gemValue,add:add,inv:c.gemDropped===c.gemCollected+c.gemValue,items:c.items-it0};})()`);
  check(fill.n <= GEM_CAP && fill.dv === fill.add && fill.inv, '散落 500 颗玉：同屏 ' + fill.n + ' 颗（≤' + GEM_CAP + '），价值全部保留（+' + fill.dv + '/' + fill.add + '）');
  check(fill.items === 6, '玉池满时铜钱 / 饭团照常掉落（新增 ' + fill.items + ' 个）');
  check(await pg.evalJs('(function(){var g=gameInstance,p=g.player,tx=p.x+100,ty=p.y,best=null,bd=1e18;for(var i=0;i<g.drops.length;i++){var d=g.drops[i];if(!d.active||d.type!==0)continue;var q=(d.x-tx)*(d.x-tx)+(d.y-ty)*(d.y-ty);if(q<bd){bd=q;best=d;}}var v0=best.v,n0=g.getStats().gems;g.spawnDrop(0,tx,ty,1);return n0===120&&g.getStats().gems===n0&&best.v===v0+1;})()'), '池满时新玉并入最近的玉');
  // ---- 暂停键 ----
  await pg.evalJs('gameInstance.debugSpawnNear(30)'); await sleep(300);
  await tapEl('btn-pause');
  check(await state() === ST.PAUSE, '点暂停键进入暂停（ST.PAUSE）');
  check(await pg.evalJs('QixiongMusic.want === "battle" && QixiongMusic.level === 0'), '暂停时背景音乐静音（保留曲目位置）');
  check(await pg.evalJs('document.getElementById("btn-pause").textContent') === '▶', '暂停时暂停键变为继续图标');
  const t0 = await gt(), e0 = await pg.evalJs('JSON.stringify(gameInstance.enemies.filter(function(e){return e.active;}).slice(0,20).map(function(e){return [Math.round(e.x*10),Math.round(e.y*10)];}))');
  await sleep(1200);
  const e1 = await pg.evalJs('JSON.stringify(gameInstance.enemies.filter(function(e){return e.active;}).slice(0,20).map(function(e){return [Math.round(e.x*10),Math.round(e.y*10)];}))');
  check(await gt() === t0 && e0 === e1 && e0 !== '[]', '暂停后 gameTime 不走、敌人不动（' + t0.toFixed(2) + 's）');
  await pg.evalJs('gameInstance.debugFillRage()');
  const ult0 = await pg.evalJs('(gameInstance.ultCount||0)'), pp0 = await pg.evalJs('JSON.stringify([gameInstance.player.x,gameInstance.player.y])');
  await pg.tap(187, 150); await sleep(60); await pg.tap(187, 150); await sleep(200);
  await pg.touch('touchStart', [{ x: 60, y: 700, id: 1 }]);
  for (let k = 1; k <= 8; k++) { await pg.touch('touchMove', [{ x: 60 + k * 10, y: 700 - k * 8, id: 1 }]); await sleep(40); }
  await sleep(300); await pg.touch('touchEnd', []); await sleep(100);
  check(await pg.evalJs('(gameInstance.ultCount||0)') === ult0 && await pg.evalJs('JSON.stringify([gameInstance.player.x,gameInstance.player.y])') === pp0 && await state() === ST.PAUSE, '暂停中双击不放大招、拖动不移动');
  await pg.shot('pause_02_panel');
  const bs = await pg.evalJs('gameInstance.buttons.filter(function(b){return ["继续","重新开始","返回主菜单"].indexOf(b.label)>=0;}).map(function(b){return [b.x,b.y,b.w,b.h];})');
  const ov = (a, c) => a[0] < c[0] + c[2] && c[0] < a[0] + a[2] && a[1] < c[1] + c[3] && c[1] < a[1] + a[3];
  const nav = [Math.min(rp.x, rs.x), rp.y, rs.x + rs.w - Math.min(rp.x, rs.x), rs.h];
  check(bs.length === 3 && !ov(bs[0], bs[1]) && !ov(bs[1], bs[2]) && !ov(bs[0], bs[2]) && bs.every((x) => !ov(x, nav) && x[1] + x[3] < VH - 60), '暂停面板三个按钮齐全、互不重叠、不压右上角按钮');
  check(await tapLabel('继续') && await state() === ST.PLAY, '「继续」回到战斗');
  await sleep(700);
  check(await gt() > t0 + 0.3 && await pg.evalJs('(gameInstance.ultCount||0)') === ult0, '继续后 gameTime 恢复走动，且未误触大招');
  await tapEl('btn-pause'); const tg = await state(); await tapEl('btn-pause');
  check(tg === ST.PAUSE && await state() === ST.PLAY, '暂停键可再次点击直接继续');
  // ---- 切后台 ----
  await pg.evalJs('Object.defineProperty(document,"hidden",{configurable:true,get:function(){return true;}}); document.dispatchEvent(new Event("visibilitychange"))');
  await sleep(100);
  check(await state() === ST.PAUSE, '切后台（visibilitychange, hidden=true）自动暂停');
  const reset = await pg.evalJs('(function(){gameInstance.lastFrame=1;Object.defineProperty(document,"hidden",{configurable:true,get:function(){return false;}}); document.dispatchEvent(new Event("visibilitychange"));return gameInstance.lastFrame===0;})()');
  const t1 = await gt(); await sleep(800);
  check(reset && await state() === ST.PAUSE && await gt() === t1, '回到前台仍停在暂停界面，且 lastFrame 已重置');
  await pg.shot('pause_03_after_background');
  check(await tapLabel('继续') && await state() === ST.PLAY, '回前台后点「继续」才开打');
  await sleep(300);
  await pg.evalJs('window.dispatchEvent(new Event("pagehide"))'); await sleep(100);
  check(await state() === ST.PAUSE, 'pagehide 也会自动暂停');
  await tapLabel('继续'); await sleep(200);
  // 货栈中切后台：保持货栈，不报错
  await pg.evalJs('gameInstance.debugSetTime(51)'); await sleep(400);
  await pg.evalJs('gameInstance.debugOpenShop()'); await sleep(400);
  if (await state() === ST.SHOP) {
    await pg.evalJs('Object.defineProperty(document,"hidden",{configurable:true,get:function(){return true;}}); document.dispatchEvent(new Event("visibilitychange")); Object.defineProperty(document,"hidden",{configurable:true,get:function(){return false;}}); document.dispatchEvent(new Event("visibilitychange"))');
    await sleep(200);
    check(await state() === ST.SHOP && await disp('btn-pause') === 'none', '货栈界面切后台保持货栈（本就停住），暂停键隐藏');
    await pg.evalJs('gameInstance.closeShop()'); await sleep(200);
  } else check(false, '货栈界面切后台（未能打开货栈）');
  // ---- 重新开始 / 返回主菜单 ----
  await sleep(500);
  const k0 = await pg.evalJs('gameInstance.kills');
  await tapEl('btn-pause');
  check(await tapLabel('重新开始') && await state() === ST.PLAY && await gt() < 1 && await pg.evalJs('gameInstance.kills') === 0 && await pg.evalJs('gameInstance.getStats().gems') === 0, '「重新开始」从头开一局（原斩 ' + k0 + ' → 0）');
  await sleep(400);
  await tapEl('btn-pause');
  check(await tapLabel('返回主菜单') && await state() === ST.MENU && await disp('btn-pause') === 'none', '「返回主菜单」回到主菜单并隐藏暂停键');
  await pg.shot('pause_04_back_menu');
  await pg.tap(VW / 2, VH * 0.38 + 29); await pg.tap(VW / 2, 240); await sleep(150); await pg.tap(VW / 2, VH - 54); await sleep(400);
  check(await state() === ST.PLAY, '返回主菜单后可再次出征');
  check(await waitMusic(pg, 'battle'), '再次出征重新播放战斗曲');
  await tapEl('btn-sound'); await sleep(900);
  check(await pg.evalJs('QixiongSound.enabled === false && QixiongMusic.cur.g.gain.value < 0.02'), '点喇叭静音后背景音乐也静音');
  await tapEl('btn-sound'); await sleep(900);
  check(await pg.evalJs('QixiongSound.enabled === true && QixiongMusic.cur.g.gain.value > QixiongMusic.VOL * 0.8'), '再点喇叭恢复背景音乐');
  // 实测响度：在音效总输出与音乐总输出上各挂电平表，连续放砍中声 + 倒下声，比较峰值 RMS
  const lv = JSON.parse(await pg.evalJs(`(async function () {
    var c = QixiongSound.ctx, a = c.createAnalyser(), m = c.createAnalyser(); a.fftSize = m.fftSize = 2048;
    QixiongSound.out.connect(a); QixiongMusic.out.connect(m);
    var buf = new Float32Array(2048);
    function rms(an) { an.getFloatTimeDomainData(buf); var s = 0; for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); }
    var sp = 0, ms = 0;
    for (var k = 0; k < 24; k++) { QixiongSound.last = {}; QixiongSound.play('hit'); QixiongSound.play('die'); await new Promise(function (r) { setTimeout(r, 25); }); sp = Math.max(sp, rms(a)); ms += rms(m); }
    QixiongSound.out.disconnect(a); QixiongMusic.out.disconnect(m);
    return JSON.stringify({ sfx: 20 * Math.log10(sp + 1e-9), music: 20 * Math.log10(ms / 24 + 1e-9) });
  })()`));
  report.levels = lv;
  check(lv.sfx > -30, '音效总输出有声（砍中+倒下峰值 ' + lv.sfx.toFixed(1) + ' dBFS）');
  check(lv.sfx - lv.music >= 10, '音效明显高于背景音乐（音效 ' + lv.sfx.toFixed(1) + ' / 音乐 ' + lv.music.toFixed(1) + ' dBFS，差 ' + (lv.sfx - lv.music).toFixed(1) + ' dB）');
  report.heroes.pause = { fails, errors: log.errors, console: log.console };
  report.requests = report.requests.concat(log.requests);
}

(async () => {
  if (process.argv.includes('--icon')) { const t = await makeIcon(); console.log('临时 profile: ' + t); return; }
  const b = await launch();
  const report = { fps: {}, heroes: {}, requests: [], profile: b.tmp };
  const dlDir = path.join(b.tmp, 'downloads'); fs.mkdirSync(dlDir, { recursive: true });
  try {
    await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
    await runHero(b, 0, dlDir, report);
    await runHero(b, 1, dlDir, report);
    await runPauseSuite(b, report);
  } catch (e) {
    console.log('💥 脚本异常: ' + e.stack); report.crash = String(e);
  } finally {
    b.proc.kill();
  }
  const ext = report.requests.filter((u) => !/^file:|^data:|^about:|^blob:/.test(u));
  console.log('\n===== 汇总 =====');
  console.log('网络请求总数 ' + report.requests.length + '，非本地请求 ' + ext.length + (ext.length ? ' -> ' + ext.join(', ') : ''));
  let total = 0;
  for (const k in report.heroes) {
    const h = report.heroes[k]; total += h.fails.length + h.errors.length;
    console.log(k + ': 失败项 ' + h.fails.length + '，页面异常 ' + h.errors.length + '，控制台错误/警告 ' + h.console.length);
    h.errors.concat(h.console).slice(0, 5).forEach((x) => console.log('   · ' + x));
  }
  console.log('帧率: ' + JSON.stringify(report.fps));
  console.log('临时 profile: ' + report.profile);
  fs.writeFileSync(path.join(SHOTS, 'e2e_report.json'), JSON.stringify(report, null, 2));
  const ok = !report.crash && total === 0 && ext.length === 0 && Object.keys(report.heroes).length === 3;
  console.log(ok ? '\n✅ e2e 全部通过' : '\n❌ e2e 存在失败项');
  process.exit(ok ? 0 : 1);
})();
