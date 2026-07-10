import type { ExtensionMessage } from '../../shared/messages';
import { parseDisplayedMoney } from '../ita/extraction';

type RetailerLink = Extract<ExtensionMessage, { type: 'BOOKWITHMATRIX_RESULTS' }>['links'][number];

export function extractBookWithMatrixLinks(document: Document): RetailerLink[] {
  const links = new Map<string, RetailerLink>();
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const text = anchor.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const match = /^Book with\s+(.+?)(?:\s+\(|$)/i.exec(text);
    if (!match?.[1] || !anchor.href.startsWith('https://')) continue;
    const price = parseDisplayedMoney(text);
    links.set(anchor.href, { site: match[1].trim(), url: anchor.href, pricePerPersonMinor: price?.amountMinor, currency: price?.currency });
  }
  return [...links.values()];
}

export function submitBookWithMatrix(document: Document, rawJson: string): boolean {
  const textarea = document.querySelector<HTMLTextAreaElement>('#matrixPaste');
  if (!textarea) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, rawJson);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}