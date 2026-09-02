/** QR style model, presets and browser-side export. Mirrors backend/src/common/qr.ts. */
import { API, token } from './api';

export type ModuleShape = 'square' | 'rounded' | 'dots' | 'bars' | 'diamond';
export type EyeFrame = 'square' | 'rounded' | 'circle' | 'leaf';
export type EyeBall = 'square' | 'rounded' | 'circle' | 'diamond';
export type LogoShape = 'none' | 'square' | 'rounded' | 'circle';
export type Frame = 'none' | 'box' | 'label' | 'ribbon';

export type Gradient = { from: string; to: string; type?: 'linear' | 'radial'; angle?: number };

export type Style = {
  dark?: string;
  light?: string;
  size?: number;
  margin?: number;
  ecc?: 'L' | 'M' | 'Q' | 'H';
  shape?: ModuleShape;
  eyeFrame?: EyeFrame;
  eyeBall?: EyeBall;
  eyeColor?: string;
  eyeBallColor?: string;
  gradient?: Gradient | null;
  logo?: string;
  logoScale?: number;
  logoPad?: number;
  logoShape?: LogoShape;
  frame?: Frame;
  frameText?: string;
  frameColor?: string;
  frameTextColor?: string;
};

export const DEFAULT_STYLE: Style = {
  dark: '#1a1712',
  light: '#ffffff',
  size: 512,
  margin: 2,
  ecc: 'M',
  shape: 'square',
  eyeFrame: 'square',
  eyeBall: 'square',
};

export const PRESETS: { name: string; style: Style }[] = [
  { name: 'Classic', style: { ...DEFAULT_STYLE, dark: '#000000' } },
  {
    name: 'Ticket',
    style: { ...DEFAULT_STYLE, dark: '#1a1712', light: '#faf6ee', shape: 'rounded', eyeFrame: 'rounded', eyeBall: 'rounded', margin: 3 },
  },
  {
    name: 'Press blue',
    style: { ...DEFAULT_STYLE, dark: '#1c39bb', shape: 'rounded', eyeFrame: 'rounded', eyeBall: 'circle', eyeColor: '#1a1712', margin: 3, ecc: 'Q' },
  },
  {
    name: 'Confetti',
    style: { ...DEFAULT_STYLE, shape: 'dots', eyeFrame: 'circle', eyeBall: 'circle', dark: '#0a6b4a', eyeColor: '#1a1712', ecc: 'Q', margin: 3 },
  },
  {
    name: 'Stripe',
    style: { ...DEFAULT_STYLE, shape: 'bars', eyeFrame: 'rounded', eyeBall: 'rounded', dark: '#a3271b', margin: 3, ecc: 'Q' },
  },
  {
    name: 'Dusk',
    style: { ...DEFAULT_STYLE, shape: 'rounded', eyeFrame: 'leaf', eyeBall: 'circle', gradient: { from: '#1c39bb', to: '#7c1d6f', type: 'linear', angle: 45 }, margin: 3, ecc: 'Q' },
  },
  {
    name: 'Forest',
    style: { ...DEFAULT_STYLE, shape: 'diamond', eyeFrame: 'rounded', eyeBall: 'diamond', gradient: { from: '#14532d', to: '#0a6b4a', type: 'radial' }, light: '#f0fdf4', margin: 3, ecc: 'Q' },
  },
  {
    name: 'Call to action',
    style: { ...DEFAULT_STYLE, shape: 'rounded', eyeFrame: 'rounded', eyeBall: 'rounded', dark: '#1a1712', frame: 'ribbon', frameText: 'SCAN FOR REWARDS', frameColor: '#1c39bb', frameTextColor: '#ffffff', margin: 2 },
  },
  { name: 'Cutout', style: { ...DEFAULT_STYLE, dark: '#111827', light: '#0000', shape: 'rounded', eyeFrame: 'rounded', eyeBall: 'rounded', ecc: 'Q' } },
];

export const SHAPES: ModuleShape[] = ['square', 'rounded', 'dots', 'bars', 'diamond'];
export const EYE_FRAMES: EyeFrame[] = ['square', 'rounded', 'circle', 'leaf'];
export const EYE_BALLS: EyeBall[] = ['square', 'rounded', 'circle', 'diamond'];
export const FRAMES: Frame[] = ['none', 'box', 'label', 'ribbon'];

export const isTransparent = (hex?: string) => !!hex && (hex.length === 5 || hex.length === 9) &&
  (hex.length === 5 ? parseInt(hex[4], 16) / 15 : parseInt(hex.slice(7), 16) / 255) <= 0.5;

function luminance(hex: string): number {
  let h = hex.slice(1);
  if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The same contrast rule the server enforces, run locally so the editor can warn while you drag
 *  a colour picker instead of only failing on save. */
/** The style keys a preset owns — the ones that decide which preset, if any, is on the plate. */
const PRESET_KEYS = [
  'dark', 'light', 'margin', 'shape', 'eyeFrame', 'eyeBall', 'eyeColor', 'eyeBallColor',
  'gradient', 'frame', 'frameText', 'frameColor', 'frameTextColor',
] as const;

/**
 * Whether two styles are the same *preset*, ignoring what a preset does not own — size, error
 * correction and the logo are the promoter's, not the preset's.
 */
export const samePlate = (a: Style, b: Style) =>
  PRESET_KEYS.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));

export function contrastProblem(s: Style): string | null {
  const light = s.light ?? '#ffffff';
  if (isTransparent(light)) return null;
  const inks: [string, string][] = [
    ...(s.gradient
      ? ([[s.gradient.from, 'gradient start'], [s.gradient.to, 'gradient end']] as [string, string][])
      : ([[s.dark ?? '#000000', 'module colour']] as [string, string][])),
    ...((s.eyeColor ? [[s.eyeColor, 'eye colour']] : []) as [string, string][]),
    ...((s.eyeBallColor ? [[s.eyeBallColor, 'eye centre colour']] : []) as [string, string][]),
  ];
  const bg = luminance(light);
  const bad = inks.find(([hex]) => bg - luminance(hex) < 0.3);
  return bad ? `The ${bad[1]} is too close to the background — scanners will struggle.` : null;
}

/** Render the current (unsaved) style. POSTed because a logo data URL will not fit in a URL. */
export async function renderPreview(qrId: string, style: Style): Promise<string> {
  const res = await fetch(`${API}/v1/qr-codes/${qrId}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
    body: JSON.stringify({ style }),
  });
  const text = await res.text();
  if (!res.ok) {
    try {
      throw new Error(JSON.parse(text).message ?? `HTTP ${res.status}`);
    } catch (e: any) {
      throw new Error(e.message ?? `HTTP ${res.status}`);
    }
  }
  return text;
}

/** Rasterise the rendered SVG in the browser. The server's PNG encoder is the flat one and cannot
 *  draw shapes, gradients, logos or frames — this can, at any resolution. */
export function svgToPng(svg: string, px: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const ratio = img.naturalHeight / img.naturalWidth || 1;
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = Math.round(px * ratio);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode PNG'))), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('could not rasterise the QR code'));
    };
    img.src = url;
  });
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Read a dropped/pasted/picked image into a data URL small enough for the style column. Raster
 * images are downscaled rather than rejected — a 4MB phone photo is a normal thing to drop here.
 */
export function readLogo(file: File, maxPx = 512): Promise<string> {
  if (!/^image\/(png|jpeg|svg\+xml)$/.test(file.type))
    return Promise.reject(new Error('Logo must be a PNG, JPEG or SVG.'));

  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Could not read that file.'));
    fr.onload = () => {
      const dataUrl = String(fr.result);
      // SVG stays vector — rasterising it would throw away the reason to use one
      if (file.type === 'image/svg+xml') {
        if (dataUrl.length > 280_000) return reject(new Error('That SVG is too large (max ~200KB).'));
        return resolve(dataUrl);
      }
      const img = new Image();
      img.onerror = () => reject(new Error('That image could not be decoded.'));
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // PNG keeps transparency, which a logo sitting on a coloured plate usually needs
        let out = canvas.toDataURL('image/png');
        if (out.length > 280_000) out = canvas.toDataURL('image/jpeg', 0.85);
        if (out.length > 280_000) return reject(new Error('That image is too detailed to embed — try a simpler logo.'));
        resolve(out);
      };
      img.src = dataUrl;
    };
    fr.readAsDataURL(file);
  });
}
