'use client';
import { FRAMES, Frame } from '@/lib/qr';
import { field, hint, label as labelClass, select as selectField } from '@/lib/tw';
import { Color } from '../controls';
import type { PanelProps } from './types';

const FRAME_LABEL: Record<Frame, string> = {
  none: 'None',
  box: 'Outline box',
  label: 'Box with caption bar',
  ribbon: 'Caption ribbon',
};

export function FramePanel({ style, set }: PanelProps) {
  const frame = style.frame ?? 'none';

  return (
    <>
      <label className={labelClass}>Frame</label>
      <select
        className={selectField}
        value={frame}
        onChange={(e) => set({ frame: e.target.value as Frame, frameText: style.frameText ?? 'SCAN ME' })}
      >
        {FRAMES.map((f) => (
          <option key={f} value={f}>
            {FRAME_LABEL[f]}
          </option>
        ))}
      </select>
      {frame === 'none' ? (
        <p className={hint}>
          A framed code with a caption converts better on printed material — people need telling
          what the square does.
        </p>
      ) : (
        <>
          <label className={labelClass}>Call to action</label>
          <input
            className={field}
            value={style.frameText ?? ''}
            maxLength={40}
            placeholder="SCAN FOR REWARDS"
            onChange={(e) => set({ frameText: e.target.value })}
          />
          <p className={hint}>{(style.frameText ?? '').length}/40 characters. Short lines print larger.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Color
              label="Frame colour"
              value={style.frameColor ?? style.dark}
              onChange={(frameColor) => set({ frameColor })}
            />
            <Color
              label="Caption text"
              value={style.frameTextColor ?? '#ffffff'}
              fallback="#ffffff"
              onChange={(frameTextColor) => set({ frameTextColor })}
            />
          </div>
        </>
      )}
    </>
  );
}
