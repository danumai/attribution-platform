import { BadRequestException } from '@nestjs/common';
import * as QRCode from 'qrcode';

export type ModuleShape = 'square' | 'rounded' | 'dots' | 'bars' | 'diamond';
export type EyeFrame = 'square' | 'rounded' | 'circle' | 'leaf';
export type EyeBall = 'square' | 'rounded' | 'circle' | 'diamond';
export type LogoShape = 'none' | 'square' | 'rounded' | 'circle';
export type Frame = 'none' | 'box' | 'label' | 'ribbon';

export interface QrStyle {
  dark?: string; // module color, hex
  light?: string; // background color, hex ('#0000' = transparent)
  size?: number; // px, 128–2048
  margin?: number; // quiet-zone modules, 0–10
  ecc?: 'L' | 'M' | 'Q' | 'H';

  // module + finder styling
  shape?: ModuleShape;
  eyeFrame?: EyeFrame;
  eyeBall?: EyeBall;
  eyeColor?: string; // finder frame colour, defaults to dark
  eyeBallColor?: string; // finder centre colour, defaults to eyeColor

  // gradient fill for the modules (overrides flat `dark` when present)
  gradient?: { from: string; to: string; type?: 'linear' | 'radial'; angle?: number };

  logo?: string; // data URL (image/png|jpeg|svg+xml), overlaid center
  logoScale?: number; // fraction of QR width, 0.1–0.3
  logoPad?: number; // backdrop padding as a fraction of the logo, 0–0.4
  logoShape?: LogoShape; // backdrop plate behind the logo

  // printed frame + call to action beneath the code
  frame?: Frame;
  frameText?: string;
  frameColor?: string;
  frameTextColor?: string;
}

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SHAPES: ModuleShape[] = ['square', 'rounded', 'dots', 'bars', 'diamond'];
const EYE_FRAMES: EyeFrame[] = ['square', 'rounded', 'circle', 'leaf'];
const EYE_BALLS: EyeBall[] = ['square', 'rounded', 'circle', 'diamond'];
const LOGO_SHAPES: LogoShape[] = ['none', 'square', 'rounded', 'circle'];
const FRAMES: Frame[] = ['none', 'box', 'label', 'ribbon'];

function luminance(hex: string): number {
  let h = hex.slice(1);
  if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const alphaOf = (hex: string) =>
  hex.length === 5 ? parseInt(hex[4], 16) / 15 : hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1;

/** XML-escape text that lands inside the rendered SVG. */
const esc = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));

function hexField(v: unknown, name: string): string {
  if (typeof v !== 'string' || !HEX.test(v)) throw new BadRequestException(`${name} must be a hex color`);
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: T[], name: string): T {
  if (typeof v !== 'string' || !allowed.includes(v as T))
    throw new BadRequestException(`${name} must be one of ${allowed.join('|')}`);
  return v as T;
}

// Reject styles that would produce an unscannable or unsafe code.
export function validateStyle(s: QrStyle): QrStyle {
  const out: QrStyle = {};
  if (s.dark !== undefined) out.dark = hexField(s.dark, 'dark');
  if (s.light !== undefined) out.light = hexField(s.light, 'light');
  if (s.eyeColor !== undefined) out.eyeColor = hexField(s.eyeColor, 'eyeColor');
  if (s.eyeBallColor !== undefined) out.eyeBallColor = hexField(s.eyeBallColor, 'eyeBallColor');

  if (s.gradient !== undefined && s.gradient !== null) {
    const g = s.gradient;
    if (typeof g !== 'object') throw new BadRequestException('gradient must be an object');
    const from = hexField(g.from, 'gradient.from');
    const to = hexField(g.to, 'gradient.to');
    const type = g.type === undefined ? 'linear' : oneOf(g.type, ['linear', 'radial'], 'gradient.type');
    const angle = g.angle ?? 45;
    if (typeof angle !== 'number' || angle < 0 || angle > 360)
      throw new BadRequestException('gradient.angle must be 0–360');
    out.gradient = { from, to, type, angle };
  }

  const light = out.light ?? '#ffffff';
  // Every ink that lands on the background has to stay readable against it. Transparent
  // backgrounds are exempt — whatever they are printed on is out of our hands.
  if (alphaOf(light) > 0.5) {
    const inks = [
      out.gradient ? out.gradient.from : out.dark ?? '#000000',
      ...(out.gradient ? [out.gradient.to] : []),
      ...(out.eyeColor ? [out.eyeColor] : []),
      ...(out.eyeBallColor ? [out.eyeBallColor] : []),
    ];
    const bg = luminance(light);
    if (inks.some((ink) => bg - luminance(ink) < 0.3))
      throw new BadRequestException(
        'insufficient contrast against the background — QR would not scan reliably',
      );
  }

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

  if (s.shape !== undefined) out.shape = oneOf(s.shape, SHAPES, 'shape');
  if (s.eyeFrame !== undefined) out.eyeFrame = oneOf(s.eyeFrame, EYE_FRAMES, 'eyeFrame');
  if (s.eyeBall !== undefined) out.eyeBall = oneOf(s.eyeBall, EYE_BALLS, 'eyeBall');

  if (s.logo !== undefined && s.logo !== '' && s.logo !== null) {
    if (!/^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(s.logo))
      throw new BadRequestException('logo must be a base64 data URL (png, jpeg, or svg)');
    if (s.logo.length > 300_000) throw new BadRequestException('logo too large (max ~220KB)');
    out.logo = s.logo;
    out.ecc = 'H'; // logo covers modules — force max error correction
    const ls = s.logoScale ?? 0.2;
    if (typeof ls !== 'number' || ls < 0.1 || ls > 0.3)
      throw new BadRequestException('logoScale must be 0.1–0.3');
    out.logoScale = ls;
    const lp = s.logoPad ?? 0.12;
    if (typeof lp !== 'number' || lp < 0 || lp > 0.4)
      throw new BadRequestException('logoPad must be 0–0.4');
    out.logoPad = lp;
    out.logoShape = s.logoShape === undefined ? 'rounded' : oneOf(s.logoShape, LOGO_SHAPES, 'logoShape');
  }

  // Shapes that shrink each module lose ink at the edges; hold the floor at Q so a
  // decorative code still survives a cheap camera and a cheap print run.
  if ((out.shape === 'dots' || out.shape === 'diamond') && !out.logo) {
    const rank = { L: 0, M: 1, Q: 2, H: 3 } as const;
    if (rank[out.ecc ?? 'M'] < rank.Q) out.ecc = 'Q';
  }

  if (s.frame !== undefined) out.frame = oneOf(s.frame, FRAMES, 'frame');
  if (out.frame && out.frame !== 'none') {
    const text = s.frameText ?? 'SCAN ME';
    if (typeof text !== 'string' || text.length > 40)
      throw new BadRequestException('frameText must be a string of at most 40 characters');
    out.frameText = text;
    out.frameColor = s.frameColor === undefined ? out.dark ?? '#000000' : hexField(s.frameColor, 'frameColor');
    out.frameTextColor =
      s.frameTextColor === undefined ? '#ffffff' : hexField(s.frameTextColor, 'frameTextColor');
  }
  return out;
}

/** True when the style needs the custom renderer — the qrcode lib's PNG path cannot express it. */
export function isAdvanced(s: QrStyle): boolean {
  return !!(
    s.logo ||
    s.gradient ||
    (s.shape && s.shape !== 'square') ||
    (s.eyeFrame && s.eyeFrame !== 'square') ||
    (s.eyeBall && s.eyeBall !== 'square') ||
    s.eyeColor ||
    s.eyeBallColor ||
    (s.frame && s.frame !== 'none')
  );
}

const FINDER = 7; // finder patterns are 7×7 modules at three corners

function eyeFramePath(x: number, y: number, kind: EyeFrame): string {
  // 1-module-wide ring drawn as a stroked shape inset by half a module
  const [a, b, w] = [x + 0.5, y + 0.5, FINDER - 1];
  if (kind === 'circle') return `<circle cx="${x + 3.5}" cy="${y + 3.5}" r="${w / 2}" fill="none" stroke-width="1"/>`;
  if (kind === 'rounded') return `<rect x="${a}" y="${b}" width="${w}" height="${w}" rx="2" fill="none" stroke-width="1"/>`;
  if (kind === 'leaf') {
    // two opposite corners rounded, two square — the "leaf" silhouette
    const r = 2.6;
    const d =
      `M${a + r},${b} H${a + w} V${b + w - r} A${r},${r} 0 0 1 ${a + w - r},${b + w} ` +
      `H${a} V${b + r} A${r},${r} 0 0 1 ${a + r},${b} Z`;
    return `<path d="${d}" fill="none" stroke-width="1"/>`;
  }
  return `<rect x="${a}" y="${b}" width="${w}" height="${w}" fill="none" stroke-width="1"/>`;
}

function eyeBallPath(x: number, y: number, kind: EyeBall): string {
  const [cx, cy] = [x + 3.5, y + 3.5];
  if (kind === 'circle') return `<circle cx="${cx}" cy="${cy}" r="1.5"/>`;
  if (kind === 'rounded') return `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="1"/>`;
  if (kind === 'diamond')
    return `<path d="M${cx},${cy - 1.9} L${cx + 1.9},${cy} L${cx},${cy + 1.9} L${cx - 1.9},${cy} Z"/>`;
  return `<rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`;
}

function moduleShapes(on: (x: number, y: number) => boolean, n: number, shape: ModuleShape): string {
  const inEye = (x: number, y: number) =>
    (x < FINDER && y < FINDER) || (x >= n - FINDER && y < FINDER) || (x < FINDER && y >= n - FINDER);
  const out: string[] = [];

  if (shape === 'bars') {
    // merge vertical runs into one rounded bar — reads as a printed stripe, not a grid
    for (let x = 0; x < n; x++) {
      let y = 0;
      while (y < n) {
        if (!on(x, y) || inEye(x, y)) { y++; continue; }
        let len = 0;
        while (y + len < n && on(x, y + len) && !inEye(x, y + len)) len++;
        out.push(`<rect x="${x + 0.1}" y="${y + 0.1}" width="0.8" height="${len - 0.2}" rx="0.4"/>`);
        y += len;
      }
    }
    return out.join('');
  }

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!on(x, y) || inEye(x, y)) continue;
      if (shape === 'dots') out.push(`<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.44"/>`);
      else if (shape === 'diamond')
        out.push(`<path d="M${x + 0.5},${y} L${x + 1},${y + 0.5} L${x + 0.5},${y + 1} L${x},${y + 0.5} Z"/>`);
      else if (shape === 'rounded')
        out.push(`<rect x="${x + 0.04}" y="${y + 0.04}" width="0.92" height="0.92" rx="0.32"/>`);
      else out.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02"/>`);
    }
  }
  return out.join('');
}

/**
 * Render as SVG. Built from the raw module matrix rather than qrcode's own SVG output,
 * because shapes, per-eye colours, gradients and frames all need module-level control.
 */
export async function renderSvg(url: string, s: QrStyle): Promise<string> {
  const qr = QRCode.create(url, { errorCorrectionLevel: s.ecc ?? 'M' });
  const n = qr.modules.size;
  const bits = qr.modules.data;
  const on = (x: number, y: number) => !!bits[y * n + x];

  const m = s.margin ?? 2;
  const quiet = n + 2 * m; // the code plus its quiet zone
  const framed = !!s.frame && s.frame !== 'none';
  const pad = framed ? 2 : 0; // frame border sits outside the quiet zone
  const capH = framed && s.frameText ? 6 : 0;
  const w = quiet + 2 * pad;
  const h = w + capH;
  const size = s.size ?? 512;

  const light = s.light ?? '#ffffff';
  const opaqueLight = alphaOf(light) > 0.5 ? light : '#ffffff';
  const dark = s.dark ?? '#000000';
  const fill = s.gradient ? 'url(#qrg)' : dark;
  const eyeFill = s.eyeColor ?? fill;
  const ballFill = s.eyeBallColor ?? eyeFill;

  const defs = s.gradient
    ? s.gradient.type === 'radial'
      ? `<defs><radialGradient id="qrg"><stop offset="0" stop-color="${s.gradient.from}"/><stop offset="1" stop-color="${s.gradient.to}"/></radialGradient></defs>`
      : `<defs><linearGradient id="qrg" gradientTransform="rotate(${s.gradient.angle ?? 45} .5 .5)"><stop offset="0" stop-color="${s.gradient.from}"/><stop offset="1" stop-color="${s.gradient.to}"/></linearGradient></defs>`
    : '';

  const parts: string[] = [defs];

  if (alphaOf(light) > 0.05)
    parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${light}" ${framed ? 'rx="2"' : ''}/>`);

  // modules + eyes, translated past the frame border and quiet zone
  const eyes = ([[0, 0], [n - FINDER, 0], [0, n - FINDER]] as const)
    .map(([x, y]) => eyeFramePath(x, y, s.eyeFrame ?? 'square'))
    .join('');
  const balls = ([[0, 0], [n - FINDER, 0], [0, n - FINDER]] as const)
    .map(([x, y]) => eyeBallPath(x, y, s.eyeBall ?? 'square'))
    .join('');

  parts.push(
    `<g transform="translate(${pad + m} ${pad + m})">` +
      `<g fill="${fill}" shape-rendering="${(s.shape ?? 'square') === 'square' ? 'crispEdges' : 'geometricPrecision'}">${moduleShapes(on, n, s.shape ?? 'square')}</g>` +
      `<g fill="none" stroke="${eyeFill}">${eyes}</g>` +
      `<g fill="${ballFill}">${balls}</g>` +
      '</g>',
  );

  if (s.logo) {
    const scale = s.logoScale ?? 0.2;
    const lw = quiet * scale;
    const lx = (w - lw) / 2;
    const cy = pad + m + n / 2 - lw / 2; // centred on the code, not on the caption
    const p = lw * (s.logoPad ?? 0.12);
    const shape = s.logoShape ?? 'rounded';
    if (shape !== 'none') {
      const [bx, by, bw] = [lx - p, cy - p, lw + 2 * p];
      parts.push(
        shape === 'circle'
          ? `<circle cx="${bx + bw / 2}" cy="${by + bw / 2}" r="${bw / 2}" fill="${opaqueLight}"/>`
          : `<rect x="${bx}" y="${by}" width="${bw}" height="${bw}" rx="${shape === 'rounded' ? bw * 0.18 : 0}" fill="${opaqueLight}"/>`,
      );
    }
    parts.push(
      `<image x="${lx}" y="${cy}" width="${lw}" height="${lw}" preserveAspectRatio="xMidYMid meet" href="${s.logo}"/>`,
    );
  }

  if (framed) {
    const fc = s.frameColor ?? dark;
    if (s.frame === 'box' || s.frame === 'label')
      parts.push(
        `<rect x="0.6" y="0.6" width="${w - 1.2}" height="${h - 1.2}" rx="2" fill="none" stroke="${fc}" stroke-width="1.2"/>`,
      );
    if (capH) {
      const ty = w + capH / 2 + 0.2;
      if (s.frame === 'ribbon' || s.frame === 'label')
        parts.push(
          `<rect x="0.6" y="${w - 0.4}" width="${w - 1.2}" height="${capH - 0.8}" rx="1.6" fill="${fc}"/>`,
        );
      const textFill = s.frame === 'box' ? fc : s.frameTextColor ?? '#ffffff';
      // A long call to action must never overrun the ribbon. Font size shrinks with length as
      // a starting estimate, and textLength/lengthAdjust makes the fit exact regardless of
      // which font the viewer actually has — SVG measures glyphs itself at render time.
      const len = s.frameText!.length;
      const fontSize = Math.min(3.4, Math.max(1.6, 34 / Math.max(6, len)));
      const avail = w - 4;
      // A bold caps grotesque runs roughly 0.66em per glyph; only clamp with textLength
      // when the estimate would actually overrun — clamping short text stretches it oddly.
      const estWidth = len * fontSize * 0.66;
      const clamp = estWidth > avail ? ` textLength="${avail.toFixed(2)}" lengthAdjust="spacingAndGlyphs"` : '';
      parts.push(
        `<text x="${w / 2}" y="${ty}" text-anchor="middle" dominant-baseline="middle" ` +
          `font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" ` +
          `font-size="${fontSize.toFixed(2)}" font-weight="700" letter-spacing="0.08"${clamp} ` +
          `fill="${textFill}">${esc(s.frameText!)}</text>`,
      );
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${Math.round((size * h) / w)}" ` +
    `viewBox="0 0 ${w} ${h}" role="img" aria-label="QR code">${parts.join('')}</svg>`
  );
}

// PNG for plain styles only (no native canvas dep). Anything the flat encoder cannot
// express is exported from the SVG in the browser instead — see the studio's PNG download.
export async function renderPng(url: string, s: QrStyle): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: s.ecc ?? 'M',
    margin: s.margin ?? 2,
    width: s.size ?? 512,
    color: { dark: s.dark ?? '#000000', light: s.light ?? '#ffffff' },
  });
}
