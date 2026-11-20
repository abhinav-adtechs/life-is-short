#!/bin/sh
# Turns the recorded frames into docs/media/showcase.mp4, the README's highlight GIF and docs/images/dump.gif.
# Run after record.mjs. Needs ffmpeg. The GIF cuts are seconds into the video: re-check them if a scene changes length.
set -e
cd "$(dirname "$0")"
MEDIA=../../docs/media IMAGES=../../docs/images
mkdir -p "$MEDIA"
ffmpeg -y -loglevel error -f concat -safe 0 -i out/frames.txt -vf "fps=30,format=yuv420p" \
  -c:v libx264 -preset slow -crf 20 -profile:v high -level 4.1 -movflags +faststart -an "$MEDIA/showcase.mp4"

# gif OUT WIDTH FPS SPEED START:END...
gif() {
  out=$1 width=$2 fps=$3 speed=$4; shift 4
  f="" l="" i=0
  for s in "$@"; do f="$f[0:v]trim=${s%:*}:${s#*:},setpts=PTS-STARTPTS[s$i];"; l="$l[s$i]"; i=$((i + 1)); done
  ffmpeg -y -loglevel error -i "$MEDIA/showcase.mp4" -filter_complex \
    "${f}${l}concat=n=$i:v=1:a=0,setpts=PTS/$speed,fps=$fps,scale=$width:-1:flags=lanczos,split[x][y];[x]palettegen=max_colors=192:stats_mode=diff[p];[y][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
    -loop 0 "$out"
}
# The planner, a dump and Done, a tick on the map, the themes, the phone: 1.5x speed.
gif "$MEDIA/showcase.gif" 1280 15 1.5 5.0:9.5 13.0:27.6 40.0:48.5 65.5:71.0 76.5:80.5
# The dump on its own, cropped to the app window.
ffmpeg -y -loglevel error -i "$MEDIA/showcase.mp4" -filter_complex \
  "[0:v]trim=10.6:24.0,setpts=PTS-STARTPTS,crop=1536:880:192:70,fps=12,scale=1080:-1:flags=lanczos,split[x][y];[x]palettegen=max_colors=160:stats_mode=diff[p];[y][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  -loop 0 "$IMAGES/dump.gif"
ls -la "$MEDIA" "$IMAGES/dump.gif"
