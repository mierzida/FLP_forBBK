// =============================
// ControlPanel.tsx (refactored)
// =============================
import React, { memo, useCallback, useMemo, useState } from 'react';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Palette, ChevronDown } from 'lucide-react';

export interface Formation {
  name: string;
  lines: number[];
}

export interface ControlPanelProps {
  formation: Formation;
  onFormationChange: (formation: Formation) => void;
  uniformColor: string;
  onUniformColorChange: (color: string) => void;
}

const FORMATIONS: Formation[] = [
  { name: '4-4-2', lines: [1, 4, 4, 2] },
  { name: '4-3-3', lines: [1, 4, 3, 3] },
  { name: '3-5-2', lines: [1, 3, 5, 2] },
  { name: '4-2-3-1', lines: [1, 4, 2, 3, 1] },
  { name: '3-4-3', lines: [1, 3, 4, 3] },
  { name: '5-3-2', lines: [1, 5, 3, 2] },
];

const PRESET_COLORS = [
  { name: '빨강', value: '#dc2626' },
  { name: '파랑', value: '#2563eb' },
  { name: '노랑', value: '#eab308' },
  { name: '검정', value: '#171717' },
  { name: '하양', value: '#f5f5f5' },
  { name: '초록', value: '#16a34a' },
  { name: '오렌지', value: '#ea580c' },
  { name: '보라', value: '#9333ea' },
] as const;

export const ControlPanel: React.FC<ControlPanelProps> = memo(function ControlPanel({
  formation,
  onFormationChange,
  uniformColor,
  onUniformColorChange,
}) {
  const [isColorOpen, setIsColorOpen] = useState(false);

  const formationNames = useMemo(() => FORMATIONS.map((f) => f.name), []);

  const handleFormation = useCallback(
    (value: string) => {
      const f = FORMATIONS.find((x) => x.name === value);
      if (f) onFormationChange(f);
    },
    [onFormationChange]
  );

  const handleColor = useCallback(
    (value: string) => onUniformColorChange(value),
    [onUniformColorChange]
  );

  return (
    <div className="bg-slate-800/90 backdrop-blur-sm rounded-lg p-5 space-y-5 shadow-xl border border-slate-700 h-fit">
      {/* Formation Selection */}
      <div className="space-y-2">
        <Label className="text-white">포메이션</Label>
        <Select value={formation.name} onValueChange={handleFormation}>
          <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {formationNames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Uniform Color - Collapsible */}
      <Collapsible open={isColorOpen} onOpenChange={setIsColorOpen}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between p-2 rounded-md hover:bg-slate-700/50 transition-colors">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-white" />
              <Label className="text-white cursor-pointer">유니폼 색상</Label>
            </div>
            <ChevronDown className={`w-5 h-5 text-white transition-transform ${isColorOpen ? 'rotate-180' : ''}`} />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="pt-3 space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color.value}
                onClick={() => handleColor(color.value)}
                className="h-10 rounded-md border-2 transition-all hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white/40"
                style={{
                  backgroundColor: color.value,
                  borderColor: uniformColor === color.value ? '#fff' : 'transparent',
                  boxShadow: uniformColor === color.value ? '0 0 0 2px rgba(255,255,255,0.5)' : 'none',
                }}
                title={color.name}
                aria-label={`Set color ${color.name}`}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});
