import React from 'react';

interface ControlButtonProps {
  selectedTeam: 'A' | 'B';
  onSelectTeam: (t: 'A' | 'B') => void;
  onOpenEditor: () => void;
  formationAName: string;
  formationBName: string;
}

export default function ControlButton({ selectedTeam, onSelectTeam, onOpenEditor, formationAName, formationBName }: ControlButtonProps) {
  const formationName = selectedTeam === 'A' ? formationAName : formationBName;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} className="app-no-drag">
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button onClick={() => onSelectTeam('A')} className={`px-2 py-1 rounded ${selectedTeam === 'A' ? 'bg-white/10' : 'bg-white/5'}`}>
          팀 A
        </button>
        <button onClick={() => onSelectTeam('B')} className={`px-2 py-1 rounded ${selectedTeam === 'B' ? 'bg-white/10' : 'bg-white/5'}`}>
          팀 B
        </button>
      </div>
    </div>
  );
}
