import { useEffect, useState } from 'react';
import { Bell, Download, ExternalLink, FileJson, Plane, Settings, ShieldCheck } from 'lucide-react';
import { fareSearchPolicySchema, parseImportedFare, type FareProofExport, type FareSearchPolicy, type FareWatch, type ObservedItinerary } from '@fareproof/core';
import { policyObservationSchema, STORAGE_KEYS, type PolicyObservation } from '../shared/state';
import { FareEvidencePanel } from './FareEvidencePanel';
import { PolicyDashboard } from './PolicyDashboard';
import { RunHistory } from './RunHistory';
import { SettingsPage } from './SettingsPage';
import { latestEvidence, latestValidatedEvidence } from './evidenceView';

const WATCHES_KEY = 'fareproof.watches';
const CURRENT_OBSERVATION_KEY = 'fareproof.currentObservation';

function money(itinerary: ObservedItinerary): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: itinerary.fare.total.currency }).format(itinerary.fare.total.amountMinor / 100);
}

function WatchCard({ watch }: { watch: FareWatch }) {
  const target = watch.criteria.target;
  const first = target.segments[0];
  const last = target.segments.at(-1);
  return <article className="watch-card"><div className="watch-head"><div><strong>{first?.origin.code} → {last?.destination.code}</strong><span>{first?.departureLocal.slice(0, 10)} · {first?.cabin?.replace('_', ' ')}</span></div><span className="status">Pending verification</span></div><dl><div><dt>ITA target</dt><dd>{money(target)}</dd></div><div><dt>Flights</dt><dd>{first?.marketingCarrier.code} {first?.marketingFlightNumber} / {first?.operatingCarrier?.code ?? 'Operator ?'} {first?.operatingFlightNumber ?? ''}</dd></div><div><dt>Fare</dt><dd>{first?.bookingClass ?? 'Class ?'} · {first?.fareBasis ?? 'Basis unconfirmed'}</dd></div></dl><button className="secondary" type="button" onClick={() => window.open(target.sourceUrl || 'https://matrix.itasoftware.com/', '_blank')}><ExternalLink size={16} /> Verify now</button></article>;
}

function SidePanel() {
  const [watches, setWatches] = useState<FareWatch[]>([]);
  const [current, setCurrent] = useState<ObservedItinerary | null>(null);
  const [observations, setObservations] = useState<PolicyObservation[]>([]);
  const [policies, setPolicies] = useState<FareSearchPolicy[]>([]);
  const [json, setJson] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => chrome.storage.local.get([WATCHES_KEY, CURRENT_OBSERVATION_KEY, STORAGE_KEYS.observations, STORAGE_KEYS.policies]).then((result) => {
      setWatches(Array.isArray(result[WATCHES_KEY]) ? result[WATCHES_KEY] as FareWatch[] : []);
      setCurrent(result[CURRENT_OBSERVATION_KEY] as ObservedItinerary | undefined ?? null);
      const parsedObservations = policyObservationSchema.array().safeParse(result[STORAGE_KEYS.observations]);
      const parsedPolicies = fareSearchPolicySchema.array().safeParse(result[STORAGE_KEYS.policies]);
      setObservations(parsedObservations.success ? parsedObservations.data : []);
      setPolicies(parsedPolicies.success ? parsedPolicies.data : []);
    });
    void load();
    const onChange = () => void load();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const importFare = async () => {
    try {
      setError('');
      const itinerary = parseImportedFare(json);
      await chrome.runtime.sendMessage({ type: 'CREATE_WATCH', itinerary });
      setJson('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to import fare.');
    }
  };

  const exportWatches = () => {
    const bundle: FareProofExport = { schemaVersion: 1, exportedAt: new Date().toISOString(), watches };
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `fareproof-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const currentEvidence = latestEvidence(current, observations, policies);
  const validatedEvidence = latestValidatedEvidence(observations, policies);

  return <main><header className="brand"><div className="brand-mark"><Plane size={20} /></div><div><h1>FareProof</h1><p>Local fare verification</p></div><button className="icon-button" title="Settings" onClick={() => chrome.runtime.openOptionsPage()}><Settings size={18} /></button></header><FareEvidencePanel current={currentEvidence} latestValidated={validatedEvidence} /><RunHistory /><PolicyDashboard /><section><div className="section-title"><h2>Captured watches</h2><div className="watch-actions"><span>{watches.length}</span><button className="icon-button" type="button" title="Export watches" disabled={!watches.length} onClick={exportWatches}><Download size={16} /></button></div></div><div className="watch-list">{watches.length ? watches.map((watch) => <WatchCard key={watch.id} watch={watch} />) : <div className="empty"><Bell size={22} /><strong>No captured watches</strong><span>Scheduled policies are listed above. Manual captures appear here.</span></div>}</div></section><section><div className="section-title"><h2>Manual JSON import</h2><FileJson size={17} /></div><textarea value={json} onChange={(event) => setJson(event.target.value)} placeholder="Paste FareProof, Matrix copied JSON, or compact fare JSON" aria-label="Fare JSON" />{error && <p className="error" role="alert">{error}</p>}<button className="primary" type="button" disabled={!json.trim()} onClick={() => void importFare()}><FileJson size={16} /> Parse and create watch</button></section><footer><ShieldCheck size={15} /> Browser-only by default. Mobile push is opt-in.</footer></main>;
}

function Popup() {
  const openPanel = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId !== undefined) await chrome.sidePanel.open({ windowId: tab.windowId });
  };
  return <main className="popup"><header className="brand"><div className="brand-mark"><Plane size={20} /></div><div><h1>FareProof</h1><p>Local fare verification</p></div></header><button className="primary" onClick={() => void openPanel()}>Open side panel</button><button className="secondary" onClick={() => chrome.runtime.openOptionsPage()}><Settings size={16} /> Settings</button></main>;
}

function Options() {
  return <SettingsPage />;
}

export function App({ view }: { view: string }) {
  if (view === 'popup') return <Popup />;
  if (view === 'options') return <Options />;
  return <SidePanel />;
}