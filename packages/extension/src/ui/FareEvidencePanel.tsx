import { Check, CircleX, ExternalLink, Plane, TriangleAlert } from 'lucide-react';
import type { FareEvidenceView } from './evidenceView';

function formatMoney(amountMinor: number, currency: string): string {
  const amount = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amountMinor / 100);
  if (currency === 'CAD') return `CA$${amount}`;
  if (currency === 'USD') return `US$${amount}`;
  return `${currency} ${amount}`;
}

function sourceLabel(source: string): string {
  if (source === 'ita-matrix') return 'ITA Matrix';
  if (source === 'manual-import') return 'Manual import';
  return source;
}

function ruleLabel(rule: string): string {
  return rule.replace(/^retailer /, 'agency ');
}

function differenceLabel(amountMinor: number, currency: string): string {
  if (amountMinor === 0) return 'same as Matrix';
  return `${formatMoney(Math.abs(amountMinor), currency)} ${amountMinor > 0 ? 'above' : 'below'} Matrix`;
}

function convertedPriceLabel(originalAmountMinor: number, originalCurrency: string, cadAmountMinor: number | undefined): string {
  const original = formatMoney(originalAmountMinor, originalCurrency);
  return originalCurrency === 'USD' && cadAmountMinor !== undefined ? `${original} → ${formatMoney(cadAmountMinor, 'CAD')}` : original;
}

function EvidenceDetails({ evidence }: { evidence: FareEvidenceView }) {
  const primaryPriceLabel = evidence.retailerPricePerPersonMinor === undefined ? 'Matrix / person' : `${evidence.retailer ?? 'Agency'} / person`;
  return <div className="evidence-details"><div className="evidence-route"><div><strong>{evidence.route}</strong><span>{evidence.travelDates} · {evidence.cabin}</span></div><span className={`evidence-stage ${evidence.stageTone}`}>{evidence.stageLabel}</span></div>{evidence.policyName && <p className="evidence-policy">{evidence.policyName}</p>}<dl className="evidence-grid"><div><dt>{primaryPriceLabel}</dt><dd>{formatMoney(evidence.perPersonMinor, evidence.currency)}</dd></div>{evidence.retailerOriginalPricePerPersonMinor !== undefined && evidence.retailerOriginalCurrency && evidence.retailerOriginalCurrency !== evidence.currency && <div><dt>Agency quoted</dt><dd>{convertedPriceLabel(evidence.retailerOriginalPricePerPersonMinor, evidence.retailerOriginalCurrency, evidence.retailerPricePerPersonMinor)} / person</dd></div>}{evidence.bookWithMatrixPricePerPersonMinor !== undefined && <div><dt>BookWithMatrix</dt><dd>{convertedPriceLabel(evidence.bookWithMatrixPricePerPersonMinor, evidence.bookWithMatrixCurrency ?? evidence.currency, evidence.bookWithMatrixCadPricePerPersonMinor)} / person</dd></div>}{evidence.retailerPricePerPersonMinor !== undefined && <div><dt>Matrix</dt><dd>{formatMoney(evidence.matrixPricePerPersonMinor, evidence.currency)} / person{evidence.priceDifferenceMinor !== undefined && <span className="price-difference"> · {differenceLabel(evidence.priceDifferenceMinor, evidence.currency)}</span>}</dd></div>}{evidence.usdToCadRate !== undefined && <div><dt>FX rate</dt><dd>1 USD = {evidence.usdToCadRate.toFixed(4)} CAD{evidence.exchangeRateDate ? ` · ${evidence.exchangeRateDate}` : ''}</dd></div>}<div><dt>{evidence.retailerPricePerPersonMinor === undefined ? 'Matrix total' : 'Agency total'}</dt><dd>{formatMoney(evidence.totalMinor, evidence.currency)} · {evidence.passengers} travelers</dd></div><div><dt>Flights</dt><dd>{evidence.flights}</dd></div><div><dt>Fare</dt><dd>{evidence.fareIdentity}</dd></div><div><dt>Evidence</dt><dd>{sourceLabel(evidence.source)}</dd></div><div><dt>Checked</dt><dd>{new Date(evidence.observedAt).toLocaleString()}</dd></div></dl>{evidence.matchedRules.length > 0 && <div className="evidence-rules match"><strong><Check size={13} /> {evidence.stageTone === 'success' ? 'Confirmed' : 'Observed'}</strong><span>{evidence.matchedRules.map(ruleLabel).join(' · ')}</span></div>}{evidence.failedRules.length > 0 && <div className="evidence-rules failed"><strong><CircleX size={13} /> Did not match</strong><span>{evidence.failedRules.map(ruleLabel).join(' · ')}</span></div>}{evidence.missingRules.length > 0 && <div className="evidence-rules missing"><strong><TriangleAlert size={13} /> Still needed</strong><span>{evidence.missingRules.map(ruleLabel).join(' · ')}</span></div>}<p className="evidence-guidance">{evidence.message ?? 'FareProof enables booking only after an agency page reproduces the route, date, flight, long-leg cabin, and current price.'}</p>{evidence.bookingUrl && <a className="booking-link" href={evidence.bookingUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open booking site · {evidence.retailer}</a>}{evidence.reviewUrl && <a className="review-link" href={evidence.reviewUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open agency result for manual review · {evidence.retailer}</a>}</div>;
}

interface FareEvidencePanelProps {
  current: FareEvidenceView | null;
  latestValidated: FareEvidenceView | null;
}

export function FareEvidencePanel({ current, latestValidated }: FareEvidencePanelProps) {
  const showSeparateValidated = latestValidated && latestValidated.id !== current?.id;
  return <section className="live evidence-panel"><div className="section-title"><h2>Fare evidence</h2>{!current && <span className="health">Waiting</span>}</div>{current ? <EvidenceDetails evidence={current} /> : <div className="evidence-empty"><Plane size={18} /><p>Open ITA Matrix, import copied JSON, or let a scheduled check run.</p></div>}{showSeparateValidated && <div className="previous-validated"><h3>Latest validated booking</h3><EvidenceDetails evidence={latestValidated} /></div>}</section>;
}