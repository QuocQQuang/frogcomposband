#!/usr/bin/env python3
"""Export FrogComposband sprite sheets into transparent RGBA PNGs for the web client."""

import os
import shutil
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GRAF_DIR = os.path.join(ROOT, "lib", "xtra", "graf")
OUT_DIR = os.path.join(ROOT, "web", "public", "tiles")


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def _write_rgba_png(path: str, width: int, height: int, rgba_rows: list[bytes]) -> None:
    raw = b"".join(b"\x00" + row for row in rgba_rows)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw, level=6)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(_png_chunk(b"IHDR", ihdr))
        f.write(_png_chunk(b"IDAT", idat))
        f.write(_png_chunk(b"IEND", b""))


def convert_bmp_pair_to_rgba_png(color_bmp: str, mask_bmp: str, out_png: str) -> tuple[int, int]:
    with open(color_bmp, "rb") as f:
        c_data = f.read()
    with open(mask_bmp, "rb") as f:
        m_data = f.read()

    c_off = struct.unpack("<I", c_data[10:14])[0]
    w, h = struct.unpack("<ii", c_data[18:26])
    c_bpp = struct.unpack("<H", c_data[28:30])[0]

    m_off = struct.unpack("<I", m_data[10:14])[0]
    mw, mh = struct.unpack("<ii", m_data[18:26])
    m_bpp = struct.unpack("<H", m_data[28:30])[0]

    if (w, h) != (mw, mh) or c_bpp != 24 or m_bpp != 24:
        raise RuntimeError(f"Unexpected BMP geometry/bpp: {(w, h, c_bpp)} vs {(mw, mh, m_bpp)}")

    top_down = h < 0
    abs_h = abs(h)
    stride = (w * 3 + 3) & ~3

    rows: list[bytes] = []
    for y in range(abs_h):
        src_y = y if top_down else (abs_h - 1 - y)
        c_row_off = c_off + src_y * stride
        m_row_off = m_off + src_y * stride
        c_row = c_data[c_row_off : c_row_off + w * 3]
        m_row = m_data[m_row_off : m_row_off + w * 3]

        out = bytearray(w * 4)
        for x in range(w):
            i3 = x * 3
            i4 = x * 4
            # BMP stores BGR
            b = c_row[i3]
            g = c_row[i3 + 1]
            r = c_row[i3 + 2]
            # Mask is white (255) for transparent background, black (0) for opaque foreground
            mask_val = (m_row[i3] + m_row[i3 + 1] + m_row[i3 + 2]) // 3
            alpha = 255 - mask_val
            out[i4] = r
            out[i4 + 1] = g
            out[i4 + 2] = b
            out[i4 + 3] = alpha
        rows.append(bytes(out))

    _write_rgba_png(out_png, w, abs_h, rows)
    return w, abs_h


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    bmp32 = os.path.join(GRAF_DIR, "32x32.bmp")
    mask32 = os.path.join(GRAF_DIR, "mask32.bmp")
    out32 = os.path.join(OUT_DIR, "32x32.png")
    if os.path.exists(bmp32) and os.path.exists(mask32):
        w, h = convert_bmp_pair_to_rgba_png(bmp32, mask32, out32)
        print(f"Exported {out32} ({w}x{h} RGBA)")

    src16 = os.path.join(GRAF_DIR, "16x16.png")
    out16 = os.path.join(OUT_DIR, "16x16.png")
    if os.path.exists(src16):
        shutil.copy2(src16, out16)
        print(f"Copied {out16}")

    src8 = os.path.join(GRAF_DIR, "8x8.png")
    out8 = os.path.join(OUT_DIR, "8x8.png")
    if os.path.exists(src8):
        shutil.copy2(src8, out8)
        print(f"Copied {out8}")


if __name__ == "__main__":
    main()
