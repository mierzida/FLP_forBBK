// =============================
// PlayerCard.tsx (Final: Emoji on the side)
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
  yellowCard?: boolean;
  redCard?: boolean;
  goals?: number; // 득점 수
}

export const PlayerCard: React.FC<PlayerCardProps> = memo(function PlayerCard({ 
  number, 
  name, 
  color, 
  onClick, 
  compact = false, 
  size, 
  fontSizeOverride, 
  yellowCard = false, 
  redCard = false,
  goals = 0 
}) {
  const sizeVal = size ?? (compact ? 36 : 48);
  
  // 카드 상태에 따른 배경색 결정
  const getCardBackgroundStyle = () => {
    if (redCard) return { backgroundColor: '#d00202', color: '#cbcbcb' }; 
    if (yellowCard) return { backgroundColor: '#fbe524', color: '#000000' }; 
    return { backgroundColor: 'rgba(255, 255, 255, 0.9)', color: '#000000' }; 
  };

  // 모든 카드의 폰트 크기를 통일 (일관성 확보)
  const fixedFontSize = compact ? '11px' : '13px';

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-white/50 rounded-lg p-1"
      type="button"
    >
      {/* 유니폼 아이콘 구역 */}
      <div style={{ width: sizeVal, height: sizeVal, minWidth: sizeVal, minHeight: sizeVal }}>
        <UniformIcon color={color} number={number} size={sizeVal} compact={compact} fontSizeOverride={fontSizeOverride} />
      </div>

      {/* 선수 이름 및 득점 표시 영역 */}
      <div 
        className="px-1.5 py-1 rounded shadow-sm flex items-center justify-center" 
        style={{ 
          minWidth: compact ? '70px' : '90px',
          maxWidth: compact ? '80px' : '105px', 
          minHeight: compact ? '34px' : '39px', // 2줄 높이 고정
          ...getCardBackgroundStyle(),
          transition: 'all 0.2s ease',
        }}
      >
        {(() => {
          // 미들네임은 건너뛰고 퍼스트, 라스트만 출력
          const nameParts = name.split(' ').filter(Boolean);
          let displayName = name;
          
          if (nameParts.length > 2) {
            // 미들네임이 있는 경우: 첫 번째 + 마지막만 사용
            const first = nameParts[0];
            const last = nameParts[nameParts.length - 1];
            displayName = `${first} ${last}`;
          } else if (nameParts.length === 2) {
            // 이미 퍼스트, 라스트 형식
            displayName = name;
          }
          
          const hasMultipleParts = displayName.includes(' ');
          
          return (
            <div 
              style={{
                width: '100%',
                fontSize: fixedFontSize,
                fontWeight: 800,
                fontFamily: "NanumSquareNeo, ui-sans-serif, system-ui",
                textAlign: 'center',
                whiteSpace: 'normal',
                wordBreak: hasMultipleParts ? 'break-word' : 'break-all',
                overflowWrap: 'anywhere',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                lineHeight: '1.2',
                letterSpacing: '-0.03em', 
              }}
            >
              {hasMultipleParts ? (
                // 다중 부분 이름: 줄바꿈 처리
                displayName.split(' ').map((part, i, arr) => (
                  <React.Fragment key={i}>
                    {part}
                    {/* 💡 마지막 부분 우측에 축구공 표시 */}
                    {i === arr.length - 1 && goals > 0 && (
                      <span 
                        style={{ 
                          fontSize: '14px',       
                          marginLeft: '4px',       
                          verticalAlign: 'text-top' 
                        }}
                      >
                        {'⚽'.repeat(goals)}
                      </span>
                    )}
                    {i < arr.length - 1 && <br />}
                  </React.Fragment>
                ))
              ) : (
                // 단일 이름
                <>
                  {displayName || '선수명'}
                  {/* 💡 한 단어 이름인 경우 바로 옆에 표시 */}
                  {goals > 0 && (
                    <span style={{ fontSize: '10px', marginLeft: '2px', verticalAlign: 'middle' }}>
                      {'⚽'.repeat(goals)}
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })()}
      </div>
    </button>
  );
});