import { useEffect, useState } from 'react';
import { CalendarClock, ExternalLink } from 'lucide-react';
import { runHistoryEntrySchema, STORAGE_KEYS, type RunHistoryEntry } from '../shared/state';

function formatMoney(amountMinor: number, currency: string): string {
  const amount = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amountMinor / 100);
  if (currency === 'CAD') return `CA$${amount}`;
  if (currency === 'USD') return `US$${amount}`;
  return `${currency} ${amount}`;
}

function formatDuration(run: RunHistoryEntry): string {
  if (!run.completedAt) return 'in progress';
  const durationSeconds = Math.max(0, Math.round((Date.parse(run.completedAt) - Date.parse(run.startedAt)) / 1_000));
  return durationSeconds < 60 ? `${durationSeconds}s` : `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`;
}

function outcomeLabel(outcome: RunHistoryEntry['outcome'] | RunHistoryEntry['results'][number]['outcome']): string {
  if (outcome === 'match') return 'Agency match';
  if (outcome === 'manual-review') return 'Manual review';
  if (outcome === 'matrix-unavailable') return 'Matrix unavailable';
  if (outcome === 'no-match') return 'No qualifying fare';
  return outcome.replaceAll('-', ' ');
}

function priceLabel(result: RunHistoryEntry['results'][number]): string | null {
  if (result.cadPricePerPersonMinor === undefined) return null;
  const cad = `${formatMoney(result.cadPricePerPersonMinor, 'CAD')} / person`;
  if (result.originalCurrency === 'USD' && result.originalPricePerPersonMinor !== undefined) {
    return `${formatMoney(result.originalPricePerPersonMinor, 'USD')} → ${cad}`;
  }
  return cad;
}

export function RunHistory() {
  const [history, setHistory] = useState<RunHistoryEntry[]>([]);

  useEffect(() => {
    const load = () => chrome.storage.local.get(STORAGE_KEYS.runHistory).then((result) => {
      const parsed = runHistoryEntrySchema.array().safeParse(result[STORAGE_KEYS.runHistory]);
      setHistory(parsed.success ? parsed.data : []);
    });
    void load();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[STORAGE_KEYS.runHistory]) void load();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  return <section className="run-history"><div className="section-title"><h2>Run history</h2><span className="history-count">{history.length}</span></div>{history.length ? <div className="history-list">{history.map((run) => <details className="history-run" key={run.id}><summary><div className="history-when"><strong>{new Date(run.startedAt).toLocaleString()}</strong><span>{run.trigger} · {formatDuration(run)} · {run.policyCount} {run.policyCount === 1 ? 'search' : 'searches'}</span></div><span className={`run-outcome ${run.outcome}`}>{outcomeLabel(run.outcome)}</span></summary><div className="history-body"><p>{run.summary}</p><div className="history-results">{run.results.map((result) => { const price = priceLabel(result); return <article key={result.policyId}><div className="history-result-head"><div><strong>{result.policyName}</strong><span>{result.route}</span></div><span className={`run-outcome ${result.outcome}`}>{outcomeLabel(result.outcome)}</span></div><p>{result.message}</p>{price && <p className="history-price">{result.agency ? `${result.agency} · ` : ''}{price}</p>}{result.usdToCadRate !== undefined && <p className="history-fx">1 USD = {result.usdToCadRate.toFixed(4)} CAD{result.exchangeRateDate ? ` · ${result.exchangeRateDate}` : ''}</p>}{result.bookingUrl && <a href={result.bookingUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open booking site</a>}</article>; })}</div></div></details>)}</div> : <div className="history-empty"><CalendarClock size={18} /><span>Completed checks will appear here. History begins with version 0.2.5.</span></div>}</section>;
}