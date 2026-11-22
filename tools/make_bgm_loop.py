"""从 Flow Music 原曲裁出无缝循环段。
用法：python3 tools/make_bgm_loop.py <原曲wav> <起点秒> <循环长度秒> <交叉淡化秒> <输出名，不含扩展名>
输出（art/audio/）：<名>_loop.wav（循环段原件）、<名>_loop.mp3（进包用，单声道 64kbps）、<名>_试听x3.mp3（连放三遍听接缝）
接缝做法：取 [起点, 起点+长度+淡化]，把段尾超出长度的那一截与段首做等功率交叉淡化，使段尾自然接回段首。
"""
import os, subprocess, sys
import numpy as np

src, start, length, xf, name = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'art', 'audio')
OUT = os.path.abspath(OUT)
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                     capture_output=True, check=True).stdout
x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
a, n, k = int(round(start * SR)), int(round(length * SR)), int(round(xf * SR))
seg = x[a:a + n + k].copy()
assert len(seg) == n + k, '原曲长度不够'
t = np.linspace(0, np.pi / 2, k)
fade_in, fade_out = np.sin(t), np.cos(t)
loop = seg[:n].copy()
loop[:k] = seg[:k] * fade_in + seg[n:n + k] * fade_out
# 响度：峰值留 1 dB 余量，RMS 统一到 -16 dBFS 附近（两首一致，便于游戏里统一音量）
rms = np.sqrt(np.mean(loop ** 2))
loop *= min(10 ** (-16 / 20) / rms, 10 ** (-1 / 20) / np.max(np.abs(loop)))
wav = os.path.join(OUT, name + '_loop.wav')
mp3 = os.path.join(OUT, name + '_loop.mp3')
prev = os.path.join(OUT, name + '_试听x3.mp3')
pcm = loop.astype(np.float32).tobytes()
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'pcm_s16le', wav], input=pcm, check=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '64k', '-ac', '1', mp3], check=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-stream_loop', '2', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '128k', prev], check=True)
print(f'{name}: 起点 {start}s 长度 {length}s 淡化 {xf}s  RMS {20*np.log10(np.sqrt(np.mean(loop**2))):.1f}dBFS  峰值 {20*np.log10(np.max(np.abs(loop))):.1f}dBFS')
for p in (wav, mp3, prev):
    print(f'  {p}  {os.path.getsize(p)/1024:.0f} KB')
