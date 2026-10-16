const DARK_SCHEME = '(prefers-color-scheme: dark)';

/**
 * Marks the page's body `theme-dark` or `theme-light` as the browser's colour scheme says, as
 * Obsidian marks its own: shared code and styles ask the body which theme is on (the dice, the
 * token handles, the loading screen). Follows later changes. Returns a function that stops that.
 */
export function followColorScheme(doc: Document = document): () => void {
  const win = doc.defaultView ?? window;
  const query = win.matchMedia(DARK_SCHEME);
  const mark = (): void => {
    doc.body.classList.toggle('theme-dark', query.matches);
    doc.body.classList.toggle('theme-light', !query.matches);
  };
  mark();
  query.addEventListener('change', mark);
  return () => query.removeEventListener('change', mark);
}
