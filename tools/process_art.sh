#!/usr/bin/env bash
# 《七雄割草传》抠图流水线：Flow 绿底（#00FF00）/品红底（#FF00FF）原图 → 透明底 PNG（≤256 色）→ img/ → assets_data.js
# 依赖：ImageMagick 7（magick）、Node（只用自带模块）。不联网、不删除任何文件，同名输出直接覆盖（输出目录是生成物）。
#
# 用法：
#   tools/process_art.sh [-i 原图目录] [-o 输出目录] [-d 数据文件 | -n] [-b 预算字节]
#   tools/process_art.sh --check-tile 图片        # 只检查一张平铺图是否无缝
# 默认：-i art/selected  -o img  -d assets_data.js  -b 1258291（1.2 MB）
#
# 原图命名（按 assets.js 清单的 file 名）：
#   baiqi.png、paper.png、icon_fireox.png …；地面 tile.png（不抠绿）；背景 bg_menu.png、card_bg.png（不抠绿）
#   deco / items 两种：要么给一张横排 N 个物件的 deco.png（按 N 等分切），要么直接给 deco_0.png … deco_4.png
#   背景色自动识别：左上角是纯绿就抠绿，是品红就抠品红（草丛、经验玉这类绿色物件请用品红底）
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IN="$ROOT/art/selected"; OUT="$ROOT/img"; DATA="$ROOT/assets_data.js"; BUDGET=1258291
KEY_T0="${KEY_T0:-0.08}"   # 绿色程度低于此值完全保留
KEY_TW="${KEY_TW:-0.22}"   # 过渡带宽度（越大边缘越柔）
DITHER="${DITHER:-None}"   # 量化抖动：None（卡通平涂更干净、更小）/ FloydSteinberg
JPG_Q="${JPG_Q:-82}"

seam_check() { # $1 图片 → 打印接缝比，返回 0 无缝 / 1 可疑
  local f="$1" w h e1 e2 i1 i2
  w=$(magick identify -format '%w' "$f"); h=$(magick identify -format '%h' "$f")
  rmse() { magick compare -metric RMSE "$1" "$2" null: 2>&1 | sed -E 's/.*\(([0-9.e-]+)\).*/\1/'; }
  local T; T="$(mktemp -d "${TMPDIR:-/tmp}/qx-seam-XXXXXX")"
  magick "$f" -alpha off -crop 1x${h}+0+0 +repage "$T/c0.png"; magick "$f" -alpha off -crop 1x${h}+$((w-1))+0 +repage "$T/cw.png"
  magick "$f" -alpha off -crop 1x${h}+$((w/2-1))+0 +repage "$T/m0.png"; magick "$f" -alpha off -crop 1x${h}+$((w/2))+0 +repage "$T/m1.png"
  magick "$f" -alpha off -crop ${w}x1+0+0 +repage "$T/r0.png"; magick "$f" -alpha off -crop ${w}x1+0+$((h-1)) +repage "$T/rh.png"
  magick "$f" -alpha off -crop ${w}x1+0+$((h/2-1)) +repage "$T/n0.png"; magick "$f" -alpha off -crop ${w}x1+0+$((h/2)) +repage "$T/n1.png"
  e1=$(rmse "$T/c0.png" "$T/cw.png"); i1=$(rmse "$T/m0.png" "$T/m1.png")
  e2=$(rmse "$T/r0.png" "$T/rh.png"); i2=$(rmse "$T/n0.png" "$T/n1.png")
  echo "   临时目录（未删除）：$T" >&2
  node -e '
    const [e1,i1,e2,i2]=process.argv.slice(1).map(Number);
    const r1=e1/Math.max(i1,1e-4), r2=e2/Math.max(i2,1e-4);
    const bad=r1>2.5||r2>2.5;
    console.log("   接缝检查："+(bad?"⚠️ 可疑":"✅ 无缝")+"  左右边差 "+e1.toFixed(4)+" / 内部相邻列 "+i1.toFixed(4)+" = "+r1.toFixed(2)+"×；上下边差 "+e2.toFixed(4)+" / 内部相邻行 "+i2.toFixed(4)+" = "+r2.toFixed(2)+"×（>2.5× 判可疑）");
    process.exit(bad?1:0);' "$e1" "$i1" "$e2" "$i2"
}

if [ "${1:-}" = "--check-tile" ]; then seam_check "$2"; exit $?; fi

while getopts "i:o:d:nb:" opt; do
  case "$opt" in
    i) IN="$OPTARG" ;; o) OUT="$OPTARG" ;; d) DATA="$OPTARG" ;; n) DATA="" ;; b) BUDGET="$OPTARG" ;;
    *) echo "参数不对，见脚本开头说明"; exit 1 ;;
  esac
done
command -v magick >/dev/null || { echo "❌ 找不到 magick"; exit 1; }
[ -d "$IN" ] || { echo "❌ 原图目录不存在：$IN"; exit 1; }
mkdir -p "$OUT"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/qx-art-XXXXXX")"
echo "🎨 原图：$IN"; echo "   输出：$OUT"; echo "   临时目录（不自动删除，需要时手动清理）：$WORK"

find_raw() { # $1 名称 → 打印原图路径
  local x; for x in png PNG jpg jpeg JPG webp; do [ -f "$IN/$1.$x" ] && { echo "$IN/$1.$x"; return 0; }; done; return 1
}
key_color() { # $1 图片 → green / magenta / unknown（取左上、右上、左下三个角）
  magick "$1" -alpha off -format '%[fx:p{3,3}.r] %[fx:p{3,3}.g] %[fx:p{3,3}.b] %[fx:p{w-4,3}.r] %[fx:p{w-4,3}.g] %[fx:p{w-4,3}.b] %[fx:p{3,h-4}.r] %[fx:p{3,h-4}.g] %[fx:p{3,h-4}.b]\n' info: |
  awk '{ g=0; m=0; for (i=1;i<=9;i+=3){ r=$i; G=$(i+1); b=$(i+2); if (G>0.6 && r<0.45 && b<0.45) g++; if (r>0.6 && b>0.6 && G<0.45) m++ } print (g>=2?"green":(m>=2?"magenta":"unknown")) }'
}
# 抠绿：alpha 按“绿色超出红蓝的程度”软过渡；去溢色把 G 压到 max(R,B)。品红底先反色变成绿底再走同一套，最后反色回来。
# 孔洞保护：只有从四个角连通的背景区（再外扩 2 像素的边缘带）才软抠、去溢色；被人物包住的偏绿像素
#（青袍暗部、玉器、草叶内部）保持原色不透明，不会被抠成洞。HOLES=1 可关闭保护（全图抠）。
keyed() { # $1 输入 $2 输出 $3 green|magenta
  local inv=() w h s="$WORK/k_${4:-x}"
  [ "$3" = "magenta" ] && inv=(-channel RGB -negate +channel)
  w=$(magick identify -format '%w' "$1"); h=$(magick identify -format '%h' "$1")
  magick "$1" -alpha off ${inv[@]+"${inv[@]}"} "$s.src.png"
  magick "$s.src.png" -fx "1-min(1,max(0,(g-max(r,b)-$KEY_T0)/$KEY_TW))" -colorspace gray "$s.soft.png"
  if [ "${HOLES:-0}" = "1" ]; then
    magick "$s.soft.png" -fill black -colorize 100 -negate "$s.edge.png"
  else
    magick "$s.soft.png" -threshold 50% -negate -fill gray50 \
      -draw "color 0,0 floodfill" -draw "color $((w-1)),0 floodfill" -draw "color 0,$((h-1)) floodfill" -draw "color $((w-1)),$((h-1)) floodfill" \
      -fill black -opaque white -fill white -opaque gray50 -morphology Dilate Disk:2 "$s.edge.png"
  fi
  magick "$s.soft.png" \( "$s.edge.png" -negate \) -compose lighten -composite "$s.alpha.png"
  magick "$s.src.png" -channel G -fx "min(g,max(r,b))" +channel "$s.desp.png"
  magick "$s.src.png" \( "$s.desp.png" "$s.edge.png" -alpha off -compose copy-opacity -composite \) -compose over -composite \
    "$s.alpha.png" -alpha off -compose copy-opacity -composite ${inv[@]+"${inv[@]}"} \
    -background none -alpha background -trim +repage "$2"
}

TOTAL=0; COUNT=0; MISS=0; WARN=0
REPORT="$WORK/report.tsv"; : > "$REPORT"
while IFS=$'\t' read -r name raw kind W H fmt n idx; do
  ext=png; [ "$fmt" = "jpg" ] && ext=jpg
  dst="$OUT/$name.$ext"; src=""; piece=""
  if [ "$kind" = "frame" ]; then
    if src=$(find_raw "$name"); then piece="$src"
    elif src=$(find_raw "$raw"); then piece="$WORK/${name}_piece.png"; magick "$src" -crop "${n}x1@" +repage "$WORK/${raw}_col_%d.png" 2>/dev/null; cp "$WORK/${raw}_col_${idx}.png" "$piece"
    fi
  else
    src=$(find_raw "$raw") && piece="$src"
  fi
  if [ -z "$piece" ]; then MISS=$((MISS+1)); printf '%s\t缺原图\t-\t-\n' "$name" >> "$REPORT"; continue; fi

  case "$kind" in
    tile)
      magick "$piece" -alpha off -resize "${W}x${H}!" -strip -depth 8 -dither "$DITHER" -colors 256 "png:$dst"
      seam_check "$dst" || WARN=$((WARN+1)) ;;
    opaque)
      if [ "$ext" = "jpg" ]; then
        magick "$piece" -alpha off -resize "${W}x${H}^" -gravity center -extent "${W}x${H}" -strip -quality "$JPG_Q" -sampling-factor 4:2:0 -interlace none "jpg:$dst"
      else
        magick "$piece" -alpha off -resize "${W}x${H}^" -gravity center -extent "${W}x${H}" -strip -depth 8 -dither "$DITHER" -colors 256 "png:$dst"
      fi ;;
    *)
      kc=$(key_color "$piece")
      if [ "$kc" = "unknown" ]; then echo "   ⚠️ $name：背景不是纯绿也不是品红，跳过（请让 Flow 用 #00FF00 或 #FF00FF 纯色底）"; WARN=$((WARN+1)); printf '%s\t背景色不对\t-\t-\n' "$name" >> "$REPORT"; continue; fi
      keyed "$piece" "$WORK/$name.keyed.png" "$kc" "$name"
      if [ "$W" != "0" ]; then fit=(-resize "${W}x${H}" -gravity center -background none -extent "${W}x${H}"); else fit=(-resize "x${H}"); fi
      magick "$WORK/$name.keyed.png" "${fit[@]}" -strip -depth 8 -dither "$DITHER" -colors 256 "png:$dst"
      # 边缘预览：深色、浅色底各合成一份，供人工检查绿边/品红边（去溢色后数值检查恒为 0，没有意义）
      magick \( "$dst" -background '#2a1a10' -flatten \) \( "$dst" -background '#f4ecd6' -flatten \) +append "$WORK/preview_$name.png" ;;
  esac
  sz=$(stat -f%z "$dst"); TOTAL=$((TOTAL+sz)); COUNT=$((COUNT+1))
  info=$(magick identify -format '%wx%h %[type]' "$dst")
  printf '%s\t%s\t%s\t%s\n' "$name.$ext" "$sz" "$info" "${kc:-不抠}" >> "$REPORT"; kc=""
done < <(node "$ROOT/tools/manifest.js" "$ROOT/assets.js")

echo; echo "📋 成品清单"
awk -F'\t' '{ if ($2 ~ /^[0-9]+$/) printf "   %-24s %8.1f KB  %-22s %s\n", $1, $2/1024, $3, $4; else printf "   %-24s %s\n", $1, $2 }' "$REPORT"
printf "\n   共 %d 张，缺原图 %d 个键；图片总量 %.1f KB / 预算 %.1f KB\n" "$COUNT" "$MISS" "$(echo "$TOTAL/1024" | bc -l)" "$(echo "$BUDGET/1024" | bc -l)"
code=0
if [ "$TOTAL" -gt "$BUDGET" ]; then echo "   🚨 超出图片预算 $(( (TOTAL-BUDGET)/1024 )) KB：降立绘/背景尺寸、改 jpg 或减色数"; code=2; fi
[ "$WARN" -gt 0 ] && echo "   ⚠️ 有 $WARN 条警告，见上方"
if ls "$WORK"/preview_*.png >/dev/null 2>&1; then
  magick "$WORK"/preview_*.png -background '#777777' -gravity west -splice 6x6 -append "$WORK/边缘预览.png" 2>/dev/null && echo "   🔎 抠图边缘预览（深/浅底对照，请目视检查）：$WORK/边缘预览.png"
fi
if [ -n "$DATA" ]; then echo; node "$ROOT/tools/build_data.js" "$OUT" "$DATA" "$ROOT/assets.js" || code=1; fi
exit $code
