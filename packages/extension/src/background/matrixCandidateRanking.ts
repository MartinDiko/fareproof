import type { MatrixFlightCandidate } from '../shared/messages';

export function rankMatrixFlightCandidates(
  candidates: MatrixFlightCandidate[],
  currency: string,
  maximumPricePerPersonMinor: number,
): MatrixFlightCandidate[] {
  return candidates
    .filter((candidate) => candidate.currency === currency && candidate.priceMinor <= maximumPricePerPersonMinor)
    .sort((left, right) =>
      left.priceMinor - right.priceMinor ||
      (left.durationMinutes ?? Number.MAX_SAFE_INTEGER) - (right.durationMinutes ?? Number.MAX_SAFE_INTEGER),
    );
}