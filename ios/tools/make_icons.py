#!/usr/bin/env python3
from pathlib import Path
import shutil
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "BlinkRedleo" / "Assets.xcassets" / "AppIcon.appiconset"
SVG = Path(__file__).with_name("BlinkTL-AppIcon.svg")
SIZES = [20,29,40,58,60,76,80,87,120,152,167,180,1024]

def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

def png_color_type(path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError(f"{path.name}: invalid PNG")
    return data[25]

if shutil.which("sips") is None:
    raise RuntimeError("sips is required to render the Blink TL AppIcon on macOS")

OUT.mkdir(parents=True, exist_ok=True)
master_jpg = OUT / "_BlinkTL-master.jpg"

# Render the vector artwork through an opaque JPEG first. This deliberately
# strips alpha so App Store Connect receives RGB-only PNG app icons.
run("sips", "-s", "format", "jpeg", "-s", "formatOptions", "100",
    str(SVG), "--out", str(master_jpg))

for size in SIZES:
    out = OUT / f"icon-{size}.png"
    run("sips", "--resampleHeightWidth", str(size), str(size),
        "-s", "format", "png", str(master_jpg), "--out", str(out))
    if png_color_type(out) != 2:
        raise RuntimeError(f"{out.name}: expected RGB PNG without alpha")

master_jpg.unlink(missing_ok=True)
print(f"Generated {len(SIZES)} Blink TL RGB app icons")
