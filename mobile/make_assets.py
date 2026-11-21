"""Generates icon.png, splash.png and adaptive-icon.png (power symbol, red on near-black). Pure Python, no dependencies."""
import math, struct, zlib, os

def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(row) for row in px)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def render(size, bg, scale):
    RED = (225, 29, 46, 255); c = size / 2; S = scale * size / 1024
    ro, ri, bw, gap = 300 * S, 236 * S, 32 * S, 70 * S
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            dx, dy = x + .5 - c, y + .5 - c; r = math.hypot(dx, dy)
            ring = ri <= r <= ro and not (dy < 0 and abs(dx) < gap)
            bar = abs(dx) <= bw and -ro - 10 * S <= dy <= -40 * S
            row += bytes(RED if ring or bar else bg)
        rows.append(row)
    return rows

os.makedirs('assets', exist_ok=True)
png('assets/icon.png', 1024, 1024, render(1024, (11, 11, 12, 255), 1.0))
png('assets/splash.png', 1024, 1024, render(1024, (11, 11, 12, 255), 0.7))
png('assets/adaptive-icon.png', 1024, 1024, render(1024, (0, 0, 0, 0), 0.62))
print('assets generated')
