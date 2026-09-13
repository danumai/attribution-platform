import { alertErr, btn, card, cx, h3 } from '@/lib/tw';

/**
 * What a failed load looks like. Both consoles derive "still loading" from the absence of data,
 * so a failed load is otherwise indistinguishable from one in flight once the toast expires.
 * This replaces the skeleton rather than sitting above it.
 */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={cx(card, 'mt-3')} role="alert">
      <h3 className={h3}>This didn&rsquo;t load</h3>
      <p className={cx(alertErr, 'mt-3')}>{message}</p>
      <button className={cx(btn, 'mt-4')} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}