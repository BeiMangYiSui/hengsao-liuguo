/**
 * 《横扫六国》- 小红书端宿主控制器与 window.xhs 桥接层
 * Chrome 61 基线、零外链；无宿主时自动降级为浏览器下载
 */
(function () {
  'use strict';

  var game = null;

  function downloadFallback(dataUrl, cb) {
    try {
      var a = document.createElement('a');
      a.download = '横扫六国_军功战报_' + Date.now() + '.png';
      a.href = dataUrl;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (cb) cb(true, '已导出图片，可在下载/文件中查看');
    } catch (e) {
      if (cb) cb(false, '保存失败，可截图保存');
    }
  }

  var XhsBridge = {
    isAvailable: function () {
      return typeof window !== 'undefined' && window.xhs && window.xhs.miniTool;
    },
    saveImage: function (canvas, cb) {
      var dataUrl = canvas.toDataURL('image/png');
      if (this.isAvailable() && typeof window.xhs.miniTool.saveImageToPhotosAlbum === 'function') {
        try {
          window.xhs.miniTool.saveImageToPhotosAlbum({
            filePath: dataUrl,
            data: dataUrl,
            success: function () { if (cb) cb(true, '军功战报已存入相册！'); },
            fail: function (err) {
              console.warn('xhs saveImage fail', err);
              downloadFallback(dataUrl, cb);
            }
          });
          return 'xhs';
        } catch (e) {
          console.warn('xhs saveImage error', e);
        }
      }
      downloadFallback(dataUrl, cb);
      return 'download';
    }
  };
  window.QixiongBridge = XhsBridge;

  function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function init() {
    var canvas = document.getElementById('game-canvas');
    var overlay = document.getElementById('result-overlay');
    var btnSound = document.getElementById('btn-sound');
    var btnPause = document.getElementById('btn-pause');
    var btnSave = document.getElementById('btn-save');
    var btnReplay = document.getElementById('btn-replay');
    var btnChange = document.getElementById('btn-change');
    var ST = window.QixiongData.ST;

    game = new window.QixiongGame(canvas, {
      onStateChange: function (s) {
        overlay.style.display = s === ST.RESULT ? 'flex' : 'none';
        btnSound.parentNode.style.display = s === ST.RESULT ? 'none' : 'flex';
        // 暂停键只在战斗中显示（暂停时变为「继续」）；菜单/选将/货栈/结算隐藏
        btnPause.style.display = (s === ST.PLAY || s === ST.PAUSE) ? 'flex' : 'none';
        btnPause.textContent = s === ST.PAUSE ? '▶' : '⏸';
        btnPause.setAttribute('aria-label', s === ST.PAUSE ? '继续' : '暂停');
      }
    });
    window.gameInstance = game;

    btnSound.addEventListener('click', function () {
      var S = window.QixiongSound;
      S.unlock();
      S.enabled = !S.enabled;
      if (window.QixiongMusic) window.QixiongMusic.apply(); // 音乐跟音效一起开关
      btnSound.textContent = S.enabled ? '🔊' : '🔇';
      showToast(S.enabled ? '声音已开启' : '已静音');
    });
    btnPause.addEventListener('click', function () {
      window.QixiongSound.unlock();
      game.togglePause();
    });
    btnSave.addEventListener('click', function () {
      if (!game.cardCanvas) return;
      btnSave.disabled = true;
      XhsBridge.saveImage(game.cardCanvas, function (ok, msg) {
        btnSave.disabled = false;
        showToast(msg);
      });
    });
    btnReplay.addEventListener('click', function () {
      window.QixiongSound.unlock();
      game.startRun(game.heroIdx);
      showToast('再战长平！');
    });
    btnChange.addEventListener('click', function () {
      game.setState(ST.SELECT);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
