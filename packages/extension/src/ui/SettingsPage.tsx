import { useEffect, useState } from 'react';
import { Bell, Check, Globe, Plane, Plus, RotateCcw, Search, Settings, Smartphone } from 'lucide-react';
import { defaultFareSearchPolicies, fareSearchPolicySchema, type FareSearchPolicy } from '@fareproof/core';
import { apiSearchSettingsSchema, notificationSettingsSchema, STORAGE_KEYS, type ApiSearchSettings, type NotificationSettings } from '../shared/state';

const defaultNotifications: NotificationSettings = { browserEnabled: true };
const defaultApiSearch: ApiSearchSettings = { provider: 'travelpayouts', enabled: false };
const TRAVELPAYOUTS_ORIGIN = 'https://api.travelpayouts.com/*';

function copyDefaults(): FareSearchPolicy[] {
  return defaultFareSearchPolicies.map((policy) => fareSearchPolicySchema.parse(structuredClone(policy)));
}

function codes(value: string): string[] {
  return value.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean);
}

export function SettingsPage() {
  const [policies, setPolicies] = useState<FareSearchPolicy[]>(copyDefaults);
  const [notifications, setNotifications] = useState<NotificationSettings>(defaultNotifications);
  const [apiSearch, setApiSearch] = useState<ApiSearchSettings>(defaultApiSearch);
  const [apiMessage, setApiMessage] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void chrome.storage.local.get([STORAGE_KEYS.policies, STORAGE_KEYS.notificationSettings, STORAGE_KEYS.apiSearchSettings]).then((result) => {
      const parsedPolicies = fareSearchPolicySchema.array().safeParse(result[STORAGE_KEYS.policies]);
      const parsedNotifications = notificationSettingsSchema.safeParse(result[STORAGE_KEYS.notificationSettings]);
      const parsedApiSearch = apiSearchSettingsSchema.safeParse(result[STORAGE_KEYS.apiSearchSettings]);
      if (parsedPolicies.success) setPolicies(parsedPolicies.data);
      if (parsedNotifications.success) setNotifications(parsedNotifications.data);
      if (parsedApiSearch.success) setApiSearch(parsedApiSearch.data);
    });
  }, []);

  const update = (index: number, updater: (policy: FareSearchPolicy) => FareSearchPolicy) => setPolicies((current) => current.map((policy, policyIndex) => policyIndex === index ? updater(policy) : policy));

  const save = async () => {
    setError('');
    setMessage('');
    const parsed = fareSearchPolicySchema.array().safeParse(policies);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Search policies are invalid.');
      return;
    }
    if (notifications.ntfyTopic) {
      const granted = await chrome.permissions.request({ origins: ['https://ntfy.sh/*'] });
      if (!granted) {
        setError('Mobile push permission was not granted. Clear the topic to keep browser-only notifications.');
        return;
      }
    }
    if (apiSearch.enabled && apiSearch.token) {
      const granted = await chrome.permissions.request({ origins: [TRAVELPAYOUTS_ORIGIN] });
      if (!granted) {
        setError('Travelpayouts API access was not granted. Disable the API search or grant access to use it.');
        return;
      }
    }
    await chrome.runtime.sendMessage({ type: 'SAVE_SEARCH_POLICIES', policies: parsed.data });
    await chrome.runtime.sendMessage({ type: 'SAVE_NOTIFICATION_SETTINGS', browserEnabled: notifications.browserEnabled, ntfyTopic: notifications.ntfyTopic });
    await chrome.runtime.sendMessage({ type: 'SAVE_API_SEARCH_SETTINGS', enabled: apiSearch.enabled, token: apiSearch.token, market: apiSearch.market });
    setMessage('Settings saved. The next scheduler cycle uses these policies.');
  };

  const generateTopic = () => setNotifications((current) => ({ ...current, ntfyTopic: `fareproof-${crypto.randomUUID().replaceAll('-', '')}` }));

  const runApiSearchNow = async () => {
    setApiMessage('');
    if (!apiSearch.token) return;
    const granted = await chrome.permissions.request({ origins: [TRAVELPAYOUTS_ORIGIN] });
    if (!granted) {
      setApiMessage('Access to the Travelpayouts API was not granted.');
      return;
    }
    await chrome.runtime.sendMessage({ type: 'SAVE_API_SEARCH_SETTINGS', enabled: apiSearch.enabled, token: apiSearch.token, market: apiSearch.market });
    const result = await chrome.runtime.sendMessage({ type: 'RUN_API_SEARCH' }) as { ok?: boolean; count?: number; reason?: string } | undefined;
    setApiMessage(result?.ok ? `Found ${result.count ?? 0} indicative candidate${result.count === 1 ? '' : 's'}. Open the side panel to review or export them.` : result?.reason ?? 'API search did not return candidates.');
  };

  return <main className="options"><header className="brand"><div className="brand-mark"><Settings size={20} /></div><div><h1>FareProof settings</h1><p>Search policies, adapters, and notifications</p></div></header><section><div className="section-title"><h2>Fare searches</h2><button className="secondary inline" onClick={() => setPolicies(copyDefaults())}><RotateCcw size={15} /> Restore requested defaults</button></div><p className="settings-copy">Changes apply to the next five-minute cycle. Matrix flexible-date searches are rotated across the configured date range to avoid opening dozens of tabs at once.</p><div className="editor-list">{policies.map((policy, index) => <article className="policy-editor" key={policy.id}><div className="policy-editor-title"><label className="toggle"><input type="checkbox" checked={policy.enabled} onChange={(event) => update(index, (item) => ({ ...item, enabled: event.target.checked }))} /><span /></label><input className="name-input" aria-label={`Name for ${policy.name}`} value={policy.name} onChange={(event) => update(index, (item) => ({ ...item, name: event.target.value }))} /></div><div className="form-grid"><label>Trip type<select value={policy.tripType} onChange={(event) => update(index, (item) => ({ ...item, tripType: event.target.value as FareSearchPolicy['tripType'] }))}><option value="one-way">One way</option><option value="round-trip">Round trip</option><option value="return-only">Return one way</option></select></label><label>Origins<input value={policy.origins.join(', ')} onChange={(event) => update(index, (item) => ({ ...item, origins: codes(event.target.value) }))} /></label><label>Destinations<input value={policy.destinations.join(', ')} onChange={(event) => update(index, (item) => ({ ...item, destinations: codes(event.target.value) }))} /></label><label>Earliest departure<input type="date" value={policy.departureDateRange.earliest} onChange={(event) => update(index, (item) => ({ ...item, departureDateRange: { ...item.departureDateRange, earliest: event.target.value } }))} /></label><label>Latest departure<input type="date" value={policy.departureDateRange.latest} onChange={(event) => update(index, (item) => ({ ...item, departureDateRange: { ...item.departureDateRange, latest: event.target.value } }))} /></label><label>Adults<input type="number" min="1" max="9" value={policy.passengers.adults} onChange={(event) => update(index, (item) => ({ ...item, passengers: { adults: Number(event.target.value) } }))} /></label><label>Max CAD per person<input type="number" min="1" value={policy.maximumPricePerPersonMinor / 100} onChange={(event) => update(index, (item) => ({ ...item, maximumPricePerPersonMinor: Math.round(Number(event.target.value) * 100) }))} /></label><label>Maximum stops per direction<input type="number" min="0" max="2" value={policy.routing.maximumStops ?? ''} onChange={(event) => update(index, (item) => ({ ...item, routing: { ...item.routing, maximumStops: event.target.value === '' ? undefined : Number(event.target.value) } }))} /></label><label>Long leg starts at hours<input type="number" min="1" step="0.5" value={policy.cabin.longLegMinimumMinutes / 60} onChange={(event) => update(index, (item) => ({ ...item, cabin: { ...item.cabin, longLegMinimumMinutes: Math.round(Number(event.target.value) * 60) } }))} /></label><label>Check interval minutes<input type="number" min="5" value={policy.schedule.intervalMinutes} onChange={(event) => update(index, (item) => ({ ...item, schedule: { ...item.schedule, intervalMinutes: Number(event.target.value) } }))} /></label>{policy.returnWindow && <><label>Minimum return days<input type="number" min="1" value={policy.returnWindow.minimumDaysAfterDeparture} onChange={(event) => update(index, (item) => ({ ...item, returnWindow: { ...item.returnWindow!, minimumDaysAfterDeparture: Number(event.target.value) } }))} /></label><label>Maximum return days<input type="number" min="1" value={policy.returnWindow.maximumDaysAfterDeparture} onChange={(event) => update(index, (item) => ({ ...item, returnWindow: { ...item.returnWindow!, maximumDaysAfterDeparture: Number(event.target.value) } }))} /></label></>}</div><label className="check-line"><input type="checkbox" checked={policy.routing.allowedConnectionCountries?.includes('CA') ?? false} onChange={(event) => update(index, (item) => ({ ...item, routing: { ...item.routing, allowedConnectionCountries: event.target.checked ? ['CA'] : undefined } }))} /> Connections must be in Canada</label></article>)}</div></section><section><div className="section-title"><h2>Notifications</h2><Bell size={17} /></div><label className="check-line"><input type="checkbox" checked={notifications.browserEnabled} onChange={(event) => setNotifications((current) => ({ ...current, browserEnabled: event.target.checked }))} /> Browser notifications</label><div className="mobile-row"><Smartphone size={19} /><div><strong>Optional mobile push with ntfy</strong><p>Install the ntfy app and subscribe to this private topic. Fare route, price, and match URL are sent to ntfy only when configured.</p></div></div><div className="topic-row"><input aria-label="ntfy topic" placeholder="No mobile topic configured" value={notifications.ntfyTopic ?? ''} onChange={(event) => setNotifications((current) => ({ ...current, ntfyTopic: event.target.value || undefined }))} /><button className="secondary inline" onClick={generateTopic}><Plus size={15} /> Generate private topic</button></div><button className="secondary inline" onClick={() => void chrome.runtime.sendMessage({ type: 'TEST_NOTIFICATION' })}><Bell size={15} /> Send test notification</button></section><section><div className="section-title"><h2>Flight price API (optional)</h2><Globe size={17} /></div><div className="mobile-row"><Globe size={19} /><div><strong>Travelpayouts indicative fares</strong><p>Optional discovery source. Uses your own Travelpayouts (Aviasales) affiliate token to fetch indicative cached one-way prices for your enabled searches. Route, dates, and currency are sent to api.travelpayouts.com only when enabled. Results are candidates for review and export; they still require retailer validation before booking.</p></div></div><label className="check-line"><input type="checkbox" checked={apiSearch.enabled} onChange={(event) => setApiSearch((current) => ({ ...current, enabled: event.target.checked }))} /> Enable Travelpayouts discovery</label><div className="topic-row"><input aria-label="Travelpayouts API token" placeholder="Travelpayouts API token" value={apiSearch.token ?? ''} onChange={(event) => setApiSearch((current) => ({ ...current, token: event.target.value || undefined }))} /><button className="secondary inline" disabled={!apiSearch.enabled || !apiSearch.token} onClick={() => void runApiSearchNow()}><Search size={15} /> Search now</button></div>{apiMessage && <p className="settings-copy">{apiMessage}</p>}</section><section><h2>Adapter status</h2><div className="adapter-row"><span>ITA Matrix flexible calendar, flights, and copied JSON</span><span className="health good"><Check size={13} /> Fixture-backed</span></div><div className="adapter-row"><span>BookWithMatrix handoff and retailer links</span><span className="health good"><Check size={13} /> Fixture-backed</span></div><div className="adapter-row"><span>Known retailer visible evidence</span><span className="health good"><Check size={13} /> Conservative generic adapter</span></div><div className="adapter-row"><span>Travelpayouts indicative fare discovery (optional)</span><span className="health good"><Check size={13} /> Fixture-backed</span></div><p className="settings-copy">Retailer pages that hide route, flight, cabin, or original-currency price are classified as manual verification, not a validated match.</p></section><section><h2>Privacy and limits</h2><p className="settings-copy">FareProof runs in Chrome and has no FareProof server. Scheduled checks require Chrome to be running. It does not sign in, solve CAPTCHA, submit passenger or payment details, or purchase. Matrix or retailer throttling is reported instead of bypassed.</p></section>{error && <p className="error" role="alert">{error}</p>}{message && <p className="success-message"><Check size={15} /> {message}</p>}<button className="primary save-settings" onClick={() => void save()}><Plane size={16} /> Save settings</button></main>;
}