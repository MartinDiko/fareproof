import type { ExtensionMessage } from '../../shared/messages';

type RetailerObservation = Extract<ExtensionMessage, { type: 'RETAILER_PAGE' }>['observation'];

const blockerPatterns: Array<[RetailerObservation['blocker'], RegExp]> = [
  ['captcha', /captcha|verify (?:that )?you are human|unusual traffic/i],
  ['login-required', /sign in to continue|log in to continue/i],
  ['unavailable', /sold out|no longer available|flight is unavailable|no flights found/i],
  ['price-changed', /price (?:has )?changed|fare (?:has )?changed|repriced/i],
];

export function extractRetailerPage(document: Document, url: string): RetailerObservation {
  const text = `${url}\n${document.title}\n${document.body?.innerText ?? ''}`.slice(0, 250_000);
  const airportCodes = [...new Set(text.match(/\b[A-Z]{3}\b/g) ?? [])].slice(0, 100);
  const flightMatches = [...text.matchAll(/\b([A-Z0-9]{2})\s?(\d{1,4})\b/g)].filter((match) => /[A-Z]/.test(match[1] ?? ''));
  const flightNumbers = [...new Set(flightMatches.map((match) => match[0].replace(/\s+/g, '')))].slice(0, 100);
  const evidenceByFlight = new Map<string, Set<string>>();
  for (const match of flightMatches) {
    if (match.index === undefined) continue;
    const flightNumber = match[0].replace(/\s+/g, '');
    const context = text.slice(Math.max(0, match.index - 180), match.index + match[0].length + 300);
    const cabins = context.match(/\b(?:premium economy|business class|first class|economy|business|first)\b/gi) ?? [];
    const evidence = evidenceByFlight.get(flightNumber) ?? new Set<string>();
    cabins.forEach((cabin) => evidence.add(cabin.toUpperCase()));
    evidenceByFlight.set(flightNumber, evidence);
  }
  const flightCabinEvidence = [...evidenceByFlight].map(([flightNumber, cabins]) => ({ flightNumber, cabins: [...cabins] }));
  const cabinWords = [...new Set((text.match(/\b(?:economy|premium economy|business|business class|first|first class)\b/gi) ?? []).map((word) => word.toUpperCase()))];
  const dateTokens = [...new Set(text.match(/\b(?:20\d{2}-\d{2}-\d{2}|20\d{6}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,\s*20\d{2})?)\b/gi) ?? [])].slice(0, 100);
  const prices: RetailerObservation['prices'] = [];
  const pattern = /(CA\$|CAD|US\$|USD|€|EUR|£|GBP)\s*([\d,]+(?:\.\d{1,2})?)/gi;
  for (const match of text.matchAll(pattern)) {
    if (!match[1] || !match[2] || match.index === undefined) continue;
    const context = text.slice(Math.max(0, match.index - 90), match.index + match[0].length + 90);
    const currency = match[1].toUpperCase().startsWith('CA') ? 'CAD' : match[1].toUpperCase().startsWith('US') ? 'USD' : match[1] === '€' ? 'EUR' : match[1] === '£' ? 'GBP' : match[1].toUpperCase();
    const basis = /per (?:person|passenger|traveler|adult)|\/person/i.test(context) ? 'per-person' : /total|for \d+ (?:passengers|travelers|adults)/i.test(context) ? 'total' : 'unknown';
    prices.push({ amountMinor: Math.round(Number(match[2].replace(/,/g, '')) * 100), currency, basis });
  }
  return {
    site: new URL(url).hostname,
    url,
    airportCodes,
    flightNumbers,
    flightCabinEvidence,
    cabinWords,
    dateTokens,
    prices: prices.slice(0, 100),
    blocker: blockerPatterns.find(([, pattern]) => pattern.test(text))?.[0],
  };
}