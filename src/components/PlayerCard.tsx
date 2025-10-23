
// =============================
// PlayerCard.tsx (refactored)
// =============================
import React, { memo } from 'react';
import { UniformIcon } from './UniformIcon';

export interface PlayerCardProps {
  number: string;
  name: string;
  color: string;
  onClick: () => void;
  compact?: boolean;
  size?: number; // px
  fontSizeOverride?: number;
}

export const PlayerCard: React.FC<PlayerCardProps> = memo(function PlayerCard({ number, name, color, onClick, compact = false, size, fontSizeOverride }) {
  const sizeVal = size ?? (compact ? 36 : 48);
  const nameClass = compact ? 'text-xs' : 'text-sm';

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-white/50 rounded-lg p-2"
      type="button"
      aria-label={`${name || 'Player'} card`}
    >
      <div style={{ width: sizeVal, height: sizeVal, minWidth: sizeVal, minHeight: sizeVal }}>
        <UniformIcon color={color} number={number} size={sizeVal} compact={compact} fontSizeOverride={fontSizeOverride} />
      </div>
      <div className="bg-white/90 px-2 py-0.5 rounded shadow-sm" style={{ minWidth: compact ? 64 : 80 }}>
        <p
          className={`${nameClass} truncate font-bold`}
          style={{
            maxWidth: compact ? 88 : 120,
            fontFamily: "NanumSquareNeo, ui-sans-serif, system-ui",
            fontWeight: 800,
            // for variable-font variants
            fontVariationSettings: "'wght' 800",
            fontSize: compact ? '14px' : '16px',
          }}
        >
          {name || '선수명'}
        </p>
      </div>
    </button>
  );
});
