export function observeStablePage(callback: () => void, delayMs = 1_000): () => void {
  let timer: number | undefined;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(callback, delayMs);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('popstate', schedule);
  schedule();
  return () => {
    window.clearTimeout(timer);
    observer.disconnect();
    window.removeEventListener('popstate', schedule);
  };
}