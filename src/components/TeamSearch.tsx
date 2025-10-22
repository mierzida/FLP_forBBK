import React, { useEffect, useRef, useState } from 'react';

export type TeamEntry = {
  id: string;
  slug: string;
  country: string;
  englishName: string;
  logos: { svg: string | null; png: string | null };
};

export interface TeamSearchProps {
  value: string;
  onChangeText: (v: string) => void;
  onSelect: (team: TeamEntry) => void;
  target?: string;
}

export default function TeamSearch({ value, onChangeText, onSelect, target }: TeamSearchProps) {
  const [index, setIndex] = useState<TeamEntry[] | null>(null);
  const [query, setQuery] = useState(value || '');
  const [results, setResults] = useState<TeamEntry[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<TeamEntry | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const popupRef = useRef<Window | null>(null);

  useEffect(() => setQuery(value || ''), [value]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const resp = await fetch('./data/team-index.json');
        const data = await resp.json();
        if (!mounted) return;
        setIndex(data);
      } catch (e) { console.warn('Failed to load team index', e); }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!index) return;
    const q = (query || '').trim().toLowerCase();
    if (!q) { setResults([]); return; }
    const found = index.filter(t => t.slug.includes(q) || t.englishName.toLowerCase().includes(q));
    setResults(found.slice(0, 50));
  }, [query, index]);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      try {
        if (!ev.data || ev.data.type !== 'team-selected') return;
        const team = ev.data.team as TeamEntry | undefined;
        const msgTarget = ev.data.target as string | undefined;
        if (!team) return;
        if (target && msgTarget && msgTarget !== target) return;
        setSelectedTeam(team); setCollapsed(true); onSelect(team);
      } catch (e) { console.warn(e); }
    }

    // Use only postMessage from popup to communicate selection. Ignore storage events to avoid localStorage usage.
    window.addEventListener('message', onMsg as any);
    return () => { window.removeEventListener('message', onMsg as any); };
  }, [onSelect, target]);

  const openBrowse = () => {
    const url = './browse.html' + (target ? `?target=${encodeURIComponent(target)}` : '');
    popupRef.current = window.open(url, 'logo-browser', 'width=760,height=680');
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <input value={query} onChange={(e) => { setQuery(e.target.value); onChangeText?.(e.target.value); if (selectedTeam) { setSelectedTeam(null); setCollapsed(false); } }} placeholder="Search (English)" className="w-full bg-slate-700 text-white px-2 py-2 rounded" />
        <button className="ml-2 px-3 py-2 bg-slate-600 text-white rounded" onClick={openBrowse}>Browse</button>
      </div>

      <div className="mt-2 max-h-56 overflow-auto">
        {selectedTeam && collapsed ? (
          <div className="p-1 bg-slate-700/60 rounded">
            <div className="flex items-center gap-2">
              <div style={{ width: 36, height: 36 }} className="flex items-center justify-center">
                {selectedTeam.logos.png ? <img src={selectedTeam.logos.png} alt={selectedTeam.englishName} style={{ maxWidth: '100%', maxHeight: '100%' }} /> : selectedTeam.logos.svg ? <img src={selectedTeam.logos.svg} alt={selectedTeam.englishName} style={{ maxWidth: '100%', maxHeight: '100%' }} /> : <div className="w-8 h-8 bg-slate-600" />}
              </div>
              <div className="text-white">
                <div className="font-medium">{selectedTeam.englishName}</div>
                <div className="text-xs text-slate-400">{selectedTeam.country}</div>
              </div>
              <div className="ml-auto flex gap-2">
                <button className="text-sm" onClick={() => setCollapsed(false)}>Show all</button>
                <button className="text-sm text-red-400" onClick={() => { setSelectedTeam(null); setCollapsed(false); }}>Clear</button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {results.length === 0 && query && <div className="text-sm text-slate-300">No results — try Browse</div>}
            {results.map(r => (
              <div key={r.id} className="flex items-center gap-2 p-1 hover:bg-slate-700/60 rounded cursor-pointer" onClick={() => { setSelectedTeam(r); setCollapsed(true); onSelect(r); }}>
                <div style={{ width: 36, height: 36 }} className="flex items-center justify-center">
                  {r.logos.png ? <img src={r.logos.png} alt={r.englishName} style={{ maxWidth: '100%', maxHeight: '100%' }} /> : r.logos.svg ? <img src={r.logos.svg} alt={r.englishName} style={{ maxWidth: '100%', maxHeight: '100%' }} /> : <div className="w-8 h-8 bg-slate-600" />}
                </div>
                <div className="text-white text-sm">
                  <div className="font-medium">{r.englishName}</div>
                  <div className="text-xs text-slate-400">{r.country}</div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

