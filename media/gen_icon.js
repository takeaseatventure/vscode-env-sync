const fs = require('fs');

// Create a 128x128 PNG icon for the VS Code extension
const width = 128;
const height = 128;

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type RGB
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

// IDAT - pixel data
const zlib = require('zlib');
const raw = Buffer.alloc(height * (1 + width * 3));
for (let y = 0; y < height; y++) {
  raw[y * (1 + width * 3)] = 0;
  for (let x = 0; x < width; x++) {
    const offset = y * (1 + width * 3) + 1 + x * 3;
    const cx = x - width/2;
    const cy = y - height/2;
    const dist = Math.sqrt(cx*cx + cy*cy);
    if (dist < 30) {
      raw[offset] = 63; raw[offset + 1] = 185; raw[offset + 2] = 80;
    } else {
      raw[offset] = 22; raw[offset + 1] = 27; raw[offset + 2] = 34;
    }
  }
}
const compressed = zlib.deflateSync(raw);

const png = Buffer.concat([
  PNG_SIGNATURE,
  chunk('IHDR', ihdr),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.writeFileSync('/workspace/products/vscode-env-sync/media/icon.png', png);
console.log('Icon generated:', png.length, 'bytes');
