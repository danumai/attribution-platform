/** The product's drawn mark: a ticket with a tear line down its right side.
 *  One glyph, used by the auth pass, the console rail and the end-user surfaces —
 *  a text "QR" in a box was standing in for it. */
export function TicketMark(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h17A1.5 1.5 0 0 1 22 6.5v3a2.5 2.5 0 0 0 0 5v3a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 17.5v-3a2.5 2.5 0 0 0 0-5v-3Zm13.5.75v1.5h1.5v-1.5h-1.5Zm0 3.5v1.5h1.5v-1.5h-1.5Zm0 3.5v1.5h1.5v-1.5h-1.5Z" />
    </svg>
  );
}
