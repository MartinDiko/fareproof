import { useState } from 'react';
import { Download, FileJson, Gauge, Moon, Plane, Plus, Search, ShieldCheck, Sun, Trash2, Upload } from 'lucide-react';
import { createWatch, fareWatchSchema, parseFareProofExport, parseImportedFare, type FareProofExport, type FareWatch } from '@fareproof/core';
import { verifyAccessPassword } from './auth';
import { Login } from './Login';

const STORAGE_KEY = 'fareproof.web.watches';

function loadWatches(): FareWatch[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.flatMap((watch) => {
      const result = fareWatchSchema.safeParse(watch);
      return result.success ? [result.data as FareWatch] : [];
    }) : [];
  } catch {
    return [];
  }
}

function formatMoney(watch: FareWatch): string {
  const total = watch.criteria.target.fare.total;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: total.currency }).format(total.amountMinor / 100);
}

function WatchRow({ watch, onDelete }: { watch: FareWatch; onDelete: () => void }) {
  const target = watch.criteria.target;
  const segment = target.segments[0];
  return <tr><td><div className="route-cell"><strong>{segment?.origin.code} → {target.segments.at(-1)?.destination.code}</strong><span>{segment?.departureLocal.slice(0, 10)}</span></div></td><td><span className="cabin">{segment?.cabin?.replace('_', ' ') ?? 'Unknown'}</span></td><td><strong>{segment?.marketingCarrier.code} {segment?.marketingFlightNumber}</strong><span className="subline">Operated by {segment?.operatingCarrier?.code ?? 'unknown'} {segment?.operatingFlightNumber ?? ''}</span></td><td><strong>{segment?.bookingClass ?? 'Unknown'}</strong><span className="subline">{segment?.fareBasis ?? 'Fare basis unconfirmed'}</span></td><td className="price">{formatMoney(watch)}</td><td><span className="state">Pending</span></td><td><button className="icon-button" title="Delete watch" onClick={onDelete}><Trash2 size={16} /></button></td></tr>;
}

function FareDashboard() {
  const [watches, setWatches] = useState<FareWatch[]>(loadWatches);
  const [showImport, setShowImport] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark');

  const save = (next: FareWatch[]) => {
    setWatches(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const importJson = () => {
    try {
      setError('');
      let incoming: FareWatch[];
      try {
        incoming = parseFareProofExport(input).watches as FareWatch[];
      } catch {
        incoming = [createWatch(parseImportedFare(input))];
      }
      const byId = new Map([...watches, ...incoming].map((watch) => [watch.id, watch]));
      save([...byId.values()]);
      setInput('');
      setShowImport(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to import this JSON.');
    }
  };

  const exportAll = () => {
    const bundle: FareProofExport = { schemaVersion: 1, exportedAt: new Date().toISOString(), watches };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `fareproof-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
  };

  const visible = watches.filter((watch) => {
    const target = watch.criteria.target;
    const haystack = target.segments.map((segment) => `${segment.origin.code} ${segment.destination.code} ${segment.marketingCarrier.code} ${segment.marketingFlightNumber} ${segment.operatingCarrier?.code ?? ''}`).join(' ');
    return haystack.toLowerCase().includes(filter.toLowerCase());
  });

  return <div className="app-shell"><aside><div className="logo"><div className="logo-mark"><Plane size={21} /></div><div><strong>FareProof</strong><span>Fare verification</span></div></div><nav><button className="nav-active" title="Overview"><Gauge size={18} /> Overview</button><button title="Import evidence" onClick={() => setShowImport(true)}><FileJson size={18} /> Import evidence</button></nav><div className="privacy"><ShieldCheck size={18} /><div><strong>Local by design</strong><span>No fare data is sent to a FareProof server.</span></div></div></aside><main><header><div><h1>Fare watches</h1><p>Compare itinerary identity, fare identity, and verification depth.</p></div><div className="header-actions"><button className="icon-button" title={dark ? 'Use light theme' : 'Use dark theme'} onClick={toggleTheme}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button><button className="secondary" disabled={!watches.length} onClick={exportAll}><Download size={17} /> Export</button><button className="primary" onClick={() => setShowImport(true)}><Plus size={17} /> Add fare</button></div></header><section className="metrics" aria-label="Watch summary"><div><span>Active watches</span><strong>{watches.length}</strong></div><div><span>Pending verification</span><strong>{watches.filter((watch) => watch.state === 'pending-verification').length}</strong></div><div><span>Strong matches</span><strong>{watches.filter((watch) => watch.state === 'strong-match' || watch.state === 'exact-match').length}</strong></div><div><span>Deepest evidence</span><strong>{watches.length ? 'ITA captured' : 'None'}</strong></div></section><section className="workspace"><div className="toolbar"><div className="search"><Search size={17} /><input aria-label="Filter watches" placeholder="Filter route or flight" value={filter} onChange={(event) => setFilter(event.target.value)} /></div><span>{visible.length} shown</span></div>{visible.length ? <div className="table-wrap"><table><thead><tr><th>Journey</th><th>Cabin</th><th>Flight identity</th><th>Fare identity</th><th>Total</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map((watch) => <WatchRow key={watch.id} watch={watch} onDelete={() => save(watches.filter((item) => item.id !== watch.id))} />)}</tbody></table></div> : <div className="empty"><Plane size={30} /><h2>{watches.length ? 'No matching watches' : 'No fare watches'}</h2><p>{watches.length ? 'Change the filter to show other routes.' : 'Import Matrix copied JSON, a compact fare, or an extension export to begin.'}</p><button className="primary" onClick={() => setShowImport(true)}><Upload size={17} /> Import JSON</button></div>}</section></main>{showImport && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowImport(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title"><div className="modal-head"><div><h2 id="import-title">Import fare evidence</h2><p>Accepts a FareProof export, Matrix copied JSON, or compact fare JSON.</p></div><button className="icon-button" title="Close" onClick={() => setShowImport(false)}>×</button></div><textarea autoFocus aria-label="Fare JSON" value={input} onChange={(event) => setInput(event.target.value)} placeholder={'{\n  "route": "YVR-FRA",\n  "date": "2026-09-17",\n  "marketingCarrier": "WS"\n}'} />{error && <p className="error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary" onClick={() => setShowImport(false)}>Cancel</button><button className="primary" disabled={!input.trim()} onClick={importJson}><FileJson size={17} /> Validate and import</button></div></div></div>}</div>;
}

export function App() {
  const [unlocked, setUnlocked] = useState(false);

  if (!unlocked) {
    return <Login onUnlock={async (password) => {
      await verifyAccessPassword(password);
      setUnlocked(true);
    }} />;
  }

  return <FareDashboard />;
}