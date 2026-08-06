'use client';
/**
 * The scheme switch.
 *
 * `data-theme` on <html> drives `color-scheme`, which is what every light-dark() token
 * resolves against — so flipping one attribute retints the entire product with no class
 * swapping and no re-render below this component.
 *
 * Absent the attribute the theme is dark (see globals.css), and layout.tsx restores a
 * stored choice before first paint.
 */
import { useEffect, useState } from 'react';
import { btnBase, cx } from '@/lib/tw';

export function ThemeToggle({ className }: { className?: string }) {
  const [light, setLight] = useState(false);

  // The server cannot know the stored choice, so the icon syncs after mount rather
  // than rendering the wrong one and hydrating over it.
  useEffect(() => setLight(document.documentElement.dataset.theme === 'light'), []);

  function flip() {
    const next = light ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* private mode — the choice just will not survive a reload */
    }
    setLight(!light);
  }

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'}
      className={cx(
        btnBase,
        'grid size-8 place-items-center border-transparent bg-transparent text-mut',
        'enabled:hover:bg-card-alt enabled:hover:text-ink [&_svg]:size-[17px]',
        className,
      )}
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {light ? (
          <path d="M16 11.2A6.5 6.5 0 0 1 8.8 4a6.5 6.5 0 1 0 7.2 7.2Z" />
        ) : (
          <>
            <circle cx="10" cy="10" r="3.4" />
            <path d="M10 2.2v1.6M10 16.2v1.6M17.8 10h-1.6M3.8 10H2.2M15.5 4.5l-1.1 1.1M5.6 14.4l-1.1 1.1M15.5 15.5l-1.1-1.1M5.6 5.6 4.5 4.5" />
          </>
        )}
      </svg>
    </button>
  );
}
