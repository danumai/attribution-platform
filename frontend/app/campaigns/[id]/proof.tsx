'use client';
/** The drawings the style pickers are made of: shape miniatures, eye miniatures, and the
 *  printed proof that stands in for a whole preset. Nothing here holds state. */
import { Style, isTransparent } from '@/lib/qr';
import { presetProof } from '@/lib/tw';

/* Transparency grid, sized to whatever it sits behind — a backdrop needs a coarser one than a
   68px swatch, where 18px squares read as content rather than as "nothing here".

   Deliberately not themed. The checker stands for transparency in a preview of a physical
   printed artifact; darkening it would imply a dark substrate and make the Cutout preset look
   scannable when printed on light stock it would not be. */
export const checker = (px: number) =>
  `repeating-conic-gradient(#eeeeee 0 25%, #fff 0 50%) 50%/${px}px ${px}px`;

/** Miniature of each module shape, so the picker shows the thing instead of naming it. */
export function ShapeIcon({ kind }: { kind: string }) {
  const cells = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => [c * 7 + 1.5, r * 7 + 1.5] as const));
  return (
    <svg viewBox="0 0 22 22" aria-hidden="true" fill="currentColor">
      {kind === 'bars'
        ? [0, 1, 2].map((c) => <rect key={c} x={c * 7 + 1.5} y={1.5} width={5} height={19} rx={2.5} />)
        : cells.map(([x, y], i) =>
            kind === 'dots' ? (
              <circle key={i} cx={x + 2.5} cy={y + 2.5} r={2.5} />
            ) : kind === 'diamond' ? (
              <path key={i} d={`M${x + 2.5},${y} L${x + 5},${y + 2.5} L${x + 2.5},${y + 5} L${x},${y + 2.5} Z`} />
            ) : (
              <rect key={i} x={x} y={y} width={5} height={5} rx={kind === 'rounded' ? 1.8 : 0} />
            ),
          )}
    </svg>
  );
}

export function EyeIcon({ kind, ball }: { kind: string; ball?: boolean }) {
  if (ball)
    return (
      <svg viewBox="0 0 22 22" aria-hidden="true" fill="currentColor">
        {kind === 'circle' ? (
          <circle cx="11" cy="11" r="6" />
        ) : kind === 'diamond' ? (
          <path d="M11,4 L18,11 L11,18 L4,11 Z" />
        ) : (
          <rect x="5" y="5" width="12" height="12" rx={kind === 'rounded' ? 4 : 0} />
        )}
      </svg>
    );
  return (
    <svg viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6">
      {kind === 'circle' ? (
        <circle cx="11" cy="11" r="8" />
      ) : kind === 'leaf' ? (
        <path d="M7,3 H19 V15 A4,4 0 0 1 15,19 H3 V7 A4,4 0 0 1 7,3 Z" />
      ) : (
        <rect x="3" y="3" width="16" height="16" rx={kind === 'rounded' ? 5 : 0} />
      )}
    </svg>
  );
}

/**
 * One 11x11 proof, pulled identically for every preset — same code, different plate — so the
 * only thing that varies between swatches is the thing the preset actually changes.
 * `F` marks the three finder zones, which are drawn as eyes rather than as modules.
 */
const PROOF = [
  'FFF#..#.FFF',
  'FFF.#.#.FFF',
  'FFF##..#FFF',
  '.#..##.#..#',
  '#.##..##.#.',
  '#.#.#..##.#',
  '.#..##..#.#',
  '##.#..#.##.',
  'FFF.#..##.#',
  'FFF#.#.#.#.',
  'FFF#.##..##',
];
const U = 4; // one module, in proof units
const FINDERS = [[0, 0], [8, 0], [0, 8]] as const;

function Finder({
  col,
  row,
  frame,
  ball,
  ink,
  ballInk,
}: {
  col: number;
  row: number;
  frame: string;
  ball: string;
  ink: string;
  ballInk: string;
}) {
  const s = 3 * U;
  const m = s / 2;
  return (
    <g transform={`translate(${col * U} ${row * U})`}>
      {frame === 'circle' ? (
        <circle cx={m} cy={m} r={m - 1} fill="none" stroke={ink} strokeWidth="2" />
      ) : frame === 'leaf' ? (
        <path d={`M3,1 H${s - 1} V${s - 3} A2,2 0 0 1 ${s - 3},${s - 1} H1 V3 A2,2 0 0 1 3,1 Z`} fill="none" stroke={ink} strokeWidth="2" />
      ) : (
        <rect x="1" y="1" width={s - 2} height={s - 2} rx={frame === 'rounded' ? 3.5 : 0} fill="none" stroke={ink} strokeWidth="2" />
      )}
      {ball === 'circle' ? (
        <circle cx={m} cy={m} r="2.4" fill={ballInk} />
      ) : ball === 'diamond' ? (
        <path d={`M${m},${m - 2.7} L${m + 2.7},${m} L${m},${m + 2.7} L${m - 2.7},${m} Z`} fill={ballInk} />
      ) : (
        <rect x={m - 2.4} y={m - 2.4} width="4.8" height="4.8" rx={ball === 'rounded' ? 1.6 : 0} fill={ballInk} />
      )}
    </g>
  );
}

/**
 * A printed proof of the preset, not a colour chip. Module shape, eye treatment, ink and frame
 * are the whole difference between one preset and the next, so the swatch prints all four at a
 * size where they are actually tellable apart.
 */
export function PresetProof({ style, id }: { style: Style; id: string }) {
  const { shape = 'square', eyeFrame = 'square', eyeBall = 'square', gradient, frame } = style;
  const ink = gradient ? `url(#${id})` : style.dark ?? '#000';
  const eyeInk = style.eyeColor ?? ink;
  const ballInk = style.eyeBallColor ?? eyeInk;
  const framed = !!frame && frame !== 'none';
  const box = frame === 'box';
  const cells = PROOF.flatMap((row, r) =>
    row.split('').flatMap((ch, c) => (ch === '#' ? [[c * U, r * U] as const] : [])),
  );
  const code = 11 * U;
  // A framed preset prints a rule or a caption strip around the code, so the proof shrinks its
  // plate to make room rather than growing — every swatch on the sheet stays one square.
  const plate = !framed ? undefined : box ? 'translate(5.5 5.5) scale(.75)' : 'translate(4.4 1) scale(.8)';

  return (
    <svg
      className={presetProof}
      viewBox={`-3 -3 ${code + 6} ${code + 6}`}
      aria-hidden="true"
      style={isTransparent(style.light) ? { background: checker(7) } : undefined}
    >
      {gradient && (
        <defs>
          {gradient.type === 'radial' ? (
            <radialGradient id={id}>
              <stop offset="0%" stopColor={gradient.from} />
              <stop offset="100%" stopColor={gradient.to} />
            </radialGradient>
          ) : (
            <linearGradient id={id} gradientTransform={`rotate(${gradient.angle ?? 45} .5 .5)`}>
              <stop offset="0%" stopColor={gradient.from} />
              <stop offset="100%" stopColor={gradient.to} />
            </linearGradient>
          )}
        </defs>
      )}
      <rect x="-3" y="-3" width={code + 6} height={code + 6} fill={style.light ?? '#fff'} />

      <g transform={plate}>
        {cells.map(([x, y], i) =>
          shape === 'dots' ? (
            <circle key={i} cx={x + U / 2} cy={y + U / 2} r={U / 2 - 0.25} fill={ink} />
          ) : shape === 'diamond' ? (
            <path key={i} d={`M${x + U / 2},${y} L${x + U},${y + U / 2} L${x + U / 2},${y + U} L${x},${y + U / 2} Z`} fill={ink} />
          ) : shape === 'bars' ? (
            // full-height so vertically adjacent modules fuse into one stripe, as the renderer does
            <rect key={i} x={x + 0.75} y={y} width={U - 1.5} height={U} rx="0.5" fill={ink} />
          ) : (
            // a shallow radius — at 1.5 a rounded module is a circle, and `rounded` has to stay
            // tellable apart from `dots` at swatch size
            <rect key={i} x={x} y={y} width={U - 0.3} height={U - 0.3} rx={shape === 'rounded' ? 0.9 : 0} fill={ink} />
          ),
        )}
        {FINDERS.map(([col, row]) => (
          <Finder key={`${col}-${row}`} col={col} row={row} frame={eyeFrame} ball={eyeBall} ink={eyeInk} ballInk={ballInk} />
        ))}
      </g>

      {/* a frame preset prints a rule or a captioned strip around the code — show which */}
      {box && (
        <rect x="2.5" y="2.5" width={code - 5} height={code - 5} fill="none" stroke={style.frameColor ?? ink} strokeWidth="2" />
      )}
      {framed && !box && (
        <>
          <rect x="-3" y="39" width={code + 6} height="8" rx={frame === 'ribbon' ? 2 : 0} fill={style.frameColor ?? ink} />
          <rect x={code / 2 - 11} y="42" width="22" height="2" rx="1" fill={style.frameTextColor ?? '#fff'} opacity=".85" />
        </>
      )}
    </svg>
  );
}
