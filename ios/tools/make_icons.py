#!/usr/bin/env python3
from pathlib import Path
import struct, zlib

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "BlinkRedleo" / "Assets.xcassets" / "AppIcon.appiconset"
SIZES = [20,29,40,58,60,76,80,87,120,152,167,180,1024]

def chunk(kind,payload):
    return struct.pack(">I",len(payload))+kind+payload+struct.pack(">I",zlib.crc32(kind+payload)&0xffffffff)

def pixel(x,y,size):
    # App Store icons are generated as RGB PNGs with no alpha channel.
    bg=(17,17,20); red=(226,46,58); white=(246,246,247)
    cx=cy=size/2.0; dx=x-cx; dy=y-cy; r=size*0.31
    color=red if dx*dx+dy*dy<=r*r else bg
    w=max(1.0,size*0.045)
    if abs((x-size*0.56)+0.42*(y-size*0.48))<w and size*0.28<y<size*0.72: color=white
    return color

def make_png(size,path):
    rows=[]
    for y in range(size):
        row=bytearray([0])
        for x in range(size): row.extend(pixel(x,y,size))
        rows.append(bytes(row))
    # PNG color type 2 = RGB, so there is no alpha channel.
    ihdr=struct.pack(">IIBBBBB",size,size,8,2,0,0,0)
    raw=b"".join(rows)
    png=b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",ihdr)+chunk(b"IDAT",zlib.compress(raw,9))+chunk(b"IEND",b"")
    path.write_bytes(png)

OUT.mkdir(parents=True,exist_ok=True)
for size in SIZES: make_png(size,OUT/f"icon-{size}.png")
print(f"Generated {len(SIZES)} app icons")
