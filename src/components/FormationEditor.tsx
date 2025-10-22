
// FormationEditor
import React, { memo, useCallback } from 'react';
import { Settings } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import type { Formation } from '../types/formation';

interface Player { number: string; name: string; }

export interface FormationEditorProps {
  formation: Formation;
  onFormationChange: (formation: Formation) => void;
  players: Player[];
  onPlayerChange: (index: number, player: Player) => void;
  uniformColor: string;
  onUniformColorChange: (color: string) => void;
  offsetPx?: number;
  inline?: boolean; // when true, render editor content directly (no Dialog wrapper)
}

const FORMATIONS_FE: Formation[] = [
  { name: '4-4-2', lines: [1, 4, 4, 2] },
  { name: '4-3-3', lines: [1, 4, 3, 3] },
  { name: '3-5-2', lines: [1, 3, 5, 2] },
  { name: '4-2-3-1', lines: [1, 4, 2, 3, 1] },
  { name: '3-4-3', lines: [1, 3, 4, 3] },
  { name: '5-3-2', lines: [1, 5, 3, 2] },
];

export const FormationEditor: React.FC<FormationEditorProps> = memo(function FormationEditor({
  formation,
  onFormationChange,
  players,
  onPlayerChange,
  uniformColor,
  onUniformColorChange,
  offsetPx,
  inline = false,
}) {
  const style: React.CSSProperties | undefined = offsetPx ? { left: `calc(50% + ${offsetPx}px)` } : undefined;

  const handleFormation = useCallback((value: string) => {
    const found = FORMATIONS_FE.find((f) => f.name === value);
    if (found) onFormationChange(found);
  }, [onFormationChange]);

  const content = (
  <div className="w-full" style={Object.assign({}, style || {}, { boxSizing: 'border-box', width: '117%' }) as React.CSSProperties}>
      <div style={{ padding: 8 }}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>라인업 설정</div>
        </div>

  <div style={{ maxHeight: '60vh', overflow: 'auto', paddingRight: 21, boxSizing: 'border-box' }}>
          <div className="space-y-6">
            {/* Formation Selection */}
            <div className="space-y-2 min-w-0">
              <Label>포메이션</Label>
              <div className="min-w-0">
                <Select value={formation.name} onValueChange={handleFormation}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                  {FORMATIONS_FE.map((f) => (
                    <SelectItem key={f.name} value={f.name}>
                      {f.name}
                    </SelectItem>
                  ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Uniform Color */}
            <div className="space-y-2">
              <Label>유니폼 색상</Label>
              <div className="grid grid-cols-4 gap-1">
                {['#dc2626','#2563eb','#eab308','#171717','#f5f5f5','#16a34a','#ea580c','#9333ea'].map((value) => (
                  <button
                    key={value}
                    onClick={() => onUniformColorChange(value)}
                    className="h-8 rounded-md border-2 transition-all hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white/40"
                    style={{
                      backgroundColor: value,
                      borderColor: uniformColor === value ? '#000' : 'transparent',
                      boxShadow: uniformColor === value ? '0 0 0 2px white, 0 0 0 4px black' : 'none',
                    }}
                    aria-label={`Set color ${value}`}
                  />
                ))}
              </div>
              <div className="flex gap-2 items-center mt-2">
                <Label htmlFor="custom-color">커스텀 색상:</Label>
                <Input id="custom-color" type="color" value={uniformColor} onChange={(e) => onUniformColorChange(e.target.value)} className="w-16 h-8 cursor-pointer" />
              </div>
            </div>

            {/* Players */}
            <div className="space-y-4">
              <Label>선수 정보</Label>
                {players.map((player, index) => (
                <div key={`p-${index}`} className="grid grid-cols-[auto_1fr] gap-2 items-center p-2 rounded-lg bg-muted/50">
                  <div className="text-sm text-muted-foreground">#{index + 1}</div>
                  <div className="w-full">
                    <div className="flex items-center p-2 border rounded-md gap-3" style={{ boxSizing: 'border-box' }}>
                      <div className="flex flex-col min-w-[80px]">
                        <Label className="text-xs">등번호</Label>
                        <Input id={`number-${index}`} className="w-20 mt-1 border border-gray-300 rounded px-2 py-1" value={player.number} onChange={(e) => onPlayerChange(index, { ...player, number: e.target.value })} placeholder="10" maxLength={3} onFocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
                      </div>
                      <div className="flex-1 flex flex-col">
                        <Label className="text-xs">이름</Label>
                        <Input id={`name-${index}`} className="w-full mt-1 border border-gray-300 rounded px-2 py-1" value={player.name} onChange={(e) => onPlayerChange(index, { ...player, name: e.target.value })} placeholder="선수명" onFocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (inline) return content;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="gap-2" size="lg">
          <Settings className="w-5 h-5" />
          설정
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[77vh]"
        style={Object.assign({}, style || {}, { width: '620px', maxWidth: '95vw', top: '60%' })}
      >
        {content}
      </DialogContent>
    </Dialog>
  );
});
