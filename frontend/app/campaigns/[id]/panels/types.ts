import type { Style } from '@/lib/qr';

/** Every studio panel edits the same plate through the same patch function. */
export interface PanelProps {
  style: Style;
  set: (patch: Partial<Style>) => void;
}
