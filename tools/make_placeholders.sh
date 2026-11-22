#!/usr/bin/env bash
# 用 magick 画占位原图，模拟 Flow 出图（1024 级分辨率、纯色底、抗锯齿边带底色溢出），用来验证流水线与加载层。
#   tools/make_placeholders.sh            → dev/placeholder_raw/      功能测试集（故意缺几张，测缺图退回）
#   tools/make_placeholders.sh --full     → dev/placeholder_raw_full/ 满清单压测集（带纹理，体积接近真图，测包体与加载速度）
# 只写 dev/ 下的占位目录，绝不写 img/。
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FULL=0; [ "${1:-}" = "--full" ] && FULL=1
OUT="$ROOT/dev/placeholder_raw"; [ $FULL = 1 ] && OUT="$ROOT/dev/placeholder_raw_full"
mkdir -p "$OUT"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/qx-placeholder-XXXXXX")"   # 中间纹理/遮罩，不自动删除
G='#00FF00'; M='#FF00FF'
SEED=7

# 纹理填充：满清单集用 plasma 让色块有明暗（更接近手绘上色后的体积），功能集用纯色
fillimg() { # $1 宽 $2 高 $3 颜色 → 输出纹理图路径
  local f="$WORK/tex_$RANDOM$RANDOM.png"
  if [ $FULL = 1 ]; then SEED=$((SEED+1)); magick -seed $SEED -size "$1x$2" "plasma:$3-$3" -blur 0x3 -modulate 100,110 "$f"
  else magick -size "$1x$2" "xc:$3" "$f"; fi
  echo "$f"
}
# 人形：大头 + 圆角身体 + 左手兵器（朝左，用来验证左右翻转）；$1 输出 $2 主色 $3 脸色 $4 宽 $5 高 $6 描边色
figure() {
  local out="$1" body="$2" face="$3" W="${4:-1024}" H="${5:-1024}" ol="${6:-#2a1a10}"
  local cx=$((W/2)) hy=$((H*30/100)) hr=$((W*17/100)) bx0=$((W*36/100)) bx1=$((W*64/100)) by0=$((H*44/100)) by1=$((H*90/100))
  local mask="$WORK/mask_$RANDOM.png" tex
  magick -size "${W}x${H}" xc:black -fill white -draw "roundrectangle $bx0,$by0 $bx1,$by1 $((W/12)),$((W/12))" -draw "circle $cx,$hy $cx,$((hy-hr))" "$mask"
  tex=$(fillimg "$W" "$H" "$body")
  magick -size "${W}x${H}" "xc:$BG" \( "$tex" "$mask" -alpha off -compose copy-opacity -composite \) -compose over -composite \
    -stroke "$ol" -strokewidth $((W/90)) -fill none -draw "roundrectangle $bx0,$by0 $bx1,$by1 $((W/12)),$((W/12))" -draw "circle $cx,$hy $cx,$((hy-hr))" \
    -stroke none -fill "$face" -draw "circle $cx,$((hy+hr/5)) $cx,$((hy-hr*6/10))" \
    -fill '#1b1410' -draw "circle $((cx-hr/3)),$((hy+hr/6)) $((cx-hr/3)),$((hy+hr/6-hr/9))" -draw "circle $((cx+hr/3)),$((hy+hr/6)) $((cx+hr/3)),$((hy+hr/6-hr/9))" \
    -stroke '#6b3a1a' -strokewidth $((W/40)) -draw "line $((W*28/100)),$((H*92/100)) $((W*22/100)),$((H*12/100))" \
    -stroke none -fill '#c0392b' -draw "polygon $((W*19/100)),$((H*14/100)) $((W*25/100)),$((H*14/100)) $((W*22/100)),$((H*5/100))" \
    -blur 0x1.2 "$out"
}
BG="$G"
figure "$OUT/baiqi.png"  '#2c2f3a' '#e8c39e'
figure "$OUT/sunbin.png" '#2e6fb8' '#f0d2b0'
figure "$OUT/paper.png"  '#f7f5ee' '#ffffff' 1024 1024 '#333333'   # 白色纸兵：验证白色主体不被抠掉
figure "$OUT/shield.png" '#c8b260' '#f7f5ee'
figure "$OUT/kite.png"   '#e9e2cf' '#ffffff' 1024 1024 '#444444'
figure "$OUT/elite.png"  '#b0302a' '#f7f5ee'
figure "$OUT/boss.png"   '#c9ccd6' '#f6dcc0' 1024 1280
figure "$OUT/lv.png"     '#8e5a2b' '#f2cfa4' 1280 1280
magick -size 1280x768 "xc:$G" -fill '#7a4a26' -stroke '#2a1a10' -strokewidth 12 -draw "roundrectangle 240,240 1000,600 120,120" \
  -fill '#ff7b1c' -draw "circle 1080,300 1080,200" -fill '#f1c40f' -draw "polygon 1040,200 1000,80 1090,190" -blur 0x1.2 "$OUT/ox.png"
figure "$OUT/portrait_baiqi.png" '#2c2f3a' '#e8c39e' 1024 1536
magick -size 1024x1024 "xc:$G" -fill '#d35400' -stroke '#2a1a10' -strokewidth 18 -draw "roundrectangle 120,120 904,904 160,160" -fill '#ffd27a' -stroke none -draw "circle 512,512 512,300" -blur 0x1.2 "$OUT/icon_fireox.png"

# 地面平铺：环绕模糊的随机噪声，天然无缝；另画一张有明显接缝的坏样本（不在清单里，只给 --check-tile 测）
magick -seed 11 -size 512x512 xc: +noise Random -virtual-pixel tile -blur 0x9 -auto-level -colorspace gray +level-colors '#9a7848','#c8a676' "$OUT/tile.png"
magick -seed 12 -size 512x512 plasma:'#9a7848'-'#c8a676' "$OUT/tile_bad.png"

# 地面装饰 5 件横排（品红底，含绿色草丛，验证品红抠图与等分切图）
magick -size 2560x512 "xc:$M" -stroke '#2a1a10' -strokewidth 10 \
  -fill '#8a8070' -draw "ellipse 256,330 170,110 0,360" \
  -fill '#5a3a1e' -draw "rectangle 700,40 730,480" -fill '#b83a2a' -draw "polygon 730,60 960,110 730,230" \
  -fill '#6b4423' -draw "line 1100,460 1460,60" -fill '#d8dee3' -draw "polygon 1440,40 1500,60 1470,110" \
  -fill none -stroke '#6b4423' -strokewidth 34 -draw "circle 1792,256 1792,80" -draw "line 1792,80 1792,432" -draw "line 1616,256 1968,256" \
  -stroke '#2a1a10' -strokewidth 8 -fill '#5f9e2e' -draw "polygon 2140,470 2200,120 2260,470" -draw "polygon 2240,470 2330,60 2400,470" -draw "polygon 2360,470 2440,180 2490,470" \
  -blur 0x1.2 "$OUT/deco.png"
# 道具 5 件横排（品红底，经验玉含绿色）
magick -size 1280x256 "xc:$M" -stroke '#2a1a10' -strokewidth 8 \
  -fill '#d9a521' -draw "circle 128,128 128,40" -fill '#2a1a10' -draw "rectangle 112,112 144,144" \
  -fill '#6fe39a' -draw "polygon 384,60 430,128 384,196 338,128" \
  -fill '#57d2ff' -draw "polygon 640,50 694,128 640,206 586,128" \
  -fill '#ff7ad9' -draw "polygon 896,40 956,128 896,216 836,128" \
  -fill '#f1c40f' -draw "roundrectangle 1080,50 1200,206 20,20" -blur 0x1 "$OUT/items.png"
# 粉色经验玉接近品红，不能放品红底：单独出一张绿底 items_3.png，流水线会优先用单帧原图（覆盖条带里的第 3 格）
magick -size 256x256 "xc:$G" -stroke '#2a1a10' -strokewidth 8 -fill '#ff7ad9' -draw "polygon 128,40 188,128 128,216 68,128" -blur 0x1 "$OUT/items_3.png"
# 主菜单背景（不透明）
magick -seed 13 -size 1024x1792 plasma:'#3a1f14'-'#c09060' -blur 0x2 "$OUT/bg_menu.png"

if [ $FULL = 1 ]; then
  figure "$OUT/portrait_sunbin.png" '#2e6fb8' '#f0d2b0' 1024 1536
  figure "$OUT/portrait_boss.png"   '#c9ccd6' '#f6dcc0' 1024 1536
  for k in halberd bagua swordring crossbow fireox_evo tally; do
    SEED=$((SEED+1)); tex=$(fillimg 1024 1024 '#8a5a2b')
    magick -size 1024x1024 "xc:$G" \( "$tex" \( -size 1024x1024 xc:black -fill white -draw "roundrectangle 120,120 904,904 160,160" \) -alpha off -compose copy-opacity -composite \) -compose over -composite \
      -fill none -stroke '#2a1a10' -strokewidth 18 -draw "roundrectangle 120,120 904,904 160,160" -fill '#f4ecd6' -stroke none -draw "circle 512,512 512,330" "$OUT/icon_$k.png"
  done
  tex=$(fillimg 1024 1024 '#6ff3e0'); magick -size 1024x1024 "xc:$G" \( "$tex" \( -size 1024x1024 xc:black -fill white -draw "circle 512,512 512,40" \) -alpha off -compose copy-opacity -composite \) -compose over -composite "$OUT/bagua.png"
  tex=$(fillimg 1280 384 '#c8b260'); magick -size 1280x384 "xc:$G" \( "$tex" \( -size 1280x384 xc:black -fill white -draw "roundrectangle 40,40 1240,344 40,40" \) -alpha off -compose copy-opacity -composite \) -compose over -composite "$OUT/ui_card.png"
  magick -seed 21 -size 1024x1820 plasma:'#2a160e'-'#e0c090' -blur 0x2 "$OUT/card_bg.png"
  magick -seed 22 -size 1024x1024 xc: +noise Random -virtual-pixel tile -blur 0x4 -auto-level -colorspace gray +level-colors '#8f6d40','#cfae7e' "$OUT/tile.png"
fi
echo "✅ 占位原图已生成：$OUT（中间文件留在 $WORK，未删除）"; ls -1 "$OUT"
