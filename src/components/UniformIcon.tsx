
// =============================
// UniformIcon.tsx (refactored)
// =============================
import React from 'react';

export interface UniformIconProps {
  color: string;
  number?: string;
  size?: number;
  compact?: boolean;
  fontSizeOverride?: number;
}

export const UniformIcon: React.FC<UniformIconProps> = ({ color, number = '', size = 48, compact = false, fontSizeOverride }) => {
  const strokeColor = '#000000';
  const fontSize = fontSizeOverride !== undefined ? fontSizeOverride : (compact ? Math.round(size * 0.42) : 140);
  const strokeWidth = compact ? 1.2 : 2;

  return (
    <svg width={size} height={size} viewBox="0 0 330 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`uniform-${number}`}>
      <g fill={color}>
        <path d="M15,154.986h15v-30V45.014v-30H15c-8.284,0-15,6.715-15,15v109.973C0,148.271,6.716,154.986,15,154.986z" />
        <path d="M330,30.014c0-8.285-6.717-15-15-15h-15v30v79.973v30h15c8.283,0,15-6.715,15-15V30.014z" />
        <path d="M60,299.986c0,8.285,6.716,15,15,15h180c8.283,0,15-6.715,15-15v-45H60V299.986z" />
        <path d="M270,167.169v-12.183v-30V45.014v-30h-65c-8.284,0-15,6.715-15,15c0,13.785-11.215,25-25,25
		c-13.785,0-25-11.215-25-25c0-8.285-6.717-15-15-15H60v30v79.973v30v16.331v53.669h210V167.169z" />
      </g>
      {number !== '' && (
        <>
          <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" fill="none" stroke="#000000" strokeWidth={strokeWidth + (compact ? 0.8 : 1.6)} style={{ fontWeight: 800, fontFamily: 'inherit', paintOrder: 'stroke' }} fontSize={fontSize}>{number}</text>
          <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" fill="#ffffff" stroke={strokeColor} strokeWidth={strokeWidth} style={{ fontWeight: 800, fontFamily: 'inherit', paintOrder: 'stroke' }} fontSize={fontSize}>{number}</text>
        </>
      )}
    </svg>
  );
};
