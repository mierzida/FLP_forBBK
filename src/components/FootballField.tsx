
// =============================
// FootballField.tsx (refactored)
// =============================
import React, { ReactNode, RefObject, memo } from 'react';

export interface FootballFieldProps {
  children: ReactNode;
  fieldRef?: RefObject<HTMLDivElement | null>;
  fullField?: boolean;
}

export const FootballField: React.FC<FootballFieldProps> = memo(function FootballField({ children, fieldRef, fullField = false }) {
  return (
    <div className="relative w-full h-full bg-gradient-to-b from-green-600 to-green-700 rounded-lg overflow-hidden shadow-2xl">
      {/* Field lines */}
      <svg className="absolute inset-0 w-full h-full opacity-30" preserveAspectRatio="none">
        {fullField ? (
          <>
            <rect x="2%" y="2%" width="96%" height="96%" fill="none" stroke="white" strokeWidth="2" />
            <line x1="2%" y1="50%" x2="98%" y2="50%" stroke="white" strokeWidth="2" />
            <circle cx="50%" cy="50%" r="12%" fill="none" stroke="white" strokeWidth="2" />
            <circle cx="50%" cy="50%" r="0.8%" fill="white" />
            <rect x="10%" y="2%" width="80%" height="18%" fill="none" stroke="white" strokeWidth="2" />
            <rect x="25%" y="2%" width="50%" height="8%" fill="none" stroke="white" strokeWidth="2" />
            <circle cx="50%" cy="12%" r="0.6%" fill="white" />
            <rect x="10%" y="80%" width="80%" height="18%" fill="none" stroke="white" strokeWidth="2" />
            <rect x="25%" y="90%" width="50%" height="8%" fill="none" stroke="white" strokeWidth="2" />
            
          </>
        ) : (
          <>
            <line x1="2%" y1="2%" x2="98%" y2="2%" stroke="white" strokeWidth="2" />
            <line x1="2%" y1="2%" x2="2%" y2="98%" stroke="white" strokeWidth="2" />
            <line x1="98%" y1="2%" x2="98%" y2="98%" stroke="white" strokeWidth="2" />
            <rect x="25%" y="84%" width="50%" height="14%" fill="none" stroke="white" strokeWidth="2" />
            <rect x="37%" y="91%" width="26%" height="7%" fill="none" stroke="white" strokeWidth="2" />
            <path d="M 25% 16% Q 50% 20% 75% 16%" fill="none" stroke="white" strokeWidth="2" />
            <circle cx="50%" cy="2%" r="0.6%" fill="white" />
            <line x1="2%" y1="98%" x2="98%" y2="98%" stroke="white" strokeWidth="2" />
            <path d="M 20% 98% A 30 30 0 0 0 80% 98%" fill="none" stroke="white" strokeWidth="2" />
            <circle cx="50%" cy="0%" r="15%" fill="none" stroke="white" strokeWidth="2" />
          </>
        )}
      </svg>

      {/* Striped pattern */}
      <div className="absolute inset-0 opacity-10 pointer-events-none select-none" aria-hidden>
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="h-[5%] bg-green-900" style={{ marginTop: i % 2 === 0 ? '0' : '5%' }} />
        ))}
      </div>

      {/* Players container */}
      <div ref={fieldRef} className="relative w-full h-full p-4 md:p-6 touch-none">
        {children}
      </div>
    </div>
  );
});