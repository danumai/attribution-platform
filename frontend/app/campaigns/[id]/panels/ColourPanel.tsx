'use client';
import { Gradient, isTransparent } from '@/lib/qr';
import { checkLabel, checkbox, label as labelClass, rangeField, select as selectField, tab, tabsSub } from '@/lib/tw';
import { Color } from '../controls';
import type { PanelProps } from './types';

export function ColourPanel({ style, set }: PanelProps) {
  const gradient = style.gradient ?? null;

  return (
    <>
      <label className={labelClass}>Fill</label>
      <div className={tabsSub} role="tablist">
        <button className={tab(!gradient)} role="tab" aria-selected={!gradient} onClick={() => set({ gradient: null })}>
          Solid
        </button>
        <button
          className={tab(!!gradient)}
          role="tab"
          aria-selected={!!gradient}
          onClick={() =>
            set({ gradient: gradient ?? { from: style.dark ?? '#1c39bb', to: '#7c1d6f', type: 'linear', angle: 45 } })
          }
        >
          Gradient
        </button>
      </div>

      {!gradient ? (
        <Color label="Module colour" value={style.dark} onChange={(dark) => set({ dark })} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Color
              label="Gradient start"
              value={gradient.from}
              onChange={(from) => set({ gradient: { ...gradient, from } })}
            />
            <Color
              label="Gradient end"
              value={gradient.to}
              onChange={(to) => set({ gradient: { ...gradient, to } })}
            />
          </div>
          <label className={labelClass}>Gradient type</label>
          <select
            className={selectField}
            value={gradient.type ?? 'linear'}
            onChange={(e) => set({ gradient: { ...gradient, type: e.target.value as Gradient['type'] } })}
          >
            <option value="linear">Linear</option>
            <option value="radial">Radial</option>
          </select>
          {(gradient.type ?? 'linear') === 'linear' && (
            <>
              <label className={labelClass}>Angle — {gradient.angle ?? 45}°</label>
              <input
                className={rangeField}
                type="range"
                min={0}
                max={360}
                value={gradient.angle ?? 45}
                onChange={(e) => set({ gradient: { ...gradient, angle: +e.target.value } })}
              />
            </>
          )}
        </>
      )}

      <label className={labelClass}>Background</label>
      <Color
        label="Background colour"
        value={isTransparent(style.light) ? '#ffffff' : style.light}
        fallback="#ffffff"
        onChange={(light) => set({ light })}
      />
      <label className={checkLabel}>
        <input
          className={checkbox}
          type="checkbox"
          checked={isTransparent(style.light)}
          onChange={(e) => set({ light: e.target.checked ? '#0000' : '#ffffff' })}
        />
        Transparent background — for printing straight onto stock
      </label>

      <label className={labelClass}>Finder eyes</label>
      <label className={checkLabel}>
        <input
          className={checkbox}
          type="checkbox"
          checked={!!style.eyeColor}
          onChange={(e) =>
            set({
              eyeColor: e.target.checked ? style.dark ?? '#000000' : undefined,
              eyeBallColor: e.target.checked ? style.eyeBallColor : undefined,
            })
          }
        />
        Give the corner eyes their own colour
      </label>
      {style.eyeColor && (
        <div className="flex flex-wrap items-center gap-3">
          <Color label="Eye frame" value={style.eyeColor} onChange={(eyeColor) => set({ eyeColor })} />
          <Color
            label="Eye centre"
            value={style.eyeBallColor ?? style.eyeColor}
            onChange={(eyeBallColor) => set({ eyeBallColor })}
          />
        </div>
      )}
    </>
  );
}
