#!/usr/bin/env python3
"""
build-inspect-maps.py — the real-time half of the challenge-coin pipeline.

The coin inspector (src/components/heat/CoinInspector.tsx) draws each coin in
WebGL from the SAME relief build-coin-maps.py makes for the Blender renders, so
the inspect view is a lit, reflective metal coin rather than a photo of one.
For one face (a `<name>.height.npy` + `<name>.mask.png` pair) it writes three
WebP textures next to the coin art:

  <out>-h.webp   height (L, 8-bit, 0..1 as in the .npy), drives vertex displacement
  <out>-n.webp   tangent-space normal map (OpenGL / +Y up), the fine detail
  <out>-s.webp   surface (RGBA): R polished metal, G enamel, B frosted field,
                 A cavity (1 = open, 0 = deep recess) for the tier's patina

Tier colours are NOT baked in; the inspector applies them, so one map pair
serves every tier that shares a relief.

  python3 scripts/coins/build-inspect-maps.py work/front-gold public/coins/3d/iem-cologne-2026-gold
  python3 scripts/coins/build-inspect-maps.py work/back         public/coins/3d/_back
  python3 scripts/coins/build-inspect-maps.py work/back-diamond public/coins/3d/_back-diamond

Keep RELIEF in sync with render-coin.py (height 1.0 → 0.034 R).
"""

import argparse
import os

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

RELIEF = 0.034  # height-field 1.0 → coin-radius units (render-coin.py)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", help="input prefix (reads .height.npy + .mask.png)")
    ap.add_argument("out", help="output prefix (writes -h/-n/-s.webp)")
    ap.add_argument("--size", type=int, default=2048)
    args = ap.parse_args()

    h = np.load(args.src + ".height.npy").astype(np.float32)
    mask = np.array(Image.open(args.src + ".mask.png").convert("RGB")).astype(np.float32) / 255.0
    n = h.shape[0]

    # Normal map. One pixel spans 2R/n of coin; slope = dh * RELIEF / (2/n).
    k = RELIEF * n / 2.0
    hs = gaussian_filter(h, 0.6)  # kill single-pixel aliasing on hard die edges
    dy_img, dx = np.gradient(hs)
    dy = -dy_img  # image rows run down; the map is +Y up
    nx, ny, nz = -dx * k, -dy * k, np.ones_like(h)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.stack([nx * inv, ny * inv, nz * inv], -1) * 0.5 + 0.5

    # Cavity: how far a point sits below its neighbourhood (recesses read darker).
    blur = gaussian_filter(h, 6.0)
    cavity = np.clip(1.0 - np.maximum(blur - h, 0.0) * 9.0, 0.0, 1.0)

    surf = np.concatenate([mask, cavity[..., None]], -1)
    height = np.clip(h, 0.0, 1.0)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    size = (args.size, args.size)

    def save(arr, mode, suffix, **kw):
        im = Image.fromarray((arr * 255.0 + 0.5).astype(np.uint8), mode)
        if im.size != size:
            im = im.resize(size, Image.LANCZOS)
        path = f"{args.out}-{suffix}.webp"
        im.save(path, "WEBP", method=6, **kw)
        print(f"{path} {os.path.getsize(path) // 1024} KB")

    save(height, "L", "h", lossless=True)
    save(normal, "RGB", "n", quality=92)
    save(surf, "RGBA", "s", lossless=True)


if __name__ == "__main__":
    main()
