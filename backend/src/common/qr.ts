import { BadRequestException } from '@nestjs/common';
import * as QRCode from 'qrcode';

export interface QrStyle {
  dark?: string; // module color, hex
  light?: string; // background color, hex ('#0000' = transparent)
  size?: number; // px, 128–2048
  margin?: number; // quiet-zone modules, 0–10
  ecc?: 'L' | 'M' | 'Q' | 'H';
  logo?: string; // data URL (image/png|jpeg|svg+xml), overlaid center
  logoScale?: number; // fraction of QR width, 0.1–0.25
}

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function luminance(hex: string): number {
  let h = hex.slice(1);
  if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Reject styles that would produce an unscannable or unsafe code.
export function validateStyle(s: QrStyle): QrStyle {
  const out: QrStyle = {};
  if (s.dark !== undefined) {
    if (!HEX.test(s.dark)) throw new BadRequestException('dark must be a hex color');
    out.dark = s.dark;
  }
  if (s.light !== undefined) {
    if (!HEX.test(s.light)) throw new BadRequestException('light must be a hex color');
    out.light = s.light;
  }
  const dark = out.dark ?? '#000000';
  const light = out.light ?? '#ffffff';
  // transparent background (#0000 / 8-digit low alpha) is allowed; otherwise require contrast
  const alpha = light.length === 5 ? parseInt(light[4], 16) / 15
    : light.length === 9 ? parseInt(light.slice(7), 16) / 255 : 1;
  if (alpha > 0.5 && luminance(light) - luminance(dark) < 0.3)
    throw new BadRequestException('insufficient contrast between dark and light colors — QR would not scan reliably');
  if (s.size !== undefined) {
    if (!Number.isInteger(s.size) || s.size < 128 || s.size > 2048)
      throw new BadRequestException('size must be an integer 128–2048');
    out.size = s.size;
  }
  if (s.margin !== undefined) {
    if (!Number.isInteger(s.margin) || s.margin < 0 || s.margin > 10)
      throw new BadRequestException('margin must be an integer 0–10');
    out.margin = s.margin;
  }
  if (s.ecc !== undefined) {
    if (!['L', 'M', 'Q', 'H'].includes(s.ecc)) throw new BadRequestException('ecc must be L|M|Q|H');
    out.ecc = s.ecc;
  }
  if (s.logo !== undefined && s.logo !== '') {
    if (!/^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(s.logo))
      throw new BadRequestException('logo must be a base64 data URL (png, jpeg, or svg)');
    if (s.logo.length > 300_000) throw new BadRequestException('logo too large (max ~220KB)');
    out.logo = s.logo;
    out.ecc = 'H'; // logo covers modules — force max error correction
    const ls = s.logoScale ?? 0.2;
    if (typeof ls !== 'number' || ls < 0.1 || ls > 0.25)
      throw new BadRequestException('logoScale must be 0.1–0.25');
    out.logoScale = ls;
  }
  return out;
}

// Render as SVG string. Logo is embedded as a centered <image> on a white pad.
export async function renderSvg(url: string, s: QrStyle): Promise<string> {
  const size = s.size ?? 512;
  let svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: s.ecc ?? 'M',
    margin: s.margin ?? 2,
    width: size,
    color: { dark: s.dark ?? '#000000', light: s.light ?? '#ffffff' },
  });
  if (s.logo) {
    const scale = s.logoScale ?? 0.2;
    // qrcode svg uses a viewBox of the module count; overlay in viewBox units
    const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    const units = vb ? Number(vb[1]) : 100;
    const w = units * scale;
    const x = (units - w) / 2;
    const pad = w * 0.1;
    const overlay =
      `<rect x="${x - pad}" y="${x - pad}" width="${w + 2 * pad}" height="${w + 2 * pad}" rx="${pad}" fill="${s.light ?? '#ffffff'}"/>` +
      `<image x="${x}" y="${x}" width="${w}" height="${w}" href="${s.logo}"/>`;
    svg = svg.replace('</svg>', overlay + '</svg>');
  }
  return svg;
}

// PNG without logo compositing (no native canvas dep); logo styles use SVG.
export async function renderPng(url: string, s: QrStyle): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: s.ecc ?? 'M',
    margin: s.margin ?? 2,
    width: s.size ?? 512,
    color: { dark: s.dark ?? '#000000', light: s.light ?? '#ffffff' },
  });
}
