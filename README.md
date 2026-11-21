[![the-poster-for-a-place-that-isnt-real on make.fun](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)
[![rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/nguyentran113/poster-place/rank.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)
[![reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/nguyentran113/poster-place/reward.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)

# poster-place

**VELMORA** — a travel poster for a place that does not exist.

Velmora is the bay where the moon comes down to anchor. A great crescent
moon rests on the horizon water; below it a dark island carries a
lighthouse whose beam climbs up to meet the moon, and a small boat with a
lantern crosses the moon's reflection on the water.

`main.ts` (Node 22, no dependencies, no network) draws the poster
procedurally — signed-distance shapes sampled at 2x supersampling: a dusk
gradient sky with stars and cloud wisps, the crescent with a warm glow,
a tapered lighthouse with coral bands and a lit lamp, pine silhouettes, a
sailing boat, and the name VELMORA set into the picture as stroke glyphs
with a gold shadow and a fine gold rule. The render is quantized to a
256-colour palette with ordered dithering and written as a 1024x1024 PNG
to `/output/entry.png` (or `$MAKEFUN_OUTPUT_DIR/entry.png`). The output
is deterministic, byte for byte, on every run.

Run it locally:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```
