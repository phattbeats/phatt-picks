#!/usr/bin/env python3
"""
build-coin-maps.py — step 1 of the challenge-coin render pipeline (#1278).

Builds the RELIEF for one coin face: a float32 height field (`<name>.height.npy`)
plus an RGB finish mask (`<name>.mask.png`: R = polished metal, G = enamel,
B = frosted field) that render-coin.py (Blender/Cycles) turns into real
geometry + PBR materials. Pure PIL + numpy (+ scipy for the bevel blur).

Layout, in disc-radius units (1.0 = coin edge):
  0.872–1.000  raised polished rim (rounded outer edge — the reeded wall starts here)
  0.715–0.872  enamel band carrying arc lettering + two bullets/gem collets
  0.695–0.715  polished inner bead ring
  0.000–0.695  frosted field with the polished device (Major logo / CS2 mark)

Faces:
  front  --logo <major logo PNG> --top "CHALLENGE COIN" --bottom "<TIER>"
  back   --logo <CS2 PNG> --sub-logo <HOTLINE symbol PNG> --top ... --bottom ...
  --gems puts brilliant-cut collets (seats) at 3 and 9 o'clock (diamond tier);
  render-coin.py drops real gems into them.

Re-render for the next Major: see the header of scripts/coins/render-coin.py.
"""

import argparse
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter

N = 2048          # output resolution (square, the disc fills it)
SS = 2            # supersample for crisp antialiased masks
R_RIM_IN = 0.872
R_BAND_IN = 0.715
R_BEAD_IN = 0.695
R_TEXT = 0.7935   # arc-text centreline
GEM_R = 0.052     # gem girdle radius (collet sits just outside)

H_FIELD = 0.30
H_ENAMEL = 0.44
H_RELIEF = 0.86
H_RIM = 1.00


def radial(n):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    c = (n - 1) / 2.0
    return (x - c) / (n / 2.0), (c - y) / (n / 2.0)  # y up


def to_px(xu, yu, n):
    return ((xu + 1) * n / 2.0, (1 - yu) * n / 2.0)


def load_alpha(path, invert_lum=False):
    im = Image.open(path).convert("RGBA")
    a = np.array(im)[..., 3].astype(np.float32) / 255.0
    if invert_lum:
        # Dark-ink logo whose white details (e.g. the ESL roundel stripes) are
        # opaque white — keep only the inked pixels so the details recess.
        lum = np.array(im.convert("RGB").convert("L")).astype(np.float32) / 255.0
        a = a * np.clip((0.75 - lum) / 0.2, 0, 1)
    ys, xs = np.where(a > 0.05)
    a = a[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
    return Image.fromarray((a * 255).astype(np.uint8), "L")


def paste_fit(canvas, img, cx, cy, max_w, max_h, n):
    """Paste L image scaled to fit (max_w x max_h radius units) centred at (cx, cy)."""
    s = min(max_w / img.width, max_h / img.height) * n / 2.0
    w, h = max(1, round(img.width * s)), max(1, round(img.height * s))
    im = img.resize((w, h), Image.LANCZOS)
    px, py = to_px(cx, cy, n)
    canvas.paste(255, (round(px - w / 2), round(py - h / 2)), im)


def arc_text(canvas, text, font, radius, centre_deg, n, tracking=0.0, bottom=False):
    """Letters upright on an arc. Top arc reads clockwise with tops outward; the
    bottom arc reads left→right with tops toward the centre (coin convention)."""
    r_px = radius * n / 2.0
    cap = font.getbbox("H")[3] - font.getbbox("H")[1]
    raw = sum(font.getlength(ch) for ch in text)
    # Auto-fit: long legends tighten their tracking so the arc stays clear of
    # the 3 / 9 o'clock bullets (max ~132 degrees of arc).
    max_len = math.radians(132) * r_px
    if raw + tracking * (len(text) - 1) > max_len:
        tracking = max(0.0, (max_len - raw) / max(1, len(text) - 1))
    adv = [font.getlength(ch) + tracking for ch in text]
    total = sum(adv) - tracking
    span = total / r_px  # radians
    cum = 0.0
    for ch, a in zip(text, adv):
        mid = cum + (a - tracking) / 2.0
        cum += a
        if ch == " ":
            continue
        if bottom:
            th = math.radians(centre_deg) - span / 2 + mid / r_px
            rot = math.degrees(th) + 90
        else:
            th = math.radians(centre_deg) + span / 2 - mid / r_px
            rot = math.degrees(th) - 90
        w = int(font.getlength(ch)) + 8
        hgt = cap * 2
        g = Image.new("L", (w, hgt), 0)
        ImageDraw.Draw(g).text((4, hgt / 2 + cap / 2), ch, font=font, fill=255, anchor="ls")
        g = g.rotate(rot, resample=Image.BICUBIC, expand=True)
        px, py = to_px(radius * math.cos(th), radius * math.sin(th), n)
        canvas.paste(255, (round(px - g.width / 2), round(py - g.height / 2)), g)


def polygon(canvas, pts_unit, n):
    ImageDraw.Draw(canvas).polygon([to_px(x, y, n) for x, y in pts_unit], fill=255)


def star(canvas, cx, cy, r_out, n, points=5, inner=0.42, rot=90):
    pts = []
    for k in range(points * 2):
        rr = r_out if k % 2 == 0 else r_out * inner
        a = math.radians(rot + k * 180 / points)
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    polygon(canvas, pts, n)


def lozenge(canvas, cx, cy, r, n, ang):
    """A small four-point diamond bullet, long axis along the band tangent."""
    t = (math.cos(ang + math.pi / 2), math.sin(ang + math.pi / 2))
    rd = (math.cos(ang), math.sin(ang))
    pts = [
        (cx + t[0] * r, cy + t[1] * r),
        (cx + rd[0] * r * 0.55, cy + rd[1] * r * 0.55),
        (cx - t[0] * r, cy - t[1] * r),
        (cx - rd[0] * r * 0.55, cy - rd[1] * r * 0.55),
    ]
    polygon(canvas, pts, n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="output prefix (writes .height.npy + .mask.png)")
    ap.add_argument("--logo", required=True)
    ap.add_argument("--logo-invert-lum", action="store_true", help="logo is dark-on-transparent (use alpha only)")
    ap.add_argument("--logo-w", type=float, default=1.16)
    ap.add_argument("--logo-h", type=float, default=0.66)
    ap.add_argument("--logo-y", type=float, default=0.0)
    ap.add_argument("--sub-logo", default=None)
    ap.add_argument("--sub-logo-h", type=float, default=0.30)
    ap.add_argument("--sub-logo-y", type=float, default=0.30)
    ap.add_argument("--top", default="CHALLENGE COIN")
    ap.add_argument("--bottom", default="")
    ap.add_argument("--font", required=True)
    ap.add_argument("--font-size", type=float, default=0.112, help="cap-ish size in radius units")
    ap.add_argument("--tracking", type=float, default=0.30, help="extra letter spacing, x font size")
    ap.add_argument("--gems", action="store_true")
    args = ap.parse_args()

    n = N * SS
    x, y = radial(n)
    r = np.hypot(x, y)

    relief = Image.new("L", (n, n), 0)  # polished raised device + lettering (non-rim)

    # Device
    logo = load_alpha(args.logo, args.logo_invert_lum)
    if args.sub_logo:
        sub = load_alpha(args.sub_logo)
        paste_fit(relief, sub, 0, args.sub_logo_y, 1.0, args.sub_logo_h, n)
    paste_fit(relief, logo, 0, args.logo_y, args.logo_w, args.logo_h, n)

    # Arc lettering
    fpx = int(args.font_size * n / 2.0 * 1.38)
    font = ImageFont.truetype(args.font, fpx)
    trk = args.tracking * fpx
    if args.top:
        arc_text(relief, args.top, font, R_TEXT, 90, n, tracking=trk)
    if args.bottom:
        arc_text(relief, args.bottom, font, R_TEXT, 270, n, tracking=trk, bottom=True)

    # 3 / 9 o'clock: lozenge bullets, or gem collets for the diamond tier.
    collet = np.zeros((n, n), np.float32)
    seat = np.zeros((n, n), bool)
    for ang in (0.0, math.pi):
        cx, cy = R_TEXT * math.cos(ang), R_TEXT * math.sin(ang)
        if args.gems:
            d = np.hypot(x - cx, y - cy)
            collet = np.maximum(collet, ((d > GEM_R * 0.92) & (d < GEM_R * 1.30)).astype(np.float32))
            seat |= d <= GEM_R * 0.92
        else:
            lozenge(relief, cx, cy, 0.040, n, ang)

    rel = np.array(relief).astype(np.float32) / 255.0
    rel = np.maximum(rel, collet)
    # Inner bead ring
    ring = ((r >= R_BEAD_IN) & (r <= R_BAND_IN)).astype(np.float32)
    raised = np.maximum(rel, ring)

    # Downsample (antialias) then bevel blur
    def down(a):
        return a.reshape(N, SS, N, SS).mean(axis=(1, 3))

    raised = down(raised)
    seat_d = down(seat.astype(np.float32))
    xs, ys = radial(N)
    rr = np.hypot(xs, ys)
    bev = gaussian_filter(raised, 1.6)
    bev = np.clip((bev - 0.5) * 1.35 + 0.5, 0, 1)
    bev = bev * bev * (3 - 2 * bev)  # smoothstep: rounded die-struck shoulder

    base = np.where(rr < R_BEAD_IN + 0.01, H_FIELD, H_ENAMEL).astype(np.float32)
    h = base + (H_RELIEF - base) * bev
    # Gem seats sink to the field so the stone sits low in its collet.
    h = np.where(seat_d > 0.5, H_FIELD - 0.1, h)

    # Rim (analytic): inner shoulder 0.858→0.872 rises to H_RIM, outer edge rounds off.
    t = np.clip((rr - (R_RIM_IN - 0.016)) / 0.016, 0, 1)
    t = t * t * (3 - 2 * t)
    h = h + (H_RIM - h) * t
    o = np.clip((rr - 0.972) / 0.028, 0, 1)
    h = h - 0.62 * o * o
    h[rr > 1.0] = H_RIM - 0.62

    polish = np.clip(np.maximum(bev, (rr > R_RIM_IN - 0.006).astype(np.float32)), 0, 1)
    enamel = np.clip(((rr > R_BAND_IN + 0.004) & (rr < R_RIM_IN - 0.004)).astype(np.float32) - bev, 0, 1)
    enamel = enamel * (1 - seat_d)
    frosted = np.clip(1 - polish - enamel, 0, 1)

    np.save(args.out + ".height.npy", h.astype(np.float32))
    mask = np.stack([polish, enamel, frosted], -1)
    Image.fromarray((mask * 255).astype(np.uint8), "RGB").save(args.out + ".mask.png")
    prev = Image.fromarray((np.clip(h, 0, 1) * 255).astype(np.uint8), "L").resize((768, 768))
    prev.save(args.out + ".preview.png")
    print("wrote", args.out)


if __name__ == "__main__":
    main()
