"""
Draws the Alpha Dental launcher icon and writes every size Android needs.

Run it from the android-app folder if you ever want to tweak the shape:

    python tools/make_icons.py

It only needs Pillow. Nothing else in the project depends on it at build time
- the PNGs it produces are committed alongside the code.
"""

import math
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, os.pardir, "app", "src", "main", "res")

# Brand palette, copied from the web app's src/app/globals.css
CHARCOAL_TOP = (26, 32, 44)      # #1A202C
CHARCOAL_BOTTOM = (45, 55, 72)   # #2D3748
MINT = (141, 227, 196)           # #8DE3C4
ENAMEL = (255, 255, 255)

SS = 4  # supersampling factor, for clean anti-aliased edges

# A stylised molar drawn as cubic bezier segments in a 0-100 square.
# Two rounded cusps on top, two tapering roots below, notched between them.
TOOTH_PATH = [
    ((8, 44), (8, 22), (14, 8), (28, 8)),        # left cusp
    ((28, 8), (40, 8), (42, 18), (50, 18)),      # dip between the cusps
    ((50, 18), (58, 18), (60, 8), (72, 8)),      # right cusp
    ((72, 8), (86, 8), (92, 22), (92, 44)),      # right shoulder
    ((92, 44), (92, 56), (88, 62), (84, 70)),    # right side
    ((84, 70), (80, 83), (76, 93), (70, 94)),    # right root tip
    ((70, 94), (64, 94), (60, 80), (56, 64)),    # up into the notch
    ((56, 64), (54, 56), (46, 56), (44, 64)),    # notch between the roots
    ((44, 64), (40, 80), (36, 94), (30, 94)),    # down the left root
    ((30, 94), (24, 93), (20, 83), (16, 70)),    # left root tip
    ((16, 70), (12, 62), (8, 56), (8, 44)),      # left side
]

TOOTH_TOP = 8.0
TOOTH_BOTTOM = 94.0
TOOTH_LEFT = 8.0
TOOTH_RIGHT = 92.0


def bezier_points(p0, p1, p2, p3, steps=48):
    points = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = (u ** 3) * p0[0] + 3 * (u ** 2) * t * p1[0] + 3 * u * (t ** 2) * p2[0] + (t ** 3) * p3[0]
        y = (u ** 3) * p0[1] + 3 * (u ** 2) * t * p1[1] + 3 * u * (t ** 2) * p2[1] + (t ** 3) * p3[1]
        points.append((x, y))
    return points


def tooth_polygon(centre_x, centre_y, height):
    """Scale the 0-100 outline so the tooth is `height` tall, centred."""
    scale = height / (TOOTH_BOTTOM - TOOTH_TOP)
    mid_x = (TOOTH_LEFT + TOOTH_RIGHT) / 2
    mid_y = (TOOTH_TOP + TOOTH_BOTTOM) / 2

    polygon = []
    for segment in TOOTH_PATH:
        for x, y in bezier_points(*segment)[:-1]:
            polygon.append((centre_x + (x - mid_x) * scale,
                            centre_y + (y - mid_y) * scale))
    return polygon


def vertical_gradient(size, top, bottom):
    image = Image.new("RGB", (1, size), top)
    pixels = image.load()
    for y in range(size):
        t = y / max(1, size - 1)
        pixels[0, y] = (
            round(top[0] + (bottom[0] - top[0]) * t),
            round(top[1] + (bottom[1] - top[1]) * t),
            round(top[2] + (bottom[2] - top[2]) * t),
        )
    return image.resize((size, size), Image.NEAREST)


def draw_glow(canvas, centre, radius, colour, strength=110):
    """A soft mint halo behind the tooth, echoing the web app's hero image."""
    glow = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(glow).ellipse(
        [centre[0] - radius, centre[1] - radius * 0.82,
         centre[0] + radius, centre[1] + radius * 0.82],
        fill=strength,
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius * 0.34))
    canvas.paste(Image.new("RGBA", canvas.size, colour + (255,)), (0, 0), glow)


def draw_tooth(canvas, centre, height):
    polygon = tooth_polygon(centre[0], centre[1], height)

    # A faint drop shadow lifts the tooth off the dark background.
    shadow = Image.new("L", canvas.size, 0)
    shadow_poly = [(x, y + height * 0.035) for x, y in polygon]
    ImageDraw.Draw(shadow).polygon(shadow_poly, fill=90)
    shadow = shadow.filter(ImageFilter.GaussianBlur(height * 0.045))
    canvas.paste(Image.new("RGBA", canvas.size, (0, 0, 0, 255)), (0, 0), shadow)

    ImageDraw.Draw(canvas).polygon(polygon, fill=ENAMEL + (255,))


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius, fill=255)
    return mask


def circle_mask(size):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    return mask


def build_square(size, tooth_fraction, mask=None):
    """Full-bleed icon: gradient background, glow, tooth."""
    big = size * SS
    canvas = vertical_gradient(big, CHARCOAL_TOP, CHARCOAL_BOTTOM).convert("RGBA")
    centre = (big / 2, big / 2)
    draw_glow(canvas, centre, big * 0.36, MINT, strength=165)
    draw_tooth(canvas, centre, big * tooth_fraction)
    canvas = canvas.resize((size, size), Image.LANCZOS)
    if mask is not None:
        canvas.putalpha(mask)
    return canvas


def build_adaptive_foreground(size):
    """Transparent layer for adaptive icons; art stays inside the safe circle."""
    big = size * SS
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    centre = (big / 2, big / 2)
    draw_glow(canvas, centre, big * 0.26, MINT, strength=175)
    draw_tooth(canvas, centre, big * 0.50)
    return canvas.resize((size, size), Image.LANCZOS)


def build_adaptive_background(size):
    big = size * SS
    canvas = vertical_gradient(big, CHARCOAL_TOP, CHARCOAL_BOTTOM).convert("RGBA")
    return canvas.resize((size, size), Image.LANCZOS)


def build_monochrome(size):
    """Silhouette only. Android tints this for themed ("monochrome") icons,
    so any glow or shadow here would turn into a muddy blob."""
    big = size * SS
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    polygon = tooth_polygon(big / 2, big / 2, big * 0.50)
    ImageDraw.Draw(canvas).polygon(polygon, fill=(0, 0, 0, 255))
    return canvas.resize((size, size), Image.LANCZOS)


def build_splash_logo(size):
    big = size * SS
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    centre = (big / 2, big / 2)
    draw_glow(canvas, centre, big * 0.36, MINT, strength=120)
    draw_tooth(canvas, centre, big * 0.72)
    return canvas.resize((size, size), Image.LANCZOS)


def save(image, *path_parts):
    target = os.path.join(RES, *path_parts)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    image.save(target, "PNG", optimize=True)
    print("wrote", os.path.relpath(target, RES))


def main():
    # Legacy launcher icons (Android 7 and any launcher without adaptive icons).
    legacy = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for density, size in legacy.items():
        square = build_square(size, 0.56, mask=rounded_mask(size, round(size * 0.22)))
        save(square, f"mipmap-{density}", "ic_launcher.png")
        round_icon = build_square(size, 0.56, mask=circle_mask(size))
        save(round_icon, f"mipmap-{density}", "ic_launcher_round.png")

    # Adaptive icon layers: 108dp, of which only the middle 66dp is guaranteed
    # to be visible once the launcher applies its own mask.
    adaptive = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
    for density, size in adaptive.items():
        save(build_adaptive_foreground(size), f"mipmap-{density}", "ic_launcher_foreground.png")
        save(build_adaptive_background(size), f"mipmap-{density}", "ic_launcher_background.png")
        save(build_monochrome(size), f"mipmap-{density}", "ic_launcher_monochrome.png")

    save(build_splash_logo(288), "drawable-nodpi", "splash_logo.png")

    # Handy if the app is ever put on the Play Store.
    store = build_square(512, 0.62)
    store_path = os.path.join(HERE, "play-store-icon-512.png")
    store.save(store_path, "PNG", optimize=True)
    print("wrote", os.path.relpath(store_path, HERE))


if __name__ == "__main__":
    main()
