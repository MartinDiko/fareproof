import { useEffect, useState } from 'react';
import { Clock3, Play, Route, Settings2 } from 'lucide-react';
import { fareSearchPolicySchema, type FareSearchPolicy } from '@fareproof/core';
import { activeVerificationRunSchema, policyStatusSchema, STORAGE_KEYS, type ActiveVerificationRun, type PolicyStatus } from '../shared/state';

function policyRoute(policy: FareSearchPolicy): string {
  return `${policy.origins.join('/')} → ${policy.destinations.join('/')}`;
}

function statusLabel(status?: PolicyStatus): string {
  return status?.state.replaceAll('-', ' ') ?? 'scheduled';
}

export function PolicyDashboard() {
  const [policies, setPolicies] = useState<FareSearchPolicy[]>([]);
  const [statuses, setStatuses] = useState<PolicyStatus[]>([]);
  const [run, setRun] = useState<ActiveVerificationRun | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const load = () => chrome.storage.local.get([STORAGE_KEYS.policies, STORAGE_KEYS.statuses, STORAGE_KEYS.activeRun]).then((result) => {
      const parsedPolicies = fareSearchPolicySchema.array().safeParse(result[STORAGE_KEYS.policies]);
      const parsedStatuses = policyStatusSchema.array().safeParse(result[STORAGE_KEYS.statuses]);
      const parsedRun = activeVerificationRunSchema.safeParse(result[STORAGE_KEYS.activeRun]);
      setPolicies(parsedPolicies.success ? parsedPolicies.data : []);
      setStatuses(parsedStatuses.success ? parsedStatuses.data : []);
      setRun(parsedRun.success ? parsedRun.data : null);
      setStarting(false);
    });
    void load();
    const onChange = () => void load();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const runNow = async (policyIds?: string[]) => {
    setStarting(true);
    const response = await chrome.runtime.sendMessage({ type: 'RUN_POLICIES_NOW', policyIds });
    if (!response?.ok) setStarting(false);
  };

  return <section><div className="section-title"><h2>Scheduled searches</h2><button className="icon-button" title="Edit search policies" onClick={() => chrome.runtime.openOptionsPage()}><Settings2 size={16} /></button></div>{run && <div className="run-banner"><Clock3 size={16} /><div><strong>Verification running</strong><span>{run.stage} · task {run.taskIndex + 1} of {run.tasks.length}</span></div></div>}<div className="policy-list">{policies.map((policy) => { const status = statuses.find((item) => item.policyId === policy.id); return <article className={`policy-card ${policy.enabled ? '' : 'disabled'}`} key={policy.id}><div className="policy-head"><div><strong>{policy.name}</strong><span><Route size={13} /> {policyRoute(policy)}</span></div><span className={`status ${status?.state === 'retailer-match' ? 'success' : ''}`}>{statusLabel(status)}</span></div><dl><div><dt>Dates</dt><dd>{policy.departureDateRange.earliest} to {policy.departureDateRange.latest}</dd></div><div><dt>Limit</dt><dd>{policy.currency} {(policy.maximumPricePerPersonMinor / 100).toFixed(0)} / person · {policy.passengers.adults} adults</dd></div><div><dt>Cabin</dt><dd>Business over {policy.cabin.longLegMinimumMinutes / 60}h</dd></div>{status?.bestPricePerPersonMinor !== undefined && <div><dt>Best</dt><dd>{policy.currency} {(status.bestPricePerPersonMinor / 100).toFixed(2)} / person</dd></div>}</dl><p className="policy-message">{status?.message ?? 'Waiting for scheduler initialization.'}</p><button className="secondary compact" disabled={!policy.enabled || Boolean(run) || starting} onClick={() => void runNow([policy.id])}><Play size={14} /> Check now</button></article>; })}</div><button className="primary" disabled={Boolean(run) || starting || !policies.some((policy) => policy.enabled)} onClick={() => void runNow()}><Play size={16} /> {starting ? 'Starting…' : 'Check all enabled searches now'}</button><p className="scheduler-note">Every five minutes FareProof checks one rotating date per Matrix calendar window for each enabled policy. Chrome must be running.</p></section>;
}