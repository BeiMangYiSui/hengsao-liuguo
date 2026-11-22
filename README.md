# 横扫六国 · 一人破万军

战国题材的“割草幸存者”竖屏小游戏（原名《七雄割草传》）。操控白起或孙膑一人对千军：手指拖着走，刀枪自动砍，升级三选一搭配技能，3 分钟吕不韦货栈开张，4 分钟赵括骑竹简登场。约 5 分钟一局，打完生成“军功战报卡”。

> 戏说战国，非史实。

## 🎮 在线试玩

**[点这里直接在浏览器里玩 → https://beimangyisui.github.io/hengsao-liuguo/](https://beimangyisui.github.io/hengsao-liuguo/)**

手机打开体验最好；电脑浏览器也可以玩（建议把窗口调成竖屏比例，或用开发者工具的手机模式）。

## 本地运行

```bash
git clone https://github.com/BeiMangYiSui/hengsao-liuguo.git
cd hengsao-liuguo
python3 -m http.server 8000
```

然后在浏览器打开 http://localhost:8000 。

## 玩法

- **操作**：按住屏幕任意处出现虚拟摇杆，拖动走位，攻击全自动；怒气满后双击屏幕放大招。电脑上：WASD / 方向键移动，空格放大招，1/2/3 选技能，Enter 开始。
- **英雄**：白起（长戟横扫，杀敌越多越强，大招「杀神降世」）；孙膑（弩箭连射 + 八卦阵，大招「天罗八阵」）。
- **关卡**：长平 · 纸上谈兵——赵括兵书变出的纸甲兵、竹简盾兵、纸鸢弓手，Boss 赵括。
- **技能**：秦弩齐射、青铜剑气环、火牛冲阵、编钟震波、墨家机关鸟、合纵援军、胡服骑射、商鞅变法；火牛冲阵满级 + 田单兵符可进化为「即墨火牛阵」。
- 调试：地址后加 `?debug=1` 显示帧率。

## 技术

纯 Canvas 2D + Web Audio，ES5 写法、无外部依赖、无网络请求。`python3 package.py` 做合规检查与打包，`node test_e2e_qixiong.js` 跑无头 Chrome 端到端测试。

## 开源协议

- **代码**（`.js` / `.html` / `.css` / `.py` 等程序文件）：[MIT License](LICENSE)。
- **美术与音乐素材**（图片、背景音乐、内嵌在数据文件里的图像和音频）：作者保留全部权利，详见 [ASSETS_LICENSE.md](ASSETS_LICENSE.md)。
- **字体** `ui_font.woff2`（站酷快乐体子集）：SIL Open Font License 1.1。
