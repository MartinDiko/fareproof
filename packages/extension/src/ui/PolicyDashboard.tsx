import { useEffect, useState } from 'react';
import { Clock3, CloudOff, Play, Route, Settings2 } from 'lucide-react';
import { fareSearchPolicySchema, type FareSearchPolicy } from '@fareproof/core';
import {
  activeVerificationRunSchema,
  policyStatusSchema,
  STORAGE_KEYS,
  type ActiveVerificationRun,
  type PolicyStatus,
} from '../shared/state';

function policyRoute(policy: FareSearchPolicy): string {
  return `${policy.origins.join('/')} → ${policy.destinations.join('/')}`;
}

function statusLabel(status?: PolicyStatus): string {
  if (status?.state === 'blocked') return 'Matrix unavailable';
  return status?.state.replaceAll('-', ' ') ?? 'scheduled';
}

function statusTone(status?: PolicyStatus): string {
  if (status?.state === 'retailer-match') return 'success';
  if (status?.state === 'blocked' || status?.state === 'manual-action-required') return 'warning';
  if (status?.state === 'error') return 'danger';
  if (status?.state === 'running' || status?.state === 'candidate-found') return 'active';
  return '';
}

function retryLabel(status?: PolicyStatus): string {
  if (!status?.nextDueAt) return 'Retry scheduled automatically.';
  return `Next retry ${new Date(status.nextDueAt).toLocaleString()}.`;
}

export function PolicyDashboard() {
  const [policies, setPolicies] = useState<FareSearchPolicy[]>([]);
  const [statuses, setStatuses] = useState<PolicyStatus[]>([]);
  const [run, setRun] = useState<ActiveVerificationRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  useEffect(() => {
    const load = () =>
      chrome.storage.local
        .get([STORAGE_KEYS.policies, STORAGE_KEYS.statuses, STORAGE_KEYS.activeRun])
        .then((result) => {
          const parsedPolicies = fareSearchPolicySchema
            .array()
            .safeParse(result[STORAGE_KEYS.policies]);
          const parsedStatuses = policyStatusSchema
            .array()
            .safeParse(result[STORAGE_KEYS.statuses]);
          const parsedRun = activeVerificationRunSchema.safeParse(result[STORAGE_KEYS.activeRun]);
          setPolicies(parsedPolicies.success ? parsedPolicies.data : []);
          setStatuses(parsedStatuses.success ? parsedStatuses.data : []);
          setRun(parsedRun.success ? parsedRun.data : null);
          setStarting(false);
        });
    void chrome.runtime
      .sendMessage({ type: 'RECOVER_SCHEDULER' })
      .catch(() => undefined)
      .then(load);
    const onChange = () => void load();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const runNow = async (policyIds?: string[]) => {
    setStartError('');
    setStarting(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'RUN_POLICIES_NOW', policyIds });
      if (!response?.ok) {
        setStartError(response?.reason ?? 'FareProof could not start this verification.');
        setStarting(false);
      }
    } catch (error) {
      setStartError(
        error instanceof Error
          ? error.message
          : 'FareProof could not contact its scheduler. Reload the extension and try again.',
      );
      setStarting(false);
    }
  };

  const enabledCount = policies.filter((policy) => policy.enabled).length;
  const matchCount = statuses.filter((status) => status.state === 'retailer-match').length;
  const unavailableStatuses = statuses.filter((status) => status.state === 'blocked');
  const matrixUnavailable = unavailableStatuses[0];

  return (
    <section>
      <div className="section-title">
        <h2>Scheduled searches</h2>
        <button
          className="icon-button"
          title="Edit search policies"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          <Settings2 size={16} />
        </button>
      </div>
      <div className="search-overview" aria-label="Search status overview">
        <div>
          <strong>{enabledCount}</strong>
          <span>Enabled</span>
        </div>
        <div>
          <strong>{matchCount}</strong>
          <span>Agency matches</span>
        </div>
        <div>
          <strong>{unavailableStatuses.length}</strong>
          <span>Matrix unavailable</span>
        </div>
      </div>
      {run && (
        <div className="run-banner">
          <Clock3 size={16} />
          <div>
            <strong>Verification running</strong>
            <span>
              {run.stage} · task {run.taskIndex + 1} of {run.tasks.length}
            </span>
          </div>
        </div>
      )}
      {matrixUnavailable && !run && (
        <div className="availability-banner">
          <CloudOff size={17} />
          <div>
            <strong>Matrix unavailable for the latest run</strong>
            <span>{matrixUnavailable.message}</span>
          </div>
        </div>
      )}
      {startError && (
        <p className="error" role="alert">
          {startError}
        </p>
      )}
      <div className="policy-list">
        {policies.map((policy) => {
          const status = statuses.find((item) => item.policyId === policy.id);
          return (
            <article className={`policy-card ${policy.enabled ? '' : 'disabled'}`} key={policy.id}>
              <div className="policy-head">
                <div>
                  <strong>{policy.name}</strong>
                  <span>
                    <Route size={13} /> {policyRoute(policy)}
                  </span>
                </div>
                <span className={`status ${statusTone(status)}`}>
                  {statusLabel(status)}
                </span>
              </div>
              <dl>
                <div>
                  <dt>Dates</dt>
                  <dd>
                    {policy.departureDateRange.earliest} to {policy.departureDateRange.latest}
                  </dd>
                </div>
                <div>
                  <dt>Limit</dt>
                  <dd>
                    {policy.currency} {(policy.maximumPricePerPersonMinor / 100).toFixed(0)} /
                    person · {policy.passengers.adults} adults
                  </dd>
                </div>
                <div>
                  <dt>Cabin</dt>
                  <dd>Business over {policy.cabin.longLegMinimumMinutes / 60}h</dd>
                </div>
                {status?.bestPricePerPersonMinor !== undefined && (
                  <div>
                    <dt>Best</dt>
                    <dd>
                      {policy.currency} {(status.bestPricePerPersonMinor / 100).toFixed(2)} / person
                    </dd>
                  </div>
                )}
              </dl>
              <p className="policy-message">
                {status?.state === 'blocked'
                  ? retryLabel(status)
                  : (status?.message ?? 'Waiting for scheduler initialization.')}
              </p>
              <button
                className="secondary compact"
                disabled={!policy.enabled || Boolean(run) || starting}
                onClick={() => void runNow([policy.id])}
              >
                <Play size={14} /> Check now
              </button>
            </article>
          );
        })}
      </div>
      <button
        className="primary"
        disabled={Boolean(run) || starting || !policies.some((policy) => policy.enabled)}
        onClick={() => void runNow()}
      >
        <Play size={16} /> {starting ? 'Starting…' : 'Check all enabled searches now'}
      </button>
      <p className="scheduler-note">
        Every five minutes FareProof checks one rotating date per Matrix calendar window for each
        enabled policy. Chrome must be running.
      </p>
    </section>
  );
}
