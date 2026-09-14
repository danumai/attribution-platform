'use client';
/**
 * Mounted once in the root layout. Renders the toast stack and the active dialog — the two
 * pieces of UI every signed-in surface shares, formerly both defined inside `lib/ui.tsx`.
 */
import { Toasts } from './toasts';
import { Dialogs } from './dialogs';

export function UI() {
  return (
    <>
      <Toasts />
      <Dialogs />
    </>
  );
}