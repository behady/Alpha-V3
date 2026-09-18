"""
Renders the reel's Arabic subtitles as transparent PNGs, one per beat.

    python scripts/make-promo-subs.py --vo <vo dir> --out <dir> [--width 1920]

Why PNGs and not a subtitle track:

  * WhatsApp does not render soft subtitles. Anything that must be read has to be burned in.
  * ffmpeg's `drawtext` is not an option here: it segfaults on this machine (no fontconfig), and
    even where it runs it does no Arabic shaping — letters come out isolated and left-to-right.
  * libass would shape correctly, but it also wants fontconfig.

So the shaping is done in Python. Pillow has no raqm build here (`features.check('raqm')` is
False), which means it will not shape Arabic either — it draws the code points as given. The fix
is the same one the printed guides use: `arabic_reshaper` picks the correct contextual glyph for
each letter, then `python-bidi` reorders the line into visual order. Draw the result left-to-right
and it reads correctly.

Line breaking happens BEFORE reshaping, on the logical text, because once a line is reshaped and
bidi-reordered, splitting it on a space cuts the visual line in the wrong place.
"""

import argparse
import json
import os

from PIL import Image, ImageDraw, ImageFont
import arabic_reshaper
from bidi.algorithm import get_display

# Segoe UI Bold: present on every Windows install and carries a complete Arabic set. Tahoma,
# which the printed guides used, is not installed on this machine.
FONT_PATH = r"C:\Windows\Fonts\segoeuib.ttf"

FONT_SIZE = 46
LINE_SPACING = 14
# The caption sits in a band across the bottom; the pad is what keeps it off the very edge on a
# phone, where the video is letterboxed into a chat bubble.
BOTTOM_PAD = 70
SIDE_PAD = 120
TEXT_FILL = (255, 255, 255, 255)
# A soft dark plate behind the text. The app's screens are mostly white, and white-on-white is
# the one failure mode that makes subtitles useless.
PLATE_FILL = (0, 0, 0, 170)
PLATE_PAD_X = 34
PLATE_PAD_Y = 22
PLATE_RADIUS = 18


def shape(text):
    """Logical Arabic -> the visual string Pillow can draw without a shaping engine."""
    return get_display(arabic_reshaper.reshape(text))


def wrap(text, font, max_width, draw):
    """Greedy wrap on the LOGICAL text, measuring each candidate line in its shaped form."""
    words = text.split()
    lines, current = [], []
    for word in words:
        trial = current + [word]
        width = draw.textbbox((0, 0), shape(" ".join(trial)), font=font)[2]
        if width <= max_width or not current:
            current = trial
        else:
            lines.append(" ".join(current))
            current = [word]
    if current:
        lines.append(" ".join(current))
    return lines


def render(text, width, height, font, out_path):
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    lines = wrap(text, font, width - 2 * SIDE_PAD, draw)
    shaped = [shape(line) for line in lines]

    metrics = [draw.textbbox((0, 0), s, font=font) for s in shaped]
    line_heights = [m[3] - m[1] for m in metrics]
    line_widths = [m[2] - m[0] for m in metrics]
    block_height = sum(line_heights) + LINE_SPACING * (len(lines) - 1)

    plate_w = max(line_widths) + 2 * PLATE_PAD_X
    plate_h = block_height + 2 * PLATE_PAD_Y
    plate_x = (width - plate_w) // 2
    plate_y = height - BOTTOM_PAD - plate_h

    draw.rounded_rectangle(
        [plate_x, plate_y, plate_x + plate_w, plate_y + plate_h],
        radius=PLATE_RADIUS,
        fill=PLATE_FILL,
    )

    y = plate_y + PLATE_PAD_Y
    for s, m, lh in zip(shaped, metrics, line_heights):
        x = (width - (m[2] - m[0])) // 2
        # textbbox's origin is not the drawing origin: subtract the bearing or every line drifts
        # down by its own ascent.
        draw.text((x - m[0], y - m[1]), s, font=font, fill=TEXT_FILL)
        y += lh + LINE_SPACING

    img.save(out_path)
    return len(lines)


def render_card(title, width, height, out_path):
    """
    A title card for the joins between the walkthrough's parts: dark plate, the part's name in
    Arabic, shaped the same way the subtitles are. "EN | AR" in the title puts the English small
    above the Arabic.
    """
    img = Image.new("RGB", (width, height), (12, 12, 14))
    draw = ImageDraw.Draw(img)
    big = ImageFont.truetype(FONT_PATH, 78)
    small = ImageFont.truetype(FONT_PATH, 34)
    en, _, ar = title.partition("|")
    en, ar = en.strip(), ar.strip() or en.strip()
    shaped = shape(ar)
    bb = draw.textbbox((0, 0), shaped, font=big)
    y = height // 2 - (bb[3] - bb[1]) // 2
    draw.text(((width - (bb[2] - bb[0])) // 2 - bb[0], y - bb[1]), shaped, font=big, fill=(255, 255, 255))
    if en and en != ar:
        sb = draw.textbbox((0, 0), en, font=small)
        draw.text(((width - (sb[2] - sb[0])) // 2 - sb[0], y - 70 - sb[1]), en, font=small, fill=(255, 214, 10))
    # A thin accent rule under the title, the brand's yellow.
    draw.rounded_rectangle([width // 2 - 60, y + (bb[3] - bb[1]) + 34, width // 2 + 60, y + (bb[3] - bb[1]) + 40], radius=3, fill=(255, 214, 10))
    img.save(out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--card", help="render a title card instead of subtitles")
    ap.add_argument("--out-file", help="where the card goes")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    known, _ = ap.parse_known_args()
    if known.card:
        render_card(known.card, known.width, known.height, known.out_file)
        print(f"card -> {known.out_file}")
        return

    ap = argparse.ArgumentParser()
    ap.add_argument("--vo", required=True, help="voice dir holding timings.json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    args = ap.parse_args()

    with open(os.path.join(args.vo, "timings.json"), encoding="utf-8") as fh:
        timings = json.load(fh)

    os.makedirs(args.out, exist_ok=True)
    font = ImageFont.truetype(FONT_PATH, FONT_SIZE)

    for line in timings["lines"]:
        text = (line.get("subtitle") or "").strip()
        if not text:
            print(f"  beat {line['n']:>2}  (no subtitle)")
            continue
        path = os.path.join(args.out, f"sub-{line['n']:02d}.png")
        rows = render(text, args.width, args.height, font, path)
        print(f"  beat {line['n']:>2}  {rows} line(s)  {line['seconds']:.2f}s")

    print(f"\nSubtitles written to {args.out}")


if __name__ == "__main__":
    main()
