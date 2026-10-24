"""Recolour the rendered navy felt tile into the PHATT ID felt unlocks (PHA-4477).

The navy tile (public/coins/felt-slot.webp) is a Blender render: the weave,
the recessed well and the apron's light all live in its luminance. Each variant
keeps that luminance and swaps the hue, so every felt is lit exactly like the
original. Gold-trim black also gets a thin gilt inlay just inside the edge.

    python3 scripts/coins/recolour-felt.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "public/coins/felt-slot.webp"

# Target colour at the tile's mean brightness; brighter/darker texels scale from it.
FELTS = {
    "oxblood": (52, 16, 20),
    "forest": (18, 42, 28),
    "velvet": (22, 22, 25),
    "royal": (38, 22, 60),
    "gold": (20, 18, 15),
}


def recolour(src: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    grey = src.convert("L")
    mean = sum(grey.getdata()) / (grey.width * grey.height)
    bands = []
    for c in rgb:
        k = c / mean
        bands.append(grey.point(lambda v, k=k: max(0, min(255, round(v * k)))))
    return Image.merge("RGB", bands)


def gild(im: Image.Image) -> Image.Image:
    d = ImageDraw.Draw(im)
    w, h = im.size
    inset = round(w * 0.035)
    for i, col in enumerate([(120, 92, 40), (201, 160, 76), (120, 92, 40)]):
        d.rectangle([inset + i, inset + i, w - 1 - inset - i, h - 1 - inset - i], outline=col)
    return im


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    for key, rgb in FELTS.items():
        out = recolour(src, rgb)
        if key == "gold":
            out = gild(out)
        dest = ROOT / f"public/coins/felt-{key}.webp"
        out.save(dest, "WEBP", quality=88, method=6)
        print(dest.relative_to(ROOT), dest.stat().st_size)


if __name__ == "__main__":
    main()
