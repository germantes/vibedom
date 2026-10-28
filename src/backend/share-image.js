// Genera la imagen Open Graph de un enlace compartido: 1200×630 con la paleta
// de la semilla, un trazo de onda y tres muestras de color. Sin dependencias:
// PNG a mano (IHDR + IDAT con zlib + IEND) y dibujo por píxeles.

import { deflateSync } from "node:zlib";

export const SHARE_IMAGE_WIDTH = 1200;
export const SHARE_IMAGE_HEIGHT = 630;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Buffer RGB (width × height × 3) → PNG de 8 bits sin canal alfa. */
export function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filtro "none"
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // profundidad de bits
  header[9] = 2; // color type: truecolor RGB
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function parseHex(value, fallback) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  if (!match) return fallback;
  const int = Number.parseInt(match[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function paintCanvas(width, height) {
  const pixels = Buffer.alloc(width * height * 3);

  function blend(x, y, color, alpha) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = (y * width + x) * 3;
    const a = Math.max(0, Math.min(1, alpha));
    pixels[index] = Math.round(pixels[index] * (1 - a) + color[0] * a);
    pixels[index + 1] = Math.round(pixels[index + 1] * (1 - a) + color[1] * a);
    pixels[index + 2] = Math.round(pixels[index + 2] * (1 - a) + color[2] * a);
  }

  function fillRect(x, y, w, h, color, alpha = 1) {
    for (let py = y; py < y + h; py += 1) {
      for (let px = x; px < x + w; px += 1) blend(px, py, color, alpha);
    }
  }

  function strokeRect(x, y, w, h, color, thickness = 2, alpha = 1) {
    fillRect(x, y, w, thickness, color, alpha);
    fillRect(x, y + h - thickness, w, thickness, color, alpha);
    fillRect(x, y, thickness, h, color, alpha);
    fillRect(x + w - thickness, y, thickness, h, color, alpha);
  }

  function disc(cx, cy, radius, color, alpha) {
    for (let py = -radius; py <= radius; py += 1) {
      for (let px = -radius; px <= radius; px += 1) {
        if (px * px + py * py <= radius * radius) blend(cx + px, cy + py, color, alpha);
      }
    }
  }

  return { pixels, blend, fillRect, strokeRect, disc };
}

/**
 * Imagen del enlace compartido. Usa los colores y el pulso de la semilla para
 * que cada web tenga una tarjeta reconocible al pegar su enlace.
 */
export function renderShareImage(seed) {
  const width = SHARE_IMAGE_WIDTH;
  const height = SHARE_IMAGE_HEIGHT;
  const theme = seed?.uiTheme ?? {};
  const params = seed?.musicalParams ?? {};
  const synth = seed?.synthConfig ?? {};

  const bg = parseHex(theme.backgroundColor, [10, 10, 12]);
  const accent = parseHex(theme.accentColor, [216, 255, 79]);
  const ink = parseHex(theme.textColor, [244, 241, 232]);

  const canvas = paintCanvas(width, height);
  const glow = mix(bg, accent, 0.26);

  // Fondo: del fondo teñido con el acento al fondo real de la web.
  for (let y = 0; y < height; y += 1) {
    const t = Math.pow(y / height, 1.15);
    canvas.fillRect(0, y, width, 1, mix(glow, bg, t));
  }

  // Halo suave detrás de la onda: caída cuadrática para que no se vea el borde.
  const glowRadius = 360;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - width * 0.5) / glowRadius;
      const dy = (y - height * 0.46) / (glowRadius * 0.62);
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < 1) canvas.blend(x, y, accent, 0.12 * (1 - distance) ** 2);
    }
  }

  // Onda: dos senos cuya amplitud sale del tempo y la densidad del arpegio.
  const bpm = Number(params.bpm) || 80;
  const density = Number(synth?.arp?.density ?? 0.4);
  const amplitude = 46 + ((bpm - 40) / 100) * 92 + density * 30;
  const phase = (Number(params.octave) || 3) * 0.7;
  const centerY = height * 0.46;

  const sample = (x) => {
    const u = x / width;
    return (
      centerY +
      Math.sin(u * Math.PI * 5.2 + phase) * amplitude +
      Math.sin(u * Math.PI * 17.3 + phase * 2.4) * amplitude * 0.22
    );
  };

  for (let x = 0; x < width; x += 1) {
    const y = sample(x);
    // Trazo ancho translúcido + núcleo nítido: da profundidad sin filtros.
    for (let dy = -9; dy <= 9; dy += 1) canvas.blend(x, Math.round(y) + dy, accent, 0.05);
    for (let dy = -2; dy <= 2; dy += 1) canvas.blend(x, Math.round(y) + dy, accent, 0.9);
  }

  // Tres muestras de la paleta escaneada.
  const swatch = 74;
  const gap = 18;
  const left = 84;
  const bottom = height - 70 - swatch;
  const swatches = [
    { color: bg, border: mix(ink, bg, 0.35) },
    { color: accent, border: mix(ink, bg, 0.2) },
    { color: ink, border: mix(ink, bg, 0.2) },
  ];

  swatches.forEach((item, index) => {
    const x = left + index * (swatch + gap);
    canvas.fillRect(x, bottom, swatch, swatch, item.color, 1);
    canvas.strokeRect(x, bottom, swatch, swatch, item.border, 2, 0.85);
  });

  // Línea base fina para que la tarjeta no flote en el vacío.
  canvas.fillRect(left, bottom + swatch + 18, width - left * 2, 2, accent, 0.35);

  return encodePng(width, height, canvas.pixels);
}
