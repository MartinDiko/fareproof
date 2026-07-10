import { Check, ExternalLink, Plane, TriangleAlert } from 'lucide-react';
import type { FareEvidenceView } from './evidenceView';

function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amountMinor / 100);
}

function sourceLabel(source: string): string {
  if (source === 'ita-matrix') return 'ITA Matrix';
  if (source === 'manual-import') return 'Manual import';
  return source;
}

function EvidenceDetails({ evidence }: { evidence: FareEvidenceView }) {
  const sourceUrl = evidence.bookingUrl ?? undefined;
  return <div className="evidence-details"><div className="evidence-route"><div><strong>{evidence.route}</strong><span>{evidence.travelDates} · {evidence.cabin}</span></div><span className={`evidence-stage ${evidence.stageTone}`}>{evidence.stageLabel}</span></div>{evidence.policyName && <p className="evidence-policy">{evidence.policyName}</p>}<dl className="evidence-grid"><div><dt>Per person</dt><dd>{formatMoney(evidence.perPersonMinor, evidence.currency)}</dd></div><div><dt>Total</dt><dd>{formatMoney(evidence.totalMinor, evidence.currency)} · {evidence.passengers} travelers</dd></div><div><dt>Flights</dt><dd>{evidence.flights}</dd></div><div><dt>Fare</dt><dd>{evidence.fareIdentity}</dd></div><div><dt>Evidence</dt><dd>{sourceLabel(evidence.source)}</dd></div><div><dt>Checked</dt><dd>{new Date(evidence.observedAt).toLocaleString()}</dd></div></dl>{evidence.matchedRules.length > 0 && <div className="evidence-rules match"><strong><Check size={13} /> Confirmed</strong><span>{evidence.matchedRules.join(' · ')}</span></div>}{evidence.missingRules.length > 0 && <div className="evidence-rules missing"><strong><TriangleAlert size={13} /> Still needed</strong><span>{evidence.missingRules.join(' · ')}</span></div>}{sourceUrl ? <a className="booking-link" href={sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open booking site{evidence.retailer ? ` · ${evidence.retailer}` : ''}</a> : <p className="evidence-guidance">This fare is evidence only. FareProof will show a booking link after a retailer reproduces the route, date, flight, long-leg cabin, and price.</p>}</div>;
}

interface FareEvidencePanelProps {
  current: FareEvidenceView | null;
  latestValidated: FareEvidenceView | null;
}

export function FareEvidencePanel({ current, latestValidated }: FareEvidencePanelProps) {
  const showSeparateValidated = latestValidated && latestValidated.id !== current?.id;
  return <section className="live evidence-panel"><div className="section-title"><h2>Fare evidence</h2><span className={`health ${current ? 'good' : ''}`}>{current ? current.stageLabel : 'Waiting'}</span></div>{current ? <EvidenceDetails evidence={current} /> : <div className="evidence-empty"><Plane size={18} /><p>Open ITA Matrix, import copied JSON, or let a scheduled check run.</p></div>}{showSeparateValidated && <div className="previous-validated"><h3>Latest validated booking</h3><EvidenceDetails evidence={latestValidated} /></div>}</section>;
}