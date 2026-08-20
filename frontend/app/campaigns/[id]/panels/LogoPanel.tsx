'use client';
import { LogoShape } from '@/lib/qr';
import { hint, label as labelClass, rangeField, select as selectField } from '@/lib/tw';
import { LogoWell } from '../controls';
import type { PanelProps } from './types';

export function LogoPanel({ style, set, onPick }: PanelProps & { onPick: (f: File) => void }) {
  return (
    <>
      <LogoWell
        logo={style.logo}
        onPick={onPick}
        onClear={() => set({ logo: undefined, logoScale: undefined, logoPad: undefined, logoShape: undefined })}
      />
      {!style.logo ? (
        <p className={hint}>
          A centre logo forces error correction to H, so the code survives having its middle covered.
        </p>
      ) : (
        <>
          <label className={labelClass}>
            Logo size — {Math.round((style.logoScale ?? 0.2) * 100)}% of the code
          </label>
          <input
            className={rangeField}
            type="range"
            min={10}
            max={30}
            value={Math.round((style.logoScale ?? 0.2) * 100)}
            onChange={(e) => set({ logoScale: +e.target.value / 100 })}
          />
          <p className={hint}>
            Past ~25% you are covering more than error correction can rebuild. Test the printed
            code before a run.
          </p>

          <label className={labelClass}>Backdrop</label>
          <select
            className={selectField}
            value={style.logoShape ?? 'rounded'}
            onChange={(e) => set({ logoShape: e.target.value as LogoShape })}
          >
            <option value="rounded">Rounded plate</option>
            <option value="square">Square plate</option>
            <option value="circle">Circle plate</option>
            <option value="none">None — logo sits on the modules</option>
          </select>

          {style.logoShape !== 'none' && (
            <>
              <label className={labelClass}>
                Plate padding — {Math.round((style.logoPad ?? 0.12) * 100)}%
              </label>
              <input
                className={rangeField}
                type="range"
                min={0}
                max={40}
                value={Math.round((style.logoPad ?? 0.12) * 100)}
                onChange={(e) => set({ logoPad: +e.target.value / 100 })}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
