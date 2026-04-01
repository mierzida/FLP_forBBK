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
  yellowCard?: boolean;
  redCard?: boolean;
  goals?: number;
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
  broadcastPlayerCoordinates?: (data: any) => Promise<void>;
  getUdpPort?: () => Promise<{ port?: number } | undefined>;
  setUdpPort?: (port: number) => Promise<{ success?: boolean; error?: string; port?: number } | undefined>;
  setTransparentMode?: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  getTransparentMode?: () => Promise<{ success: boolean; transparent: boolean }>;
  minimize?: () => void;
  toggleMaximize?: () => void;
  close?: () => void;
}

const MOVEMENT_THRESHOLD = 6; // px
const DEFAULT_UDP_PORT = 9107;

function clamp01(v: number) {
  return Math.max(0, Math.min(100, v));
}

function parseUdpPort(value: string | number | null | undefined): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 1 || parsed > 65535) return null;
  return parsed;
}

function calcPositions(formation: Formation): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];

  formation.lines.forEach((lineCount, lineIndex) => {
    const totalLines = Math.max(1, formation.lines.length - 1);
    const rawY = (lineIndex / totalLines) * 85 + 8; // original baseline
    const center = 50;
    let computedY = center + (rawY - center) * 0.8; // compress toward center
    computedY = Math.max(0, computedY - 3.5); // slight lift

    let yForLine = computedY;
    
    if (lineIndex === 0) {
      yForLine = 90; // GK (fixed at bottom)
    } else {
      // Calculate evenly spaced positions for all other lines
      const totalLines = formation.lines.length;
      const topY = 10;    // ATT position (top)
      const bottomY = 90; // GK position (bottom)
      const spacing = (bottomY - topY) / (totalLines - 1);
      
      // For lineIndex 1,2,3... calculate from top to bottom
      // Last line (highest lineIndex) should be at topY (15)
      yForLine = bottomY - (spacing * lineIndex);
    }

    for (let i = 0; i < lineCount; i++) {
      // i=0(API의 첫 선수)이 오른쪽(75%~80%)에 오도록 역순 계산 적용
      const baseX = ((lineCount - i) / (lineCount + 1)) * 100;
      const x = 50 + (baseX - 50) * 1.2; // widen spacing by 20%
      positions.push({ x, y: yForLine });
    }
  });

  return positions;
}

// 경기 시간을 MM:SS 형식으로 변환
function formatMatchTime(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined) return null;
  
  const mins = Math.floor(minutes);
  const secs = 0; // API에서는 분 단위만 제공
  
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 로컬 파일 경로를 HTTP URL로 변환
function convertLogoPathToURL(logoPath: string | null): string | null {
  if (!logoPath) return null;
  
  // 이미 HTTP URL이면 그대로 반환
  if (logoPath.startsWith('http://') || logoPath.startsWith('https://')) {
    return logoPath;
  }
  
  const HTTP_SERVER_URL = 'http://127.0.0.1:9104';
  
  // "./assets/logos/..." 형식 처리 (team-index.json 형식)
  if (logoPath.startsWith('./assets/')) {
    return `${HTTP_SERVER_URL}/assets/${logoPath.substring('./assets/'.length)}`;
  }
  
  // "assets/..." 형식 처리
  if (logoPath.startsWith('assets/')) {
    return `${HTTP_SERVER_URL}/${logoPath}`;
  }
  
  // "src/assets/..." 형식 처리
  if (logoPath.startsWith('src/assets/')) {
    return `${HTTP_SERVER_URL}/assets/${logoPath.substring('src/assets/'.length)}`;
  }
  
  // "public/assets/..." 형식 처리
  if (logoPath.startsWith('public/assets/')) {
    return `${HTTP_SERVER_URL}/assets/${logoPath.substring('public/assets/'.length)}`;
  }
  
  // 기본적으로 그대로 반환 (상대 경로 가정)
  return `${HTTP_SERVER_URL}/${logoPath}`;
}

const STAT_KEYS = [
  'Total Shots',
  'Shots on Goal',
  'Corner Kicks',
  'Fouls',
  'Offsides',
  'Yellow Cards',
  'Red Cards',
  'Ball Possession',
] as const;

interface StatEntry {
  type: string;
  value: string;
}

function parseTeamStats(statsResponse: any[], teamIndex: number): StatEntry[] {
  if (!statsResponse || statsResponse.length <= teamIndex) return [];
  const stats: any[] = statsResponse[teamIndex]?.statistics || [];
  return STAT_KEYS.map((key) => {
    const stat = stats.find((s: any) => s.type === key);
    const raw = stat?.value ?? null;
    return { type: key, value: raw !== null ? String(raw) : '0' };
  });
}

// 좌표 데이터를 소켓으로 전송하는 함수
function broadcastCurrentPlayerPositions(
  formation: Formation,
  formationB: Formation,
  players: Player[],
  playersB: Player[],
  overrides: Record<number, { x: number; y: number }>,
  overridesB: Record<number, { x: number; y: number }>,
  verticalMode: boolean,
  scoreA: number,
  scoreB: number,
  teamNameA: string,
  teamNameB: string,
  teamLogoA: any,
  teamLogoB: any,
  matchTime?: string | null,
  matchStatus?: string | null,
  electronAPI?: ElectronAPI,
  statsA?: StatEntry[],
  statsB?: StatEntry[]
) {
  if (!electronAPI?.broadcastPlayerCoordinates) return;

  try {
    const playerPositionsA = calcPositions(formation);
    const playerPositionsB = calcPositions(formationB);

    // 팀 A 선수 좌표 계산
    const teamAPositions = players.map((player, index) => {
      const defaultPos = playerPositionsA[index];
      if (!defaultPos) return null;

      let pos = overrides[index] ?? defaultPos;

      // 세로 모드 좌표 변환
      if (verticalMode) {
        const topStart = 2;
        const topSpan = 50;
        const mappedY = topStart + (pos.y / 100) * topSpan;
        const mappedX = 50 + (pos.x - 50) * 1.15;
        pos = { x: mappedX, y: mappedY };
      }

      return {
        id: `A-${index}`,
        team: 'A',
        number: player.number,
        name: player.name,
        x: Math.round(pos.x * 100) / 100, // 소수점 2자리까지
        y: Math.round(pos.y * 100) / 100,
        yellowCard: player.yellowCard || false,
        redCard: player.redCard || false
      };
    }).filter(Boolean);

    // 팀 B 선수 좌표 계산
    const teamBPositions = playersB.map((player, index) => {
      const defaultPos = playerPositionsB[index];
      if (!defaultPos) return null;

      let pos = overridesB[index] ?? defaultPos;

      // 세로 모드 좌표 변환
      if (verticalMode) {
        const bottomStart = 48;
        const bottomSpan = 50;
        const mirroredY = 100 - pos.y;
        const mappedY = bottomStart + (mirroredY / 100) * bottomSpan;
        const mappedX = 50 + (pos.x - 50) * 1.15;
        pos = { x: mappedX, y: mappedY };
      }

      return {
        id: `B-${index}`,
        team: 'B',
        number: player.number,
        name: player.name,
        x: Math.round(pos.x * 100) / 100,
        y: Math.round(pos.y * 100) / 100,
        yellowCard: player.yellowCard || false,
        redCard: player.redCard || false
      };
    }).filter(Boolean);

    const data = {
      timestamp: Date.now(),
      verticalMode,
      match: {
        scoreA,
        scoreB,
        elapsed: matchTime || null,
        status: matchStatus || null,
        teamA: {
          name: teamNameA || 'Team A',
          formation: formation.name,
          uniformColor: players[0]?.name ? 'blue' : 'blue', // 기본값
          logo: teamLogoA ? {
            id: teamLogoA.id,
            slug: teamLogoA.slug,
            country: teamLogoA.country,
            englishName: teamLogoA.englishName,
            svgUrl: convertLogoPathToURL(teamLogoA.logos?.svg),
            pngUrl: convertLogoPathToURL(teamLogoA.logos?.png)
          } : null
        },
        teamB: {
          name: teamNameB || 'Team B',
          formation: formationB.name,
          uniformColor: playersB[0]?.name ? 'red' : 'red', // 기본값
          logo: teamLogoB ? {
            id: teamLogoB.id,
            slug: teamLogoB.slug,
            country: teamLogoB.country,
            englishName: teamLogoB.englishName,
            svgUrl: convertLogoPathToURL(teamLogoB.logos?.svg),
            pngUrl: convertLogoPathToURL(teamLogoB.logos?.png)
          } : null
        }
      },
      teams: {
        A: teamAPositions,
        B: teamBPositions
      },
      stats: {
        A: statsA || [],
        B: statsB || []
      }
    };

    electronAPI.broadcastPlayerCoordinates(data);
  } catch (error) {
    console.warn('Failed to broadcast player coordinates:', error);
  }
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

  const [matchStatsA, setMatchStatsA] = useState<StatEntry[]>([]);
  const [matchStatsB, setMatchStatsB] = useState<StatEntry[]>([]);

  const [verticalMode, setVerticalMode] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<number | null>(null);
  const [editingPlayer, setEditingPlayer] = useState<Player>({ number: '', name: '', yellowCard: false, redCard: false });
  const [selectedPlayerB, setSelectedPlayerB] = useState<number | null>(null);
  const [editingPlayerB, setEditingPlayerB] = useState<Player>({ number: '', name: '', yellowCard: false, redCard: false });

  const [showFormationA, setShowFormationA] = useState(false);
  const [showFormationB, setShowFormationB] = useState(false);

  // API-Football states
  const [apiKey, setApiKey] = useState(() => {
    try {
      return localStorage.getItem('api-football-key') || '';
    } catch {
      return '';
    }
  });
  const [udpPortInput, setUdpPortInput] = useState(() => {
    try {
      const savedPort = parseUdpPort(localStorage.getItem('udp-port'));
      return String(savedPort ?? DEFAULT_UDP_PORT);
    } catch {
      return String(DEFAULT_UDP_PORT);
    }
  });
  const [showLiveMatches, setShowLiveMatches] = useState(false);
  const [liveMatches, setLiveMatches] = useState<any[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [selectedFixtureId, setSelectedFixtureId] = useState<number | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const refreshIntervalRef = useRef<number | null>(null);


  // 프리미어리그, 분데스리가 위주로 필터링
  const [activeTab, setActiveTab] = useState<'UPCOMING' | 'LIVE' | 'FINISHED'>('LIVE');
  const LEAGUE_IDS = [39, 78]; // 39: EPL, 78: Bundesliga 1
  const SUPPORTED_COUNTRIES = [
    'england', 'uk', 'united kingdom',
    'france', 'germany', 'italy', 'turkey',
    'south korea', 'korea republic', 'korea',
    'japan',
    'usa', 'united states', 'united states of america'
  ];

  const isTargetLeague = (league: any) => {
    if (!league || !league.country || !league.name) return false;
    const country = String(league.country).toLowerCase();
    const leagueName = String(league.name).toLowerCase();

    const internationalKeywords = ['friendly', 'international', 'nations', 'world cup', 'world'];
    const isInternational = internationalKeywords.some((kw) => leagueName.includes(kw)) || country === 'world';

    if (isInternational) return true;
    if (SUPPORTED_COUNTRIES.includes(country)) return true;
    return false;
  };


  /********
   * Refs *
   ********/
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const fieldRefB = useRef<HTMLDivElement | null>(null);

  const draggingRef = useRef<DragState | null>(null);
  const draggingRefB = useRef<DragState | null>(null);
  const singleClickTimerRef = useRef<number | null>(null);
  const singleClickTimerRefB = useRef<number | null>(null);
  const broadcastTimerRef = useRef<number | null>(null);
  const isInitialMount = useRef<boolean>(true);

  // make sure overrides state exist before snapshot usage
  const [overrides, setOverrides] = useState<Record<number, { x: number; y: number }>>({});
  const [overridesB, setOverridesB] = useState<Record<number, { x: number; y: number }>>({});

  const getDefaultPlayers = (count: number = 11): Player[] =>
    Array.from({ length: count }, (_, idx) => ({ number: String(idx + 1), name: `선수 ${idx + 1}` }));

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

  // 선수 정보 변경 시 데이터 전송
  useEffect(() => {
    if (isInitialMount.current) return;

    if (broadcastTimerRef.current) window.clearTimeout(broadcastTimerRef.current);
    broadcastTimerRef.current = window.setTimeout(() => {
      broadcastCurrentPlayerPositions(
        formation, formationB, players, playersB, overrides, overridesB,
        verticalMode, scoreA, scoreB, teamNameA, teamNameB, teamLogoA, teamLogoB,
        null, null, electronAPI, matchStatsA, matchStatsB
      );
      broadcastTimerRef.current = null;
    }, 100);
  }, [players, playersB]);

  // API 키 저장
  useEffect(() => {
    try {
      if (apiKey) {
        localStorage.setItem('api-football-key', apiKey);
      }
    } catch (error) {
      console.warn('Failed to save API key:', error);
    }
  }, [apiKey]);

  // UDP 전송 포트 초기화 (기본 9107, 저장값 우선)
  useEffect(() => {
    let cancelled = false;

    const initUdpPort = async () => {
      let targetPort = DEFAULT_UDP_PORT;
      const savedPort = parseUdpPort(udpPortInput);
      if (savedPort !== null) targetPort = savedPort;

      try {
        if (electronAPI?.setUdpPort) {
          const res = await electronAPI.setUdpPort(targetPort);
          const confirmed = parseUdpPort(res?.port);
          if (!cancelled && confirmed !== null) {
            setUdpPortInput(String(confirmed));
          }
        }
      } catch (error) {
        // ignore: local preview/browser mode or unavailable IPC
      }
    };

    void initUdpPort();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyUdpPort = useCallback(async () => {
    const parsedPort = parseUdpPort(udpPortInput);
    if (parsedPort === null) {
      alert('포트는 1~65535 사이의 숫자여야 합니다.');
      return;
    }

    try {
      localStorage.setItem('udp-port', String(parsedPort));
    } catch (error) {
      // ignore localStorage errors
    }

    if (!electronAPI?.setUdpPort) return;

    try {
      const res = await electronAPI.setUdpPort(parsedPort);
      if (res?.success === false) {
        alert('UDP 포트 적용에 실패했습니다.');
        return;
      }
      const confirmed = parseUdpPort(res?.port);
      if (confirmed !== null) {
        setUdpPortInput(String(confirmed));
      }
    } catch (error) {
      alert('UDP 포트 적용에 실패했습니다.');
    }
  }, [udpPortInput, electronAPI]);

  // 팀 이름 변경 시 데이터 전송
  useEffect(() => {
    if (isInitialMount.current) return;

    setTimeout(() => {
      broadcastCurrentPlayerPositions(
        formation, formationB, players, playersB, overrides, overridesB,
        verticalMode, scoreA, scoreB, teamNameA, teamNameB, teamLogoA, teamLogoB,
        null, null, electronAPI, matchStatsA, matchStatsB
      );
    }, 0);
  }, [teamNameA, teamNameB]);

  // 스코어 변경 시 데이터 전송
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (broadcastTimerRef.current) window.clearTimeout(broadcastTimerRef.current);
    broadcastTimerRef.current = window.setTimeout(() => {
      broadcastCurrentPlayerPositions(
        formation, formationB, players, playersB, overrides, overridesB,
        verticalMode, scoreA, scoreB, teamNameA, teamNameB, teamLogoA, teamLogoB,
        null, null, electronAPI, matchStatsA, matchStatsB
      );
      broadcastTimerRef.current = null;
    }, 100);
  }, [scoreA, scoreB]);

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
      if (broadcastTimerRef.current) window.clearTimeout(broadcastTimerRef.current);
      if (refreshIntervalRef.current) window.clearInterval(refreshIntervalRef.current);
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

    setTimeout(() => {
      broadcastCurrentPlayerPositions(newFormation, formationB, newPlayers, playersB, {}, overridesB, verticalMode, scoreA, scoreB, teamNameA, teamNameB, teamLogoA, teamLogoB, null, null, electronAPI, matchStatsA, matchStatsB);
    }, 0);
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

    setTimeout(() => {
      broadcastCurrentPlayerPositions(formation, newFormation, players, newPlayers, overrides, {}, verticalMode, scoreA, scoreB, teamNameA, teamNameB, teamLogoA, teamLogoB, null, null, electronAPI, matchStatsA, matchStatsB);
    }, 0);
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

  const handleSwapTeams = () => {
    // 팀 A와 팀 B의 모든 정보를 서로 교환
    const tempFormation = formation;
    const tempPlayers = players;
    const tempUniformColor = uniformColor;
    const tempTeamName = teamNameA;
    const tempTeamLogo = teamLogoA;
    const tempOverrides = overrides;

    setFormation(formationB);
    setPlayers(playersB);
    setUniformColor(uniformColorB);
    setTeamNameA(teamNameB);
    setTeamLogoA(teamLogoB);
    setOverrides(overridesB);

    setFormationB(tempFormation);
    setPlayersB(tempPlayers);
    setUniformColorB(tempUniformColor);
    setTeamNameB(tempTeamName);
    setTeamLogoB(tempTeamLogo);
    setOverridesB(tempOverrides);
  };

/***************************
   * API-Football Integration *
   ***************************/
  
  // 실시간, 예정, 종료 경기 목록 통합 가져오기 (EPL, 분데스리가 필터 적용)
  const loadLiveMatches = async () => {
    if (!apiKey.trim()) {
      alert('API 키를 입력하세요');
      return;
    }

    setIsLoadingMatches(true);

    try {
     // 1. 오늘 날짜 계산 (ISO 포맷: YYYY-MM-DD)
      const todayStr = new Date().toISOString().split('T')[0];

      // 2. 오늘 날짜의 모든 경기 요청
      const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${todayStr}`, {
        headers: { 'x-apisports-key': apiKey }
      });

      const data = await response.json();
      const allMatches = data.response || [];

      if (allMatches.length > 0) {
        // 시간 순으로 정렬 (보기 편하게)
        allMatches.sort((a: any, b: any) => a.fixture.timestamp - b.fixture.timestamp);

        setLiveMatches(allMatches);
      } else {
        setLiveMatches([]);
        alert('오늘 예정된 경기 데이터가 없습니다');
      }
    } catch (error) {
      console.error('Failed to load matches:', error);
      alert('경기 목록을 불러오는데 실패했습니다');
    } finally {
      setIsLoadingMatches(false);
    }
  };

  // 포메이션 문자열을 배열로 변환 (예: "4-3-3" -> [1, 4, 3, 3])
  const parseFormation = (formationStr: string): number[] => {
    if (!formationStr) return [1, 4, 3, 3];
    
    // API 데이터는 "4-3-3" 형식이므로 하이픈으로 분리
    const parts = formationStr.split('-').map(n => parseInt(n, 10));
    return [1, ...parts]; // 골키퍼 1명 추가
  };

  // 경기 라인업 가져오기 및 적용
  const loadMatchLineup = async (fixtureId: number, homeTeam: any, awayTeam: any, score: any, isAutoRefresh: boolean = false) => {
    if (!isAutoRefresh) {
      setIsLoadingMatches(true);
    }
    
    try {
      const headers = { 'x-apisports-key': apiKey };

      // 라인업, 경기 정보, 통계 병렬 요청
      const [lineupResponse, fixtureResponse, statsResponse] = await Promise.all([
        fetch(`https://v3.football.api-sports.io/fixtures/lineups?fixture=${fixtureId}`, { headers }),
        fetch(`https://v3.football.api-sports.io/fixtures?id=${fixtureId}`, { headers }),
        fetch(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${fixtureId}`, { headers }),
      ]);

      const [lineupData, fixtureData, statsData] = await Promise.all([
        lineupResponse.json(),
        fixtureResponse.json(),
        statsResponse.json(),
      ]);

      const latestFixture = fixtureData.response[0];
      const events = latestFixture.events || [];

      if (lineupData.response && lineupData.response.length >= 2 && fixtureData.response[0]) {
        const homeLineup = lineupData.response[0];
        const awayLineup = lineupData.response[1];
        const latestFixture = fixtureData.response[0];
        const allEvents = latestFixture.events || [];

        console.log(`------- 🔄 실시간 데이터 분석 시작 (Events: ${allEvents.length}개) -------`);

        const getLivePlayers = (lineup: any, teamName: string) => {
          const teamId = Number(lineup.team.id);
          
          // 1. 초기 선발 명단 설정
          let currentXI = lineup.startXI.map((p: any) => ({
            id: Number(p.player.id),
            name: p.player.name,
            number: p.player.number?.toString() || "0"
          }));

          // 2. 교체(subst) 이벤트 처리
          const substEvents = allEvents
            .filter((ev: any) => ev.type?.toLowerCase() === 'subst' && Number(ev.team?.id) === teamId)
            .sort((a: any, b: any) => a.time.elapsed - b.time.elapsed);

          substEvents.forEach((ev: any) => {
            const outId = Number(ev.player?.id); // 나가는 선수 (예: 6561 N. Solís)
            const inId = Number(ev.assist?.id);   // 들어오는 선수 (예: 35845 H. Burbano)
            const inName = ev.assist?.name;

            if (outId && inId) {
              const idx = currentXI.findIndex((p: any) => Number(p.id) === outId);
              if (idx !== -1) {
                console.log(`🔄 [교체 확인] ${teamName}: ${currentXI[idx].name} ➡️ ${inName}`);
                
                // 벤치 명단에서 들어온 선수의 등번호 확인
                const benchPlayer = lineup.substitutes.find((s: any) => Number(s.player.id) === inId);
                
                currentXI[idx] = {
                  id: inId,
                  name: inName,
                  number: benchPlayer?.player.number?.toString() || currentXI[idx].number
                };
              }
            }
          });

          // 3. 최종 명단에 득점/카드 매핑 (교체된 선수 포함)
          return currentXI.map((p: any, idx: number) => {
            const pId = Number(p.id);
            const pName = p.name;

            // 득점 매칭
            const goalCount = allEvents.filter((ev: any) => 
              ev.type?.toLowerCase() === 'goal' && 
              (Number(ev.player?.id) === pId || (pName && ev.player?.name === pName))
            ).length;

            // 카드 매칭 (예: 90분 Hernán Burbano 레드카드 감지)
            const hasYellow = allEvents.some((ev: any) => 
              ev.type?.toLowerCase() === 'card' && 
              ev.detail?.toLowerCase().includes('yellow card') && 
              (Number(ev.player?.id) === pId || ev.player?.name === pName)
            );
            const hasRed = allEvents.some((ev: any) => 
              ev.type?.toLowerCase() === 'card' && 
              ev.detail?.toLowerCase().includes('red card') && 
              (Number(ev.player?.id) === pId || ev.player?.name === pName)
            );

            return {
              number: p.number || (idx + 1).toString(),
              name: pName || `선수 ${idx + 1}`,
              yellowCard: hasYellow,
              redCard: hasRed,
              goals: goalCount
            };
          });
        };

        // 4. 홈/어웨이 선수 상태 업데이트

        // 홈팀 (팀 A) 설정
        const homeFormationStr = homeLineup.formation || '4-3-3';
        const homePlayers = getLivePlayers(homeLineup, "HOME");;
        const homeFormation: Formation = { name: homeFormationStr, lines: parseFormation(homeFormationStr) };

        // 어웨이팀 (팀 B) 설정
        const awayFormationStr = awayLineup.formation || '4-3-3';
        const awayPlayers = getLivePlayers(awayLineup, "AWAY");
        const awayFormation: Formation = { name: awayFormationStr, lines: parseFormation(awayFormationStr) };

        console.log("---------------------------------------");

        // 팀 로고 설정
        const homeLogoData = {
          id: `api/${homeTeam.id}`,
          slug: homeTeam.name.toLowerCase().replace(/\s+/g, '-'),
          country: homeLineup.team.country || 'unknown',
          englishName: homeTeam.name,
          logos: { svg: null, png: homeTeam.logo }
        };

        const awayLogoData = {
          id: `api/${awayTeam.id}`,
          slug: awayTeam.name.toLowerCase().replace(/\s+/g, '-'),
          country: awayLineup.team.country || 'unknown',
          englishName: awayTeam.name,
          logos: { svg: null, png: awayTeam.logo }
        };

        // 상태 업데이트
        setFormation(homeFormation);
        setPlayers(homePlayers);
        setTeamNameA(homeTeam.name);
        setTeamLogoA(homeLogoData);
        if (!isAutoRefresh) setOverrides({});

        setFormationB(awayFormation);
        setPlayersB(awayPlayers);
        setTeamNameB(awayTeam.name);
        setTeamLogoB(awayLogoData);
        if (!isAutoRefresh) setOverridesB({});

        const newScoreA = latestFixture.goals.home || 0;
        const newScoreB = latestFixture.goals.away || 0;
        const matchElapsedFormatted = formatMatchTime(latestFixture.fixture.status.elapsed);
        const matchStatus = latestFixture.fixture.status.short;

        // 통계 파싱 (홈=index 0, 어웨이=index 1)
        const statsRaw = statsData.response || [];
        const newStatsA = parseTeamStats(statsRaw, 0);
        const newStatsB = parseTeamStats(statsRaw, 1);

        setScoreA(newScoreA);
        setScoreB(newScoreB);
        setMatchStatsA(newStatsA);
        setMatchStatsB(newStatsB);

        // 데이터 전송
        setTimeout(() => {
          broadcastCurrentPlayerPositions(
            homeFormation, awayFormation, homePlayers, awayPlayers,
            isAutoRefresh ? overrides : {}, isAutoRefresh ? overridesB : {},
            verticalMode, newScoreA, newScoreB, homeTeam.name, awayTeam.name,
            homeLogoData, awayLogoData, matchElapsedFormatted, matchStatus, electronAPI,
            newStatsA, newStatsB
          );
        }, 100);

        if (!isAutoRefresh) {
          setSelectedFixtureId(fixtureId);
          setAutoRefreshEnabled(true);
          setShowLiveMatches(false);
          alert(`${homeTeam.name} vs ${awayTeam.name} 라인업 로드 완료 (10초 자동갱신)`);
        } else {
          console.log(`🔄 자동 갱신 완료: ${homeTeam.name} vs ${awayTeam.name}`);
        }
      } else {
        // 라인업 정보가 없을 때: 팀명/로고만 반영하고 선수는 빈 상태로 유지
        const homeLogoData = {
          id: `api/${homeTeam.id}`,
          slug: homeTeam.name.toLowerCase().replace(/\s+/g, '-'),
          country: homeTeam.country || 'unknown',
          englishName: homeTeam.name,
          logos: { svg: null, png: homeTeam.logo }
        };

        const awayLogoData = {
          id: `api/${awayTeam.id}`,
          slug: awayTeam.name.toLowerCase().replace(/\s+/g, '-'),
          country: awayTeam.country || 'unknown',
          englishName: awayTeam.name,
          logos: { svg: null, png: awayTeam.logo }
        };

        const emptyFormation: Formation = { name: '4-3-3', lines: [1, 4, 3, 3] };

        setTeamNameA(homeTeam.name);
        setTeamLogoA(homeLogoData);
        setFormation(emptyFormation);
        setPlayers(getDefaultPlayers());
        setOverrides({});

        setTeamNameB(awayTeam.name);
        setTeamLogoB(awayLogoData);
        setFormationB(emptyFormation);
        setPlayersB(getDefaultPlayers());
        setOverridesB({});

        const newScoreA = score?.home || 0;
        const newScoreB = score?.away || 0;
        const matchElapsedFormatted = latestFixture?.fixture?.status?.elapsed ? formatMatchTime(latestFixture.fixture.status.elapsed) : null;
        const matchStatus = latestFixture?.fixture?.status?.short ?? null;

        setScoreA(newScoreA);
        setScoreB(newScoreB);
        setMatchStatsA([]);
        setMatchStatsB([]);

        setTimeout(() => {
          broadcastCurrentPlayerPositions(
            emptyFormation, emptyFormation, [], [], {}, {},
            verticalMode, newScoreA, newScoreB, homeTeam.name, awayTeam.name,
            homeLogoData, awayLogoData, matchElapsedFormatted, matchStatus, electronAPI,
            [], []
          );
        }, 100);

        if (!isAutoRefresh) {
          setSelectedFixtureId(fixtureId);
          setAutoRefreshEnabled(true);
          setShowLiveMatches(false);
          alert(`${homeTeam.name} vs ${awayTeam.name} 라인업 정보가 현재 미제공입니다. 팀 기본 정보만 적용 후 10초 자동재조회 시작`);
        } else {
          console.log(`🔄 자동 갱신 - 라인업 미제공 상태: ${homeTeam.name} vs ${awayTeam.name}`);
        }
      }
    } catch (error) {
      console.error('Failed to load lineup:', error);
      if (!isAutoRefresh) {
        alert('라인업을 불러오는데 실패했습니다');
      }
    } finally {
      if (!isAutoRefresh) {
        setIsLoadingMatches(false);
      }
    }
  };

  // 자동 갱신 중지
  const stopAutoRefresh = () => {
    if (refreshIntervalRef.current) {
      window.clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
    setAutoRefreshEnabled(false);
    setSelectedFixtureId(null);
  };

  // 자동 갱신 효과
  useEffect(() => {
    if (autoRefreshEnabled && selectedFixtureId && apiKey) {
      // 10초마다 갱신
      refreshIntervalRef.current = window.setInterval(() => {
        // 현재 선택된 경기 정보 찾기
        const selectedMatch = liveMatches.find(m => m.fixture.id === selectedFixtureId);
        if (selectedMatch) {
          loadMatchLineup(
            selectedFixtureId,
            selectedMatch.teams.home,
            selectedMatch.teams.away,
            selectedMatch.goals,
            true // 자동 갱신 플래그
          );
        }
      }, 10000); // 10초

      // cleanup
      return () => {
        if (refreshIntervalRef.current) {
          window.clearInterval(refreshIntervalRef.current);
          refreshIntervalRef.current = null;
        }
      };
    }
  }, [autoRefreshEnabled, selectedFixtureId, apiKey, liveMatches]);

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
    } else {
      if (broadcastTimerRef.current) window.clearTimeout(broadcastTimerRef.current);
      broadcastTimerRef.current = window.setTimeout(() => {
        broadcastCurrentPlayerPositions(formation, formationB, players, playersB, overrides, overridesB, verticalMode, scoreA, scoreB, teamNameA, teamNameB, teamLogoA, teamLogoB, null, null, electronAPI, matchStatsA, matchStatsB);
        broadcastTimerRef.current = null;
      }, 100);
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
    } else {
      if (broadcastTimerRef.current) window.clearTimeout(broadcastTimerRef.current);
      broadcastTimerRef.current = window.setTimeout(() => {
        broadcastCurrentPlayerPositions(formation, formationB, players, playersB, overrides, overridesB, verticalMode, scoreA, scoreB, teamNameA, teamNameB, teamLogoA, teamLogoB, null, null, electronAPI, matchStatsA, matchStatsB);
        broadcastTimerRef.current = null;
      }, 100);
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
            <Button onClick={() => {
              const newVerticalMode = !verticalMode;
              setVerticalMode(newVerticalMode);
              setTimeout(() => {
                broadcastCurrentPlayerPositions(formation, formationB, players, playersB, overrides, overridesB, newVerticalMode, scoreA, scoreB, teamNameA, teamNameB, teamLogoA, teamLogoB, null, null, electronAPI, matchStatsA, matchStatsB);
              }, 0);
            }} className="px-3 py-1 app-no-drag" style={{ border: '2px solid #e6e6e6', background: '#ffffff', color: '#111' }}>{verticalMode ? '가로모드' : '세로모드'}</Button>
            <Button onClick={handleSwapTeams} className="px-3 py-1 app-no-drag" style={{ border: '2px solid #e6e6e6', background: '#ffffff', color: '#111' }} title="팀 A와 팀 B 정보 교환">⇄ 팀교환</Button>
            <Button onClick={() => setShowLiveMatches(true)} className="px-3 py-1 app-no-drag" style={{ border: '2px solid #16a34a', background: '#16a34a', color: '#ffffff' }} title="API-Football 실시간 경기">⚽ 실시간경기</Button>
            {autoRefreshEnabled && (
              <Button onClick={stopAutoRefresh} className="px-3 py-1 app-no-drag" style={{ border: '2px solid #dc2626', background: '#dc2626', color: '#ffffff' }} title="자동 갱신 중지">
                <span className="flex items-center gap-1">
                  🔄 갱신중지
                </span>
              </Button>
            )}
            {/* Placeholder SAVE/LOAD buttons (UI only) */}
            <Button onClick={handleSaveJSON} className="px-3 py-1 app-no-drag" style={{ border: '2px solid #e6e6e6', background: '#ffffff', color: '#111' }}>SAVE</Button>
            <Button onClick={handleLoadJSON} className="px-3 py-1 app-no-drag" style={{ border: '2px solid #e6e6e6', background: '#ffffff', color: '#111' }}>LOAD</Button>
        </div>
      </div>

      <div className="flex gap-6 h-[700px] max-h-[90vh]" style={{ height: 700, marginTop: 100 }}>
        {/* Banner */}
  <div style={{ position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)', width: 900, height: 100, zIndex: 9999 }}>
          <div style={{ width: '100%', height: '100%', background: 'transparent', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', width: '900px', height: '100px', borderRadius: 10, overflow: 'hidden', pointerEvents: 'none', zIndex: '0 !important' as any }}>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(255,255,255,0.3), rgba(5,5,40,0.6))', backdropFilter: 'blur(6px) saturate(120%)', WebkitBackdropFilter: 'blur(3px) saturate(120%)', border: '0.5px solid rgba(0,0,0,0.6)' }} />
              <svg width="100%" height="100%" viewBox="0 0 100 12" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, opacity: 0.06 }}>
                <defs>
                  <pattern id="p" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(25)">
                    <rect width="3" height="6" fill="white" opacity="0.04" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#p)" />
              </svg>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', width: '100%', height: '100%', position: 'relative', zIndex: '1 !important' as any }}>
              {/* Left: Team A */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 18 }}>
                <div style={{ width: 72, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {teamLogoA ? (
                    <img src={teamLogoA.logos.png ?? teamLogoA.logos.svg} alt={teamLogoA.englishName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  ) : (
                    <div style={{ width: 56, height: 56, borderRadius: 8, background: '#ffffff22' }} />
                  )}
                </div>
                <div style={{ color: '#fff', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 'clamp(14px, 1.6vw, 20px)' }}>{teamNameA || 'Team A'}</div>
                </div>
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
                <div style={{ color: '#fff', display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: 'clamp(14px, 1.6vw, 20px)' }}>{teamNameB || 'Team B'}</div>
                </div>
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
                      <PlayerCard 
                      number={player.number} 
                      name={player.name} 
                      color={uniformColor} 
                      onClick={() => handlePlayerClick(index)} 
                      size={56} 
                      yellowCard={player.yellowCard} 
                      redCard={player.redCard} 
                      goals={player.goals} // 👈 이 코드를 추가하세요!
                    />
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
                      <PlayerCard 
                        number={player.number} 
                        name={player.name} 
                        color={uniformColorB} 
                        onClick={() => handlePlayerClickB(index)} 
                        size={56} 
                        yellowCard={player.yellowCard} 
                        redCard={player.redCard} 
                        goals={player.goals} // 👈 이 코드를 추가하세요!
                      />
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
                        <PlayerCard 
                          number={player.number} 
                          name={player.name} 
                          color={uniformColor} 
                          onClick={() => handlePlayerClick(index)} 
                          size={56} 
                          yellowCard={player.yellowCard} 
                          redCard={player.redCard} 
                          goals={player.goals} // 👈 이 줄을 "반드시" 추가하세요!
                        />
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
                        <PlayerCard 
                          number={player.number} 
                          name={player.name} 
                          color={uniformColorB} 
                          onClick={() => handlePlayerClickB(index)} 
                          size={56} 
                          yellowCard={player.yellowCard} 
                          redCard={player.redCard} 
                          goals={player.goals} // 👈 이 줄을 "반드시" 추가하세요!
                        />
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
            <div className="space-y-2">
              <Label>카드 상태</Label>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingPlayer({ ...editingPlayer, yellowCard: !editingPlayer.yellowCard, redCard: editingPlayer.yellowCard ? false : editingPlayer.redCard })}
                  className={`flex-1 h-12 font-semibold transition-all duration-200 ${
                    editingPlayer.yellowCard 
                      ? 'bg-yellow-400 hover:bg-yellow-500 text-black border-yellow-600 shadow-lg scale-105' 
                      : 'bg-white hover:bg-yellow-50 text-gray-700 border-yellow-300 hover:border-yellow-400'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded ${editingPlayer.yellowCard ? 'bg-yellow-600' : 'bg-yellow-200'}`}></span>
                    옐로우 카드
                    {editingPlayer.yellowCard && <span className="text-xs">✓</span>}
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingPlayer({ ...editingPlayer, redCard: !editingPlayer.redCard, yellowCard: editingPlayer.redCard ? false : editingPlayer.yellowCard })}
                  className={`flex-1 h-12 font-semibold transition-all duration-200 ${
                    editingPlayer.redCard 
                      ? 'bg-red-500 hover:bg-red-600 text-black border-red-700 shadow-lg scale-105' 
                      : 'bg-white hover:bg-red-50 text-black hover:text-black border-red-300 hover:border-red-400'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded ${editingPlayer.redCard ? 'bg-red-700' : 'bg-red-200'}`}></span>
                    레드 카드
                    {editingPlayer.redCard && <span className="text-xs">✓</span>}
                  </span>
                </Button>
              </div>
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
            <div className="space-y-2">
              <Label>카드 상태</Label>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingPlayerB({ ...editingPlayerB, yellowCard: !editingPlayerB.yellowCard, redCard: editingPlayerB.yellowCard ? false : editingPlayerB.redCard })}
                  className={`flex-1 h-12 font-semibold transition-all duration-200 ${
                    editingPlayerB.yellowCard 
                      ? 'bg-yellow-400 hover:bg-yellow-500 text-black border-yellow-600 shadow-lg scale-105' 
                      : 'bg-white hover:bg-yellow-50 text-gray-700 border-yellow-300 hover:border-yellow-400'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded ${editingPlayerB.yellowCard ? 'bg-yellow-600' : 'bg-yellow-200'}`}></span>
                    옐로우 카드
                    {editingPlayerB.yellowCard && <span className="text-xs">✓</span>}
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingPlayerB({ ...editingPlayerB, redCard: !editingPlayerB.redCard, yellowCard: editingPlayerB.redCard ? false : editingPlayerB.yellowCard })}
                  className={`flex-1 h-12 font-semibold transition-all duration-200 ${
                    editingPlayerB.redCard 
                      ? 'bg-red-500 hover:bg-red-600 text-black border-red-700 shadow-lg scale-105' 
                      : 'bg-white hover:bg-red-50 text-black hover:text-black border-red-300 hover:border-red-400'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded ${editingPlayerB.redCard ? 'bg-red-700' : 'bg-red-200'}`}></span>
                    레드 카드
                    {editingPlayerB.redCard && <span className="text-xs">✓</span>}
                  </span>
                </Button>
              </div>
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

      {/* Live Matches Dialog */}
      <Dialog open={showLiveMatches} onOpenChange={(open: boolean) => !open && setShowLiveMatches(false)}>
        <DialogContent className="max-h-[80vh] overflow-auto" style={{ width: '600px', maxWidth: '95vw', zIndex: 100 }}>
          <DialogHeader>
            <DialogTitle>⚽ 실시간 경기 불러오기 (API-Football)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="API-Football API 키 입력"
              />
              <p className="text-sm text-gray-500">
                API-Football (api-sports.io)에서 발급받은 API 키를 입력하세요.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="udp-port">UDP 전송 포트</Label>
              <div className="flex gap-2">
                <Input
                  id="udp-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={udpPortInput}
                  onChange={(e) => setUdpPortInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void applyUdpPort();
                    }
                  }}
                  placeholder="9107"
                />
                <Button type="button" variant="outline" onClick={() => void applyUdpPort()}>
                  적용
                </Button>
              </div>
              <p className="text-sm text-gray-500">
                기본 포트는 9107이며, 적용 후부터 해당 포트로 소켓 데이터를 전송합니다.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={loadLiveMatches}
                disabled={isLoadingMatches || !apiKey.trim()}
                className="flex-1"
                style={{ background: '#16a34a', color: '#ffffff' }}
              >
                {isLoadingMatches ? '로딩중...' : '🔄 실시간 경기 불러오기'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowLiveMatches(false)}
              >
                취소
              </Button>
            </div>

            {liveMatches.length > 0 && (
        <div className="space-y-2">
          <Label>경기 선택</Label>
          
          {/* 탭 헤더 추가 */}
          <div className="flex border-b border-gray-200 mb-4 bg-gray-50 rounded-t-lg">
            {(['LIVE', 'UPCOMING', 'FINISHED'] as const).map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-2.5 text-sm font-black rounded-md transition-all duration-200 ${
                    isActive 
                      ? 'bg-green-600 text-blue-50 shadow-md transform scale-[1.02]' 
                      : 'text-gray-500 hover:bg-gray-200 hover:text-gray-700'
                  }`}
                >
                  <span className="flex items-center justify-center gap-1">
                    {tab === 'LIVE' && <span className={isActive ? 'animate-pulse' : ''}>🔴</span>}
                    {tab === 'UPCOMING' && '⏳'}
                    {tab === 'FINISHED' && '🏁'}
                    {tab === 'LIVE' ? '경기중' : tab === 'UPCOMING' ? '준비중' : '경기종료'}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="overflow-y-auto space-y-1 border rounded p-2" style={{ maxHeight: '380px' }}>
            {liveMatches
              .filter((match: any) => {
                const status = match.fixture.status.short;
                // 🔴 경기중 탭: 현재 진행 중인 상태들
                if (activeTab === 'LIVE') {
                  return ["1H", "HT", "2H", "ET", "P", "BT"].indexOf(status) !== -1;
                }
                
                // ⏳ 준비중 탭: 시작 전(Not Started)
                if (activeTab === 'UPCOMING') {
                  return status === "NS";
                }
                
                // 🏁 경기종료 탭: 오늘 이미 끝난 경기(Full Time)
                if (activeTab === 'FINISHED') {
                  return status === "FT" || status === "AET" || status === "PEN";
                }
                
                return false;
              })
              .map((match: any) => (
<button
  key={match.fixture.id}
  onClick={() => loadMatchLineup(match.fixture.id, match.teams.home, match.teams.away, match.goals)}
  className="w-full mb-3 p-4 border rounded-xl bg-white shadow-sm hover:bg-gray-50 transition-all overflow-hidden"
  style={{ display: 'block' }} // 버튼의 기본 flex 동작 방지
>
  {/* 상단 리그 정보 */}
  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '11px', fontWeight: 'bold', color: '#9ca3af' }}>
    <span>{match.league.name}</span>
    <span>{new Date(match.fixture.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
  </div>

  {/* 메인 3단 정렬 섹션 */}
  <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
    
    {/* 1. 홈팀 (정확히 38% 차지) */}
    <div style={{ flex: '0 0 38%', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', minWidth: 0 }}>
      <span style={{ fontSize: '13px', fontWeight: '800', color: '#1f2937', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {match.teams.home.name}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <img src={match.teams.home.logo} alt="" style={{ width: '40px', height: '40px', objectFit: 'contain' }} />
        <span style={{ fontSize: '9px', fontWeight: '900', color: '#9ca3af', marginTop: '2px' }}>HOME</span>
      </div>
    </div>

    {/* 2. 중앙 축 (정확히 24% 차지) */}
    <div style={{ flex: '0 0 24%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: '16px', fontWeight: '900', color: '#111827', backgroundColor: '#f3f4f6', padding: '4px 10px', borderRadius: '6px', letterSpacing: '-0.05em' }}>
        {match.fixture.status.short === 'NS' ? 'VS' : `${match.goals.home}:${match.goals.away}`}
      </div>
      <div style={{ marginTop: '6px', fontSize: '9px', fontWeight: '900', color: 'white', backgroundColor: '#111827', padding: '2px 6px', borderRadius: '99px' }}>
        {match.fixture.status.short === 'FT' ? 'FIN' : (match.fixture.status.elapsed ? `${match.fixture.status.elapsed}'` : match.fixture.status.short)}
      </div>
    </div>

    {/* 3. 어웨이팀 (정확히 38% 차지) */}
    <div style={{ flex: '0 0 38%', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px', minWidth: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <img src={match.teams.away.logo} alt="" style={{ width: '40px', height: '40px', objectFit: 'contain' }} />
        <span style={{ fontSize: '9px', fontWeight: '900', color: '#9ca3af', marginTop: '2px' }}>AWAY</span>
      </div>
      <span style={{ fontSize: '13px', fontWeight: '800', color: '#1f2937', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {match.teams.away.name}
      </span>
    </div>

  </div>
</button>
              ))}
          </div>
        </div>
      )}

            {liveMatches.length === 0 && !isLoadingMatches && apiKey.trim() && (
              <div className="text-center py-8 text-gray-500 border rounded bg-gray-50">
                <div className="text-4xl mb-2">⚽</div>
                <div>현재 진행 중인 경기가 없습니다</div>
                <div className="text-sm mt-1">잠시 후 다시 시도해주세요</div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
