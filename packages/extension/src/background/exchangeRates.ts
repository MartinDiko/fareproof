import { z } from 'zod';
import { STORAGE_KEYS } from '../shared/state';

const bankOfCanadaResponseSchema = z.object({
  observations: z.array(z.object({
    d: z.string(),
    FXUSDCAD: z.object({ v: z.string() }),
  })).min(1),
});

export const usdCadRateSchema = z.object({
  usdToCad: z.number().positive(),
  effectiveDate: z.string(),
  fetchedAt: z.string(),
  source: z.literal('Bank of Canada'),
});

export type UsdCadRate = z.infer<typeof usdCadRateSchema>;

const MAX_RATE_AGE_MS = 24 * 60 * 60 * 1_000;

export async function getUsdCadRate(): Promise<UsdCadRate | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.usdCadRate);
  const cached = usdCadRateSchema.safeParse(stored[STORAGE_KEYS.usdCadRate]);
  if (cached.success && Date.now() - Date.parse(cached.data.fetchedAt) <= MAX_RATE_AGE_MS) return cached.data;

  try {
    const response = await fetch('https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Bank of Canada returned ${response.status}.`);
    const parsed = bankOfCanadaResponseSchema.parse(await response.json());
    const latest = parsed.observations.at(-1)!;
    const rate = usdCadRateSchema.parse({
      usdToCad: Number(latest.FXUSDCAD.v),
      effectiveDate: latest.d,
      fetchedAt: new Date().toISOString(),
      source: 'Bank of Canada',
    });
    await chrome.storage.local.set({ [STORAGE_KEYS.usdCadRate]: rate });
    return rate;
  } catch {
    return cached.success ? cached.data : null;
  }
}

export function convertUsdToCad(amountMinor: number, usdToCad: number): number {
  return Math.round(amountMinor * usdToCad);
}