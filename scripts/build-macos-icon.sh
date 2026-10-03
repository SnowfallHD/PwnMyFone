#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
iconset=.tools/art/PwnMyFone.iconset
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
 magick -background none src-tauri/icons/app-icon.svg -resize "${size}x${size}" -depth 8 "PNG32:$iconset/icon_${size}x${size}.png"
 double=$((size * 2))
 magick -background none src-tauri/icons/app-icon.svg -resize "${double}x${double}" -depth 8 "PNG32:$iconset/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$iconset" -o src-tauri/icons/PwnMyFone.icns
