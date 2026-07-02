// 纯 Node 生成应用图标 build/icon.png(256x256 猫脸),不依赖任何第三方库。
// 运行:node make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const buf = new Uint8Array(SIZE * SIZE * 4); // RGBA,默认透明

function idx(x, y) { return (y * SIZE + x) * 4; }
function px(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = idx(x, y); buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

// 圆角矩形渐变背景(糖果蓝)
function bg() {
  const rad = 56;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let inside = true;
      // 四角圆角判定
      const cx = x < rad ? rad : (x > SIZE - rad ? SIZE - rad : x);
      const cy = y < rad ? rad : (y > SIZE - rad ? SIZE - rad : y);
      if ((x < rad || x > SIZE - rad) && (y < rad || y > SIZE - rad)) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > rad * rad) inside = false;
      }
      if (inside) {
        const t = y / SIZE;
        px(x, y, lerp(0x6f, 0x33, t), lerp(0xdb, 0xa6, t), lerp(0xf3, 0xd4, t), 255);
      }
    }
  }
}

function disc(cx, cy, r, R, G, B, a = 255) {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) px(x, y, R, G, B, a);
}
function ellipse(cx, cy, rx, ry, R, G, B, a = 255) {
  for (let y = cy - ry; y <= cy + ry; y++)
    for (let x = cx - rx; x <= cx + rx; x++)
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) px(x, y, R, G, B, a);
}
function sign(px_, py_, ax, ay, bx, by) { return (px_ - bx) * (ay - by) - (ax - bx) * (py_ - by); }
function tri(a, b, c, R, G, B, al = 255) {
  const minx = Math.min(a[0], b[0], c[0]), maxx = Math.max(a[0], b[0], c[0]);
  const miny = Math.min(a[1], b[1], c[1]), maxy = Math.max(a[1], b[1], c[1]);
  for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
    const d1 = sign(x, y, a[0], a[1], b[0], b[1]);
    const d2 = sign(x, y, b[0], b[1], c[0], c[1]);
    const d3 = sign(x, y, c[0], c[1], a[0], a[1]);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) px(x, y, R, G, B, al);
  }
}

// 绘制
bg();
// 耳朵(先画,被脸压住底部)
tri([78, 86], [66, 28], [120, 74], 0xff, 0xd0, 0xe4);
tri([178, 86], [190, 28], [136, 74], 0xff, 0xd0, 0xe4);
tri([86, 78], [78, 42], [112, 72], 0xff, 0x9e, 0xc7);
tri([170, 78], [178, 42], [144, 72], 0xff, 0x9e, 0xc7);
// 脸
disc(128, 150, 76, 0xff, 0xff, 0xff);
// 眼睛
disc(104, 146, 9, 0x4a, 0x4a, 0x5c);
disc(152, 146, 9, 0x4a, 0x4a, 0x5c);
disc(107, 143, 3, 0xff, 0xff, 0xff);
disc(155, 143, 3, 0xff, 0xff, 0xff);
// 腮红
ellipse(90, 166, 12, 7, 0xff, 0xb3, 0xc9, 200);
ellipse(166, 166, 12, 7, 0xff, 0xb3, 0xc9, 200);
// 嘴(两个小弧用三角近似)
tri([122, 168], [128, 174], [134, 168], 0x4a, 0x4a, 0x5c);

// ---------- PNG 编码 ----------
const crcTable = (() => {
  const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t;
})();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
// 原始扫描线(每行前缀 filter 0)
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  raw[y * (1 + SIZE * 4)] = 0;
  for (let x = 0; x < SIZE * 4; x++) raw[y * (1 + SIZE * 4) + 1 + x] = buf[y * SIZE * 4 + x];
}
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);

const outDir = path.join(__dirname, 'build');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
console.log('icon.png written:', png.length, 'bytes ->', path.join(outDir, 'icon.png'));
