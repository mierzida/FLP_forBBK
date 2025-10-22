
// =================================
// ScoreDraggable.tsx (refactored)
// =================================
import React, { memo, useRef, useState, useCallback, useEffect } from 'react';

export interface ScoreDraggableProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  stepPx?: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const ScoreDraggable: React.FC<ScoreDraggableProps> = ({ value, onChange, min = 0, max = 9, stepPx = 20 }) => {
  // New behavior: click to open small +/- controls to change value
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') { onChange(clamp(value - 1, min, max)); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { onChange(clamp(value + 1, min, max)); e.preventDefault(); }
    else if (e.key === 'Enter') { setOpen((s) => !s); }
  }, [min, max, onChange, value]);

  useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      if (!open) return;
      if (!rootRef.current) return;
      if (ev.target instanceof Node && rootRef.current.contains(ev.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <div
        role="spinbutton"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onClick={() => {
          console.debug('[ScoreDraggable] clicked, open:', !open);
          setOpen((s) => !s);
        }}
        title="Click to adjust"
        className="app-no-drag touch-none"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 84, height: 84, borderRadius: 8,
          background: open ? 'rgba(255,255,255,0.06)' : 'transparent',
          color: 'white', fontWeight: 900, fontSize: 'clamp(28px, 4.2vw, 64px)',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        {value}
      </div>

      {open && (
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', marginTop: 8, background: '#0b1220', padding: 6, borderRadius: 8, display: 'flex', gap: 6, alignItems: 'center', zIndex: 200 }}>
          <button onClick={() => onChange(clamp(value - 1, min, max))} className="px-2 py-1 bg-slate-700 rounded">-</button>
          <div style={{ color: 'white', minWidth: 28, textAlign: 'center' }}>{value}</div>
          <button onClick={() => onChange(clamp(value + 1, min, max))} className="px-2 py-1 bg-slate-700 rounded">+</button>
        </div>
      )}
    </div>
  );
};

export default memo(ScoreDraggable);