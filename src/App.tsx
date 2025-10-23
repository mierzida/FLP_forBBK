import { useState, useMemo, useRef, useCallback, useEffect, lazy, Suspense } from 'react';
import { FootballField } from './components/FootballField';
import { PlayerCard } from './components/PlayerCard';
import { FormationEditor } from './components/FormationEditor';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './components/ui/dialog';
import { Input } from './components/ui/input';
import { TeamEntry } from './components/TeamSearch';
// Prefer a single import path for ScoreDraggable to avoid import cycles / duplicate module instances
const ScoreDraggable = lazy(() => import('./components/ScoreDraggable'));
import { Label } from './components/ui/label';
import { Button } from './components/ui/button';
import ControlButton from './components/ControlButton';

/********************
 * Types & Utilities *
 ********************/
interface Player {
  number: string;
  name: string;
}

interface Formation {
  name: string;
  lines: number[]; // e.g., [1,4,3,3]
}

interface DragState {
  index: number;
  startX: number;
  startY: number;
  moved: boolean;
  pointerOffsetX: number;
  pointerOffsetY: number;
}

interface ElectronAPI {
  saveFile?: (opts: any) => Promise<{ canceled?: boolean; filePath?: string } | undefined>;
  openFile?: () => Promise<{ canceled?: boolean; filePath?: string; error?: string; data?: any } | undefined>;
  captureAndSave?: (opts: any) => Promise<{ canceled?: boolean; filePath?: string } | undefined>;
  setTransparentMode?: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  getTransparentMode?: () => Promise<{ success: boolean; transparent: boolean }>;
  minimize?: () => void;
  toggleMaximize?: () => void;
  close?: () => void;
}

const MOVEMENT_THRESHOLD = 6; // px

function clamp01(v: number) {
  return Math.max(0, Math.min(100, v));
}

function calcPositions(formation: Formation): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];

  formation.lines.forEach((lineCount, lineIndex) => {
    const totalLines = Math.max(1, formation.lines.length - 1);
    const rawY = (lineIndex / totalLines) * 85 + 8; // original baseline
    const center = 50;
    let computedY = center + (rawY - center) * 0.8; // compress toward center
    computedY = Math.max(0, computedY - 3.5); // slight lift

    const isLastLine = lineIndex === formation.lines.length - 1;
    let yForLine = computedY;
    if (lineIndex === 0) yForLine = 8; // GK
    else if (lineIndex === 1) yForLine = 30; // DEF
    else if (isLastLine) yForLine = 85; // ATT

    for (let i = 0; i < lineCount; i++) {
      const baseX = ((i + 1) / (lineCount + 1)) * 100;
      const x = 50 + (baseX - 50) * 1.2; // widen spacing by 20%
      positions.push({ x, y: yForLine });
    }
  });

  return positions;
}

export default function App() {
  const electronAPI: ElectronAPI | undefined = (window as any).electronAPI;
  const isElectronAvailable = !!electronAPI;

  /*************
   * App State *
   *************/
  const [formation, setFormation] = useState<Formation>({ name: '4-3-3', lines: [1, 4, 3, 3] });
  const [players, setPlayers] = useState<Player[]>(
    Array.from({ length: 11 }, (_, i) => ({ number: String(i + 1), name: `선수 ${i + 1}` }))
  );
  const [uniformColor, setUniformColor] = useState('#2563eb');
  const [teamNameA, setTeamNameA] = useState('');
  const [teamLogoA, setTeamLogoA] = useState<any>(null);

  const [formationB, setFormationB] = useState<Formation>({ name: '4-3-3', lines: [1, 4, 3, 3] });
  const [playersB, setPlayersB] = useState<Player[]>(
    Array.from({ length: 11 }, (_, i) => ({ number: String(i + 1), name: `선수 ${i + 1}` }))
  );
  const [uniformColorB, setUniformColorB] = useState('#dc2626');
  const [teamNameB, setTeamNameB] = useState('');
  const [teamLogoB, setTeamLogoB] = useState<any>(null);

  // 기본값을 항상 0으로 시작하도록 변경 (이전에는 localStorage에서 복원했음)
  const [scoreA, setScoreA] = useState<number>(0);
  const [scoreB, setScoreB] = useState<number>(0);

  const [verticalMode, setVerticalMode] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<number | null>(null);
  const [editingPlayer, setEditingPlayer] = useState<Player>({ number: '', name: '' });
  const [selectedPlayerB, setSelectedPlayerB] = useState<number | null>(null);
  const [editingPlayerB, setEditingPlayerB] = useState<Player>({ number: '', name: '' });

  const [showFormationA, setShowFormationA] = useState(false);
  const [showFormationB, setShowFormationB] = useState(false);

  /********
   * Refs *
   ********/
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const fieldRefB = useRef<HTMLDivElement | null>(null);

  const draggingRef = useRef<DragState | null>(null);
  const draggingRefB = useRef<DragState | null>(null);
  const singleClickTimerRef = useRef<number | null>(null);
  const singleClickTimerRefB = useRef<number | null>(null);

  // make sure overrides state exist before snapshot usage
  const [overrides, setOverrides] = useState<Record<number, { x: number; y: number }>>({});
  const [overridesB, setOverridesB] = useState<Record<number, { x: number; y: number }>>({});

  // Ensure document background is always transparent
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.style.background = 'transparent';
    body.style.background = 'transparent';
  }, []);

  // Prevent F11 (fullscreen) from changing window state in Electron/Chromium
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      try {
        if (e.key === 'F11') {
          e.preventDefault();
          e.stopImmediatePropagation();
          return false;
        }
      } catch (err) {}
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Listen for team selection messages from popup (browse.html)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e?.data as any;
      if (!data || data?.type !== 'team-selected') return;
      try {
        const team = data.team as TeamEntry | undefined;
        const target = (data.target || '').toString();
        if (!team || !target) return;
        if (target === 'A') {
          setTeamNameA(team.englishName ?? team.slug ?? '');
          setTeamLogoA(team);
        } else if (target === 'B') {
          setTeamNameB(team.englishName ?? team.slug ?? '');
          setTeamLogoB(team);
        }
      } catch (err) {
        // ignore malformed messages
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /***********************
   * Save / Load JSON     *
   ***********************/
  const collectAppSnapshot = () => {
    // Collect the minimal app state to export
    return {
      formation,
      players,
      uniformColor,
      overrides,
      formationB,
      playersB,
      uniformColorB,
      overridesB,
      teamNameA,
      teamLogoA,
      teamNameB,
      teamLogoB,
      scoreA,
      scoreB,
      verticalMode,
    } as const;
  };

  const applySnapshot = (data: any) => {
    try {
      if (!data || typeof data !== 'object') return;
      if (data.formation) setFormation(data.formation);
      if (Array.isArray(data.players)) setPlayers(data.players);
      if (typeof data.uniformColor === 'string') setUniformColor(data.uniformColor);
      if (data.overrides && typeof data.overrides === 'object') setOverrides(data.overrides);
      if (data.formationB) setFormationB(data.formationB);
      if (Array.isArray(data.playersB)) setPlayersB(data.playersB);
      if (typeof data.uniformColorB === 'string') setUniformColorB(data.uniformColorB);
      if (data.overridesB && typeof data.overridesB === 'object') setOverridesB(data.overridesB);
      if (typeof data.teamNameA === 'string') setTeamNameA(data.teamNameA);
      if (data.teamLogoA) setTeamLogoA(data.teamLogoA);
      if (typeof data.teamNameB === 'string') setTeamNameB(data.teamNameB);
      if (data.teamLogoB) setTeamLogoB(data.teamLogoB);
      if (typeof data.scoreA === 'number') setScoreA(data.scoreA);
      if (typeof data.scoreB === 'number') setScoreB(data.scoreB);
      if (typeof data.verticalMode === 'boolean') setVerticalMode(data.verticalMode);
    } catch (err) {
      console.warn('applySnapshot failed', err);
    }
  };

  const handleSaveJSON = async () => {
    const snapshot = collectAppSnapshot();
    // Use Electron IPC if available, otherwise trigger browser download
    try {
      if ((window as any).electronAPI?.saveFile) {
        await (window as any).electronAPI.saveFile({ data: snapshot, defaultPath: 'lineup.json' });
        return;
      }
    } catch (err) {
      console.warn('electron saveFile failed, falling back to browser download', err);
    }

    // Browser fallback
    try {
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lineup.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Browser download failed', err);
    }
  };

  const handleLoadJSON = async () => {
    // Try Electron open-file first
    try {
      if ((window as any).electronAPI?.openFile) {
        const res = await (window as any).electronAPI.openFile();
        if (!res || res.canceled) return;
        const data = res.data ?? null;
        applySnapshot(data);
        return;
      }
    } catch (err) {
      console.warn('electron openFile failed, falling back to browser file input', err);
    }

    // Browser fallback: create invisible file input
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      input.onchange = (e: any) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = JSON.parse(String(reader.result));
            applySnapshot(parsed);
          } catch (err) {
            console.error('Failed to parse uploaded JSON', err);
          }
        };
        reader.readAsText(file);
      };
      document.body.appendChild(input);
      input.click();
      input.remove();
    } catch (err) {
      console.error('Browser file input failed', err);
    }
  };

  // cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (singleClickTimerRef.current) window.clearTimeout(singleClickTimerRef.current);
      if (singleClickTimerRefB.current) window.clearTimeout(singleClickTimerRefB.current);
    };
  }, []);

  /****************
   * UI Handlers  *
   ****************/

  /*******************************
   * Formation & Players Updaters *
   *******************************/

  const updatePlayersForFormation = (newFormation: Formation) => {
    const newTotal = newFormation.lines.reduce((sum, line) => sum + line, 0);
    const newPlayers = Array.from({ length: newTotal }, (_, i) => ({
      number: players[i]?.number || String(i + 1),
      name: players[i]?.name || `선수 ${i + 1}`,
    }));
    setPlayers(newPlayers);
    setFormation(newFormation);
    setOverrides({}); // reset manual drags
  };

  const updatePlayersForFormationB = (newFormation: Formation) => {
    const newTotal = newFormation.lines.reduce((sum, line) => sum + line, 0);
    const newPlayers = Array.from({ length: newTotal }, (_, i) => ({
      number: playersB[i]?.number || String(i + 1),
      name: playersB[i]?.name || `선수 ${i + 1}`,
    }));
    setPlayersB(newPlayers);
    setFormationB(newFormation);
    setOverridesB({});
  };

  const handlePlayerChange = (index: number, player: Player) => {
    setPlayers((prev) => {
      const next = [...prev];
      next[index] = player;
      return next;
    });
  };

  const handlePlayerChangeB = (index: number, player: Player) => {
    setPlayersB((prev) => {
      const next = [...prev];
      next[index] = player;
      return next;
    });
  };

  const handlePlayerClick = (index: number) => {
    setSelectedPlayer(index);
    setEditingPlayer(players[index]);
  };

  const handlePlayerClickB = (index: number) => {
    setSelectedPlayerB(index);
    setEditingPlayerB(playersB[index]);
  };

  const handleSavePlayer = () => {
    if (selectedPlayer !== null) {
      handlePlayerChange(selectedPlayer, editingPlayer);
      setSelectedPlayer(null);
    }
  };

  const handleSavePlayerB = () => {
    if (selectedPlayerB !== null) {
      handlePlayerChangeB(selectedPlayerB, editingPlayerB);
      setSelectedPlayerB(null);
    }
  };

  /***************************
   * Pointer / Drag Handlers *
   ***************************/
  const toPercent = useCallback(
    (clientX: number, clientY: number, ref?: React.RefObject<HTMLDivElement | null>) => {
      const el = (ref?.current ?? fieldRef.current);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * 100;
      const y = ((clientY - rect.top) / rect.height) * 100;
      return { x: clamp01(x), y: clamp01(y) };
    },
    []
  );

  const onPointerDown = (e: React.PointerEvent, index: number) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    draggingRef.current = {
      index,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      pointerOffsetX: e.clientX - centerX,
      pointerOffsetY: e.clientY - centerY,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dr = draggingRef.current;
    const dx = e.clientX - dr.startX;
    const dy = e.clientY - dr.startY;
    if (Math.hypot(dx, dy) > MOVEMENT_THRESHOLD) dr.moved = true;

    const adjustedClientX = e.clientX - dr.pointerOffsetX;
    const adjustedClientY = e.clientY - dr.pointerOffsetY;
    const p = toPercent(adjustedClientX, adjustedClientY, fieldRef);
    if (!p) return;

    if (verticalMode) {
      const halfY = clamp01((p.y / 50) * 100); // map 0..50 => 0..100 (top half)
      setOverrides((prev) => ({ ...prev, [dr.index]: { x: p.x, y: halfY } }));
    } else {
      setOverrides((prev) => ({ ...prev, [dr.index]: p }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    const { index, moved } = draggingRef.current;
    draggingRef.current = null;

    if (!moved) {
      if (singleClickTimerRef.current) window.clearTimeout(singleClickTimerRef.current);
      singleClickTimerRef.current = window.setTimeout(() => {
        handlePlayerClick(index);
        singleClickTimerRef.current = null;
      }, 250);
    }
  };

  const onPointerDownB = (e: React.PointerEvent, index: number) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    draggingRefB.current = {
      index,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      pointerOffsetX: e.clientX - centerX,
      pointerOffsetY: e.clientY - centerY,
    };
  };

  const onPointerMoveB = (e: React.PointerEvent) => {
    if (!draggingRefB.current) return;
    const dr = draggingRefB.current;
    const dx = e.clientX - dr.startX;
    const dy = e.clientY - dr.startY;
    if (Math.hypot(dx, dy) > MOVEMENT_THRESHOLD) dr.moved = true;

    const adjustedClientX = e.clientX - dr.pointerOffsetX;
    const adjustedClientY = e.clientY - dr.pointerOffsetY;
    const p = toPercent(adjustedClientX, adjustedClientY, verticalMode ? fieldRef : fieldRefB);
    if (!p) return;

    if (verticalMode) {
      const halfY = clamp01(((100 - p.y) / 50) * 100); // map bottom half 50..100 => 0..100
      setOverridesB((prev) => ({ ...prev, [dr.index]: { x: p.x, y: halfY } }));
    } else {
      setOverridesB((prev) => ({ ...prev, [dr.index]: p }));
    }
  };

  const onPointerUpB = (e: React.PointerEvent) => {
    if (!draggingRefB.current) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    const { index, moved } = draggingRefB.current;
    draggingRefB.current = null;

    if (!moved) {
      if (singleClickTimerRefB.current) window.clearTimeout(singleClickTimerRefB.current);
      singleClickTimerRefB.current = window.setTimeout(() => {
        handlePlayerClickB(index);
        singleClickTimerRefB.current = null;
      }, 250);
    }
  };

  /****************
   * Derived Data *
   ****************/
  const playerPositions = useMemo(() => calcPositions(formation), [formation]);
  const playerPositionsB = useMemo(() => calcPositions(formationB), [formationB]);

  /********
   * View *
   ********/
  return (
    <div className={`min-h-screen flex items-center justify-center p-8 bg-transparent`}>
      {/* Titlebar / draggable banner - make draggable regardless so frameless window can be moved */}
  <div style={{ position: 'fixed', top: 8, left: 20, right: 8, height: 48, zIndex: 60 }} className={'app-drag'}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 6, background: '#fff', marginLeft: 8, border: '1px solid rgba(0,0,0,0.08)' }} />
            <div style={{ color: '#111', fontWeight: 700, background: 'white', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)' }}>Soccer Lineup</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8, }}>
            <button onClick={() => electronAPI?.minimize?.()} className="px-2 py-1 rounded bg-white/10 text-white app-no-drag">_</button>
            <button onClick={() => electronAPI?.close?.()} className="px-2 py-1 rounded bg-red-600 text-white app-no-drag">✕</button>
          </div>
        </div>
      </div>

      {/* Top-left controls */}
  <div style={{ position: 'fixed', top: 13, left: 200, zIndex: 70, pointerEvents: 'auto' }} className="app-no-drag">
          <div className="flex gap-2 items-center">
            <Button onClick={() => setVerticalMode((s) => !s)} className="px-3 py-1 app-no-drag" style={{ border: '2px solid #e6e6e6', background: '#ffffff', color: '#111' }}>{verticalMode ? '가로모드' : '세로모드'}</Button>
            {/* Placeholder SAVE/LOAD buttons (UI only) */}
            <Button onClick={handleSaveJSON} className="px-3 py-1 app-no-drag" style={{ border: '2px solid #e6e6e6', background: '#ffffff', color: '#111' }}>SAVE</Button>
            <Button onClick={handleLoadJSON} className="px-3 py-1 app-no-drag" style={{ border: '2px solid #e6e6e6', background: '#ffffff', color: '#111' }}>LOAD</Button>
        </div>
      </div>

      <div className="flex gap-6 h-[700px] max-h-[90vh]" style={{ height: 700, marginTop: 100 }}>
        {/* Banner */}
  <div style={{ position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)', width: 900, height: 100, zIndex: 65 }}>
          <div style={{ width: '100%', height: '100%', background: 'transparent', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', width: '900px', height: '100px', borderRadius: 10, overflow: 'hidden', pointerEvents: 'none', zIndex: 64 }}>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))', backdropFilter: 'blur(6px) saturate(120%)', WebkitBackdropFilter: 'blur(6px) saturate(120%)', border: '1px solid rgba(255,255,255,0.06)' }} />
              <svg width="100%" height="100%" viewBox="0 0 100 12" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, opacity: 0.06 }}>
                <defs>
                  <pattern id="p" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(25)">
                    <rect width="3" height="6" fill="white" opacity="0.04" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#p)" />
              </svg>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', width: '100%', height: '100%', position: 'relative', zIndex: 65 }}>
              {/* Left: Team A */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 18 }}>
                <div style={{ width: 72, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {teamLogoA ? (
                    <img src={teamLogoA.logos.png ?? teamLogoA.logos.svg} alt={teamLogoA.englishName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  ) : (
                    <div style={{ width: 56, height: 56, borderRadius: 8, background: '#ffffff22' }} />
                  )}
                </div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 'clamp(14px, 1.6vw, 20px)' }}>{teamNameA || 'Team A'}</div>
              </div>

              {/* Center: Score */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <Suspense fallback={<div style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(28px, 4.2vw, 64px)' }}>{scoreA} : {scoreB}</div>}>
                  <ScoreDraggable value={scoreA} onChange={(v: number) => setScoreA(v)} />
                  <div style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(28px, 4.2vw, 64px)' }}>:</div>
                  <ScoreDraggable value={scoreB} onChange={(v: number) => setScoreB(v)} />
                </Suspense>
              </div>

              {/* Right: Team B */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end', paddingRight: 18 }}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 'clamp(14px, 1.6vw, 20px)', textAlign: 'right' }}>{teamNameB || 'Team B'}</div>
                <div style={{ width: 72, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {teamLogoB ? (
                    <img src={teamLogoB.logos.png ?? teamLogoB.logos.svg} alt={teamLogoB.englishName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  ) : (
                    <div style={{ width: 56, height: 56, borderRadius: 8, background: '#ffffff22' }} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Middle */}
        <div className="flex gap-0">
          {verticalMode ? (
            // Full-field vertical mode: single full-size field with both teams inside
            <div className="w-[506px] h-full rounded-2xl overflow-hidden p-6">
              <FootballField fieldRef={fieldRef} fullField>
                {/* Team A players mapped to top half */}
                {players.map((player, index) => {
                  const defaultPos = playerPositions[index];
                  if (!defaultPos) return null;
                  const pos = overrides[index] ?? defaultPos;
                  const topStart = 2;
                  const topSpan = 50;
                  const mappedY = topStart + (pos.y / 100) * topSpan;
                  const mappedX = 50 + (pos.x - 50) * 1.15;
                  return (
                    <div
                      key={`a-${index}`}
                      className="absolute transform -translate-x-1/2 -translate-y-1/2 touch-none"
                      style={{ left: `${mappedX}%`, top: `${mappedY}%`, cursor: 'grab' }}
                      onPointerDown={(e) => onPointerDown(e, index)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                      onDoubleClick={() => {
                        if (singleClickTimerRef.current) {
                          window.clearTimeout(singleClickTimerRef.current);
                          singleClickTimerRef.current = null;
                        }
                        handlePlayerClick(index);
                      }}
                    >
                      <PlayerCard number={player.number} name={player.name} color={uniformColor} onClick={() => handlePlayerClick(index)} compact size={42} fontSizeOverride={120} />
                    </div>
                  );
                })}

                {/* Team B players mirrored into bottom half */}
                {playersB.map((player, index) => {
                  const defaultPos = playerPositionsB[index];
                  if (!defaultPos) return null;
                  const basePos = overridesB[index] ?? defaultPos;
                  const bottomStart = 48;
                  const bottomSpan = 50;
                  const mirroredY = 100 - basePos.y;
                  const mappedY = bottomStart + (mirroredY / 100) * bottomSpan;
                  const mappedX = 50 + (basePos.x - 50) * 1.15;
                  return (
                    <div
                      key={`b-${index}`}
                      className="absolute transform -translate-x-1/2 -translate-y-1/2 touch-none"
                      style={{ left: `${mappedX}%`, top: `${mappedY}%`, cursor: 'grab' }}
                      onPointerDown={(e) => onPointerDownB(e, index)}
                      onPointerMove={onPointerMoveB}
                      onPointerUp={onPointerUpB}
                      onPointerCancel={onPointerUpB}
                      onDoubleClick={() => {
                        if (singleClickTimerRefB.current) {
                          window.clearTimeout(singleClickTimerRefB.current);
                          singleClickTimerRefB.current = null;
                        }
                        handlePlayerClickB(index);
                      }}
                    >
                      <PlayerCard number={player.number} name={player.name} color={uniformColorB} onClick={() => handlePlayerClickB(index)} compact size={42} fontSizeOverride={120} />
                    </div>
                  );
                })}
              </FootballField>
              {/* Team A & B compact panels for vertical mode: positioned near each half */}
              {/* Team A panel (below top half) */}
              <div style={{ position: 'absolute', left: '20%', transform: 'translateX(-50%)', top: '42%', width: 160, height: 96, zIndex: 80 }} className="app-drag">
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="app-no-drag">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '86%', alignItems: 'center' }}>
                    <button onClick={() => window.open('./browse.html?target=A','_blank','width=760,height=680')} className="app-no-drag" style={{ height: 40, width: '100%', background: '#ffffff', color: '#111', border: '2px solid #e6e6e6', borderRadius: 8 }}>팀 설정</button>
                    <button onClick={() => setShowFormationA(true)} className="app-no-drag" style={{ height: 40, width: '100%', background: '#ffffff', color: '#111', border: '2px solid #e6e6e6', borderRadius: 8 }}>{formation.name}</button>
                  </div>
                </div>
              </div>

              {/* Team B panel (above bottom half) */}
              <div style={{ position: 'absolute', left: '80%', transform: 'translateX(-50%)', top: '42%', width: 160, height: 96, zIndex: 80 }} className="app-drag">
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="app-no-drag">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '86%', alignItems: 'center' }}>
                    <button onClick={() => window.open('./browse.html?target=B','_blank','width=760,height=680')} className="app-no-drag" style={{ height: 40, width: '100%', background: '#ffffff', color: '#111', border: '2px solid #e6e6e6', borderRadius: 8 }}>팀 설정</button>
                    <button onClick={() => setShowFormationB(true)} className="app-no-drag" style={{ height: 40, width: '100%', background: '#ffffff', color: '#111', border: '2px solid #e6e6e6', borderRadius: 8 }}>{formationB.name}</button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="w-[506px] h-full rounded-2xl overflow-visible p-6" style={{ position: 'relative', transform: 'translateX(20px)' }}>
                <FootballField fieldRef={fieldRef}>
                  {players.map((player, index) => {
                    const defaultPos = playerPositions[index];
                    if (!defaultPos) return null;
                    const pos = overrides[index] ?? defaultPos;
                    return (
                      <div
                        key={`a-${index}`}
                        className="absolute transform -translate-x-1/2 -translate-y-1/2 touch-none"
                        style={{ left: `${pos.x}%`, top: `${pos.y}%`, cursor: 'grab' }}
                        onPointerDown={(e) => onPointerDown(e, index)}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                        onDoubleClick={() => {
                          if (singleClickTimerRef.current) {
                            window.clearTimeout(singleClickTimerRef.current);
                            singleClickTimerRef.current = null;
                          }
                          handlePlayerClick(index);
                        }}
                      >
                        <PlayerCard number={player.number} name={player.name} color={uniformColor} onClick={() => handlePlayerClick(index)} size={56} />
                      </div>
                    );
                  })}
                </FootballField>
                {/* Team A compact panel: only two buttons [팀 설정] [formation] */}
                  <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: -35, width: 260, height: 56, zIndex: 80 }} className="app-drag">
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="app-no-drag">
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => window.open('./browse.html?target=A','_blank','width=760,height=680')} className="app-no-drag" style={{ height: 40, minWidth: 98, background: '#ffffff', color: '#111', border: '2px solid #e6e6e6', borderRadius: 8 }}>팀 설정</button>
                      <button onClick={() => setShowFormationA(true)} className="app-no-drag" style={{ height: 40, minWidth: 98, background: '#ffffff', color: '#111', border: '2px solid #e6e6e6', borderRadius: 8 }}>{formation.name}</button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="w-[506px] h-full rounded-2xl overflow-visible p-6" style={{ position: 'relative', transform: 'translateX(-20px)' }}>
                <FootballField fieldRef={fieldRefB}>
                  {playersB.map((player, index) => {
                    const defaultPos = playerPositionsB[index];
                    if (!defaultPos) return null;
                    const pos = overridesB[index] ?? defaultPos;
                    return (
                      <div
                        key={`b-${index}`}
                        className="absolute transform -translate-x-1/2 -translate-y-1/2 touch-none"
                        style={{ left: `${pos.x}%`, top: `${pos.y}%`, cursor: 'grab' }}
                        onPointerDown={(e) => onPointerDownB(e, index)}
                        onPointerMove={onPointerMoveB}
                        onPointerUp={onPointerUpB}
                        onPointerCancel={onPointerUpB}
                        onDoubleClick={() => {
                          if (singleClickTimerRefB.current) {
                            window.clearTimeout(singleClickTimerRefB.current);
                            singleClickTimerRefB.current = null;
                          }
                          handlePlayerClickB(index);
                        }}
                      >
                        <PlayerCard number={player.number} name={player.name} color={uniformColorB} onClick={() => handlePlayerClickB(index)} size={56} />
                      </div>
                    );
                  })}
                </FootballField>
                {/* Team B compact panel: only two buttons [팀 설정] [formation] */}
                <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: -35, width: 260, height: 56, zIndex: 80 }} className="app-drag">
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="app-no-drag">
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => window.open('./browse.html?target=B','_blank','width=760,height=680')} className="app-no-drag" style={{ height: 40, minWidth: 98, background: '#ffffff', color: '#111', border: '2px solid #e6e6e6', borderRadius: 8 }}>팀 설정</button>
                      <button onClick={() => setShowFormationB(true)} className="app-no-drag" style={{ height: 40, minWidth: 98, background: '#ffffff', color: '#111', border: '2px solid #e6e6e6', borderRadius: 8 }}>{formationB.name}</button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

      </div>
      

      {/* Dialogs */}
      <Dialog open={selectedPlayer !== null} onOpenChange={(open: boolean) => !open && setSelectedPlayer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>선수 정보 수정</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-number">등번호</Label>
              <Input id="edit-number" value={editingPlayer.number} onChange={(e) => setEditingPlayer({ ...editingPlayer, number: e.target.value })} placeholder="10" maxLength={3} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name">이름</Label>
              <Input id="edit-name" value={editingPlayer.name} onChange={(e) => setEditingPlayer({ ...editingPlayer, name: e.target.value })} placeholder="선수명" />
            </div>
            <Button onClick={handleSavePlayer} className="w-full">저장</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={selectedPlayerB !== null} onOpenChange={(open: boolean) => !open && setSelectedPlayerB(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>팀 B 선수 정보 수정</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-number-b">등번호</Label>
              <Input id="edit-number-b" value={editingPlayerB.number} onChange={(e) => setEditingPlayerB({ ...editingPlayerB, number: e.target.value })} placeholder="10" maxLength={3} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name-b">이름</Label>
              <Input id="edit-name-b" value={editingPlayerB.name} onChange={(e) => setEditingPlayerB({ ...editingPlayerB, name: e.target.value })} placeholder="선수명" />
            </div>
            <Button onClick={handleSavePlayerB} className="w-full">저장</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Formation editor modals for compact panels */}
    <Dialog open={showFormationA} onOpenChange={(open: boolean) => !open && setShowFormationA(false)}>
  <DialogContent className="max-h-[77vh] overflow-auto" style={{ width: '520px', maxWidth: '95vw', top: '50%', transform: 'translate(50%,7%)' }}>
          <DialogHeader>
            <DialogTitle>팀 A 포메이션 편집</DialogTitle>
          </DialogHeader>
          <div style={{ width: '90%' }}>
            <FormationEditor inline={true} formation={formation} onFormationChange={(f) => { updatePlayersForFormation(f); setShowFormationA(false); }} players={players} onPlayerChange={handlePlayerChange} uniformColor={uniformColor} onUniformColorChange={setUniformColor} offsetPx={0} />
          </div>
        </DialogContent>
      </Dialog>

    <Dialog open={showFormationB} onOpenChange={(open: boolean) => !open && setShowFormationB(false)}>
  <DialogContent className="max-h-[77vh] overflow-auto" style={{ width: '520px', maxWidth: '95vw', top: '50%', transform: 'translate(-50%, 7%)' }}>
          <DialogHeader>
            <DialogTitle>팀 B 포메이션 편집</DialogTitle>
          </DialogHeader>
          <div style={{ width: '90%' }}>
            <FormationEditor inline={true} formation={formationB} onFormationChange={(f) => { updatePlayersForFormationB(f); setShowFormationB(false); }} players={playersB} onPlayerChange={handlePlayerChangeB} uniformColor={uniformColorB} onUniformColorChange={setUniformColorB} offsetPx={0} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
