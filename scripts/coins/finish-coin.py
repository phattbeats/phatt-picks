#!/usr/bin/env python3
"""
finish-coin.py — step 3 of the challenge-coin pipeline (#1278).

Takes a raw Cycles render from render-coin.py and ships it:
  face    crop tight to the disc (alpha bbox), square, resize to --size
          (default 640), palette-compress with pngquant  → public/coins/*.png
  beauty  crop to the coin + a little air, resize, pngquant
  felt    flatten + resize the felt compartment tile, WebP  → public/coins/felt-slot.webp

pngquant (libimagequant) keeps the metal gradients clean at ~100-150 KB; if it
isn't on PATH (`pip install pngquant-cli` ships one) it falls back to Pillow's
quantizer, which dithers more but stays well under budget.

  python3 scripts/coins/finish-coin.py face   work/front-gold.png public/coins/iem-cologne-2026-gold.png
  python3 scripts/coins/finish-coin.py face   work/back-gold.png  public/coins/_back-gold.png
  python3 scripts/coins/finish-coin.py felt   work/felt.png       public/coins/felt-slot.webp
"""

import argparse
import os
import shutil
import subprocess
import tempfile

from PIL import Image


def pngquant_bin():
    return os.environ.get("PNGQUANT") or shutil.which("pngquant")


def save_png(im, out):
    pq = pngquant_bin()
    with tempfile.TemporaryDirectory() as td:
        raw = os.path.join(td, "raw.png")
        im.save(raw, optimize=True)
        if pq:
            subprocess.run([pq, "--quality", "80-98", "--speed", "1", "--strip", "--force", "--output", out, raw], check=True)
        else:
            im.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(out, optimize=True)
    print(out, os.path.getsize(out) // 1024, "KB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["face", "beauty", "felt"])
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--size", type=int, default=0)
    a = ap.parse_args()

    im = Image.open(a.src)
    if a.mode == "felt":
        im = im.convert("RGB")
        w = a.size or 600
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        im.save(a.out, "WEBP", quality=93, method=6)
        print(a.out, os.path.getsize(a.out) // 1024, "KB")
        return

    im = im.convert("RGBA")
    bbox = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    im = im.crop(bbox)
    if a.mode == "face":
        side = max(im.size)
        sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
        size = a.size or 640
        im = sq.resize((size, size), Image.LANCZOS)
    else:
        pad = round(max(im.size) * 0.04)
        canvas = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
        canvas.paste(im, (pad, pad))
        w = a.size or 480
        im = canvas.resize((w, round(canvas.height * w / canvas.width)), Image.LANCZOS)
    save_png(im, a.out)


if __name__ == "__main__":
    main()
