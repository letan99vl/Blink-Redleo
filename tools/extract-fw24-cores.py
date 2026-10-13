#!/usr/bin/env python3
"""Extract actual pure C++ cores from the release INO for host tests."""
from pathlib import Path
import sys

if len(sys.argv) != 3:
    raise SystemExit("usage: extract-fw24-cores.py path/sketch.ino /tmp/fw24_extracted.h")
src = Path(sys.argv[1]).read_text(encoding="utf-8")
preamble = "#pragma once\n#include <stdint.h>\n#include <stddef.h>\n#include <string.h>\n\n"
out = [preamble]
for name in ("BlinkGuard", "BlinkGuardArm", "BlinkAutoPins"):
    start = "namespace " + name + " {"
    finish = "} // namespace " + name
    if src.count(start) != 1 or src.count(finish) != 1:
        raise RuntimeError(f"Missing/ambiguous C++ source core: {name}")
    a = src.index(start)
    b = src.index(finish, a) + len(finish)
    out.append(src[a:b] + "\n\n")
Path(sys.argv[2]).write_text("".join(out), encoding="utf-8")
print("PASS: extracted actual BlinkGuard + BlinkGuardArm + BlinkAutoPins from one-file INO")
