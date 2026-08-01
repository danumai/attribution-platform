/** Self-check for the QR renderer: styles that must be rejected, and SVG that must come out sane. */
import assert from 'node:assert';
import { QrStyle, isAdvanced, renderSvg, validateStyle } from '../src/common/qr';

const rejects = (s: QrStyle, why: string) =>
  assert.throws(() => validateStyle(s), new RegExp('.'), `should reject ${why}`);

// --- validation ---
rejects({ dark: 'red' }, 'non-hex colour');
rejects({ dark: '#eeeeee', light: '#ffffff' }, 'low contrast');
rejects({ gradient: { from: '#eeeeee', to: '#000000' } }, 'a gradient stop with no contrast');
rejects({ shape: 'hexagon' as any }, 'an unknown module shape');
rejects({ logo: 'javascript:alert(1)' }, 'a non-data-URL logo');
rejects({ logo: 'data:image/png;base64,AAAA', logoScale: 0.9 }, 'an oversized logo');
rejects({ frame: 'box', frameText: 'x'.repeat(41) }, 'frame text past the length cap');

// transparent backgrounds skip the contrast rule — the print stock is not ours to check
assert.deepEqual(validateStyle({ dark: '#eeeeee', light: '#0000' }).light, '#0000');
// shapes that shed ink at the edges get pulled up to Q
assert.equal(validateStyle({ shape: 'dots', ecc: 'L' }).ecc, 'Q');
assert.equal(validateStyle({ shape: 'square', ecc: 'L' }).ecc, 'L');
// a logo always forces H, whatever was asked for
assert.equal(validateStyle({ logo: 'data:image/png;base64,AAAA', ecc: 'L' }).ecc, 'H');
// unknown keys are dropped rather than passed through to the renderer
assert.equal((validateStyle({ evil: '<script>' } as any) as any).evil, undefined);

assert.equal(isAdvanced({ dark: '#000000' }), false);
assert.equal(isAdvanced({ shape: 'dots' }), true);

// --- rendering ---
const url = 'https://example.com/r/abc123';

async function main() {
  const plain = await renderSvg(url, validateStyle({}));
  assert.match(plain, /^<svg xmlns=/);
  assert.match(plain, /viewBox="0 0 \d+ \d+"/);

  // every shape / eye / frame combination renders without blowing up, and stays well-formed
  for (const shape of ['square', 'rounded', 'dots', 'bars', 'diamond'] as const)
    for (const eyeFrame of ['square', 'rounded', 'circle', 'leaf'] as const) {
      const svg = await renderSvg(url, validateStyle({ shape, eyeFrame, eyeBall: 'circle' }));
      assert.equal((svg.match(/<svg/g) ?? []).length, 1, `${shape}/${eyeFrame} svg`);
      assert.ok(svg.endsWith('</svg>'), `${shape}/${eyeFrame} closes`);
      assert.ok(!/NaN|undefined/.test(svg), `${shape}/${eyeFrame} has no NaN coords`);
    }

  // Orientation guard: the renderer indexes the matrix itself, so a row/col swap would
  // silently produce a mirrored, undecodable code. Every dark module outside the three
  // finder patterns must get exactly one drawn square.
  const QRCode = require('qrcode');
  const m = QRCode.create(url, { errorCorrectionLevel: 'M' }).modules;
  const n = m.size;
  const inEye = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  let expected = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (m.data[y * n + x] && !inEye(x, y)) expected++;
  assert.equal((plain.match(/<rect x="\d+" y="\d+" width="1.02"/g) ?? []).length, expected);
  // and the finder patterns really are solid rings where the renderer assumes they are
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]])
    for (let i = 0; i < 7; i++) assert.ok(m.data[oy * n + ox + i], 'finder top edge');

  const grad = await renderSvg(url, validateStyle({ gradient: { from: '#1c39bb', to: '#0a6b4a' } }));
  assert.match(grad, /<linearGradient id="qrg"/);
  assert.match(grad, /fill="url\(#qrg\)"/);

  // frame text is XML-escaped, never interpolated raw
  const framed = await renderSvg(url, validateStyle({ frame: 'ribbon', frameText: '<b>&"scan"' }));
  assert.ok(!framed.includes('<b>'), 'frame text must be escaped');
  assert.match(framed, /&lt;b&gt;&amp;&quot;scan&quot;/);

  // the caption grows the canvas below the code, so the viewBox is taller than it is wide
  const [, w, h] = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(framed)!;
  assert.ok(Number(h) > Number(w), 'captioned code reserves height for the caption');

  const logo = 'data:image/png;base64,' + Buffer.from('x').toString('base64');
  const withLogo = await renderSvg(url, validateStyle({ logo, logoShape: 'circle' }));
  assert.match(withLogo, /<circle[^>]*fill="#ffffff"/); // backdrop plate
  assert.match(withLogo, /<image[^>]*href="data:image\/png;base64,/);

  console.log('qr renderer ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
