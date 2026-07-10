import { contentCommandSchema } from '../../shared/messages';
import { observeStablePage } from '../shared/pageObserver';
import { extractBookWithMatrixLinks, submitBookWithMatrix } from './extraction';

let lastPublished = '';

function inspectPage(): void {
  if (location.pathname === '/' && document.querySelector('#matrixPaste')) {
    if (lastPublished !== 'ready') {
      lastPublished = 'ready';
      void chrome.runtime.sendMessage({ type: 'BOOKWITHMATRIX_READY' });
    }
    return;
  }
  const links = extractBookWithMatrixLinks(document);
  if (!links.length || document.body.innerText.includes('Checking availability')) return;
  const key = JSON.stringify(links);
  if (key === lastPublished) return;
  lastPublished = key;
  void chrome.runtime.sendMessage({ type: 'BOOKWITHMATRIX_RESULTS', resultUrl: location.href, links });
}

chrome.runtime.onMessage.addListener((rawMessage: unknown, _sender, sendResponse) => {
  const parsed = contentCommandSchema.safeParse(rawMessage);
  if (!parsed.success || parsed.data.type !== 'SUBMIT_BOOKWITHMATRIX') return false;
  sendResponse({ ok: submitBookWithMatrix(document, parsed.data.rawJson) });
  return false;
});

observeStablePage(inspectPage, 700);