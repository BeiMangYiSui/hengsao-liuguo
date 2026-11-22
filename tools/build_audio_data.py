"""把 art/audio/<文件名前缀>_loop.mp3 转成 base64，写成 audio_data.js（定义 window.QixiongAudioData）。
每首记录精确循环长度（取自同名 _loop.wav 的样本数），游戏里据此设 loopStart/loopEnd，跳过 mp3 编码器补的首尾静音。
用法：python3 tools/build_audio_data.py
"""
import base64, os, wave

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
AUD = os.path.join(ROOT, 'art', 'audio')
# 游戏内曲名 → art/audio 里的文件名前缀（2026-11-21 Boss 曲换为 v2“Changping Showdown”，旧 bgm_boss 保留不删）
TRACKS = {'battle': 'bgm_battle', 'boss': 'bgm_boss_v2'}
rows = []
for k, f in TRACKS.items():
    mp3 = os.path.join(AUD, '%s_loop.mp3' % f)
    with wave.open(os.path.join(AUD, '%s_loop.wav' % f)) as w:
        loop = w.getnframes() / float(w.getframerate())
    b64 = base64.b64encode(open(mp3, 'rb').read()).decode('ascii')
    rows.append('  "%s": { "loop": %.6f, "src": "data:audio/mpeg;base64,%s" }' % (k, loop, b64))
    print('%s: 循环 %.3f 秒，mp3 %.1f KB' % (k, loop, os.path.getsize(mp3) / 1024))
js = ('/* 《横扫六国》背景音乐数据：由 tools/build_audio_data.py 生成，请勿手改 */\n'
      '(function (w) {\n w.QixiongAudioData = {\n' + ',\n'.join(rows) + '\n };\n})(window);\n')
out = os.path.join(ROOT, 'audio_data.js')
open(out, 'w', encoding='utf-8').write(js)
print('已写入 %s（%.1f KB）' % (out, os.path.getsize(out) / 1024))
