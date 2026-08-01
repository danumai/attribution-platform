const N = 25;

// Deterministic so server and client render the same matrix — a random fill would
// hydrate-mismatch and flash. Not a decodable code; it is the stub's printed artwork.
function matrix() {
  let s = 0x51a3f;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) >>> 16) / 0x8000;
  const m: boolean[][] = Array.from({ length: N }, () => Array(N).fill(false));

  const finder = (r: number, c: number) => {
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const edge = y === 0 || y === 6 || x === 0 || x === 6;
        const core = y >= 2 && y <= 4 && x >= 2 && x <= 4;
        m[r + y][c + x] = edge || core;
      }
  };
  finder(0, 0);
  finder(0, N - 7);
  finder(N - 7, 0);

  const reserved = (r: number, c: number) =>
    (r < 8 && c < 8) || (r < 8 && c >= N - 8) || (r >= N - 8 && c < 8);

  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) if (!reserved(r, c)) m[r][c] = rand() > 0.52;

  for (let i = 8; i < N - 8; i++) {
    m[6][i] = i % 2 === 0;
    m[i][6] = i % 2 === 0;
  }
  return m;
}

const M = matrix();

export default function CodeMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${N} ${N}`}
      role="img"
      aria-label="A printed QR code on the ticket stub"
      shapeRendering="crispEdges"
    >
      {M.flatMap((row, r) =>
        row.map((on, c) =>
          on ? <rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" /> : null,
        ),
      )}
    </svg>
  );
}
