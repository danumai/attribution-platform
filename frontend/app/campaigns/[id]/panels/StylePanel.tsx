'use client';
import { EYE_BALLS, EYE_FRAMES, PRESETS, SHAPES, Style, samePlate } from '@/lib/qr';
import { hint, label as labelClass, preset, presets, rangeField, select as selectField } from '@/lib/tw';
import { Choice } from '../controls';
import { EyeIcon, PresetProof, ShapeIcon } from '../proof';
import type { PanelProps } from './types';

export function StylePanel({ style, set, applyPreset }: PanelProps & { applyPreset: (p: Style) => void }) {
  return (
    <>
      <label className={labelClass}>Presets</label>
      <div className={presets} role="group" aria-label="Style presets">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className={preset(samePlate(style, p.style))}
            aria-pressed={samePlate(style, p.style)}
            onClick={() => applyPreset(p.style)}
          >
            <PresetProof style={p.style} id={`proof-${p.name.replace(/\W+/g, '-')}`} />
            <span>{p.name}</span>
          </button>
        ))}
      </div>
      <p className={hint}>A preset swaps the whole plate. Your logo and export size stay as they are.</p>

      <label className={labelClass}>Module shape</label>
      <Choice
        options={SHAPES}
        value={style.shape ?? 'square'}
        onChange={(shape) => set({ shape })}
        render={(v) => <ShapeIcon kind={v} />}
      />

      <label className={labelClass}>Eye frame</label>
      <Choice
        options={EYE_FRAMES}
        value={style.eyeFrame ?? 'square'}
        onChange={(eyeFrame) => set({ eyeFrame })}
        render={(v) => <EyeIcon kind={v} />}
      />

      <label className={labelClass}>Eye centre</label>
      <Choice
        options={EYE_BALLS}
        value={style.eyeBall ?? 'square'}
        onChange={(eyeBall) => set({ eyeBall })}
        render={(v) => <EyeIcon kind={v} ball />}
      />

      <label className={labelClass}>Quiet zone — {style.margin ?? 2} modules</label>
      <input
        className={rangeField}
        type="range"
        min={0}
        max={10}
        value={style.margin ?? 2}
        onChange={(e) => set({ margin: +e.target.value })}
      />
      <p className={hint}>Under 2 modules of white space, some scanners lose the edge of the code.</p>

      <label className={labelClass}>
        Error correction{style.logo ? ' — held at H while a logo covers the centre' : ''}
      </label>
      <select
        className={selectField}
        value={style.ecc ?? 'M'}
        disabled={!!style.logo}
        onChange={(e) => set({ ecc: e.target.value as Style['ecc'] })}
      >
        <option value="L">L — 7% recovery, densest code</option>
        <option value="M">M — 15% recovery</option>
        <option value="Q">Q — 25% recovery</option>
        <option value="H">H — 30% recovery, print-safe</option>
      </select>
    </>
  );
}
