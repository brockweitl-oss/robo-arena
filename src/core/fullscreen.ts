/** Fullscreen failures are expected when browser policy denies a request. */
export async function toggleFullscreen(doc: Document = document): Promise<boolean> {
  try {
    if (doc.fullscreenElement) await doc.exitFullscreen();
    else await doc.documentElement.requestFullscreen();
    return true;
  } catch { return false; }
}
export function installFullscreen(parent: HTMLElement, resize: () => void) {
  const button = document.createElement('button');
  button.className = 'fs-toggle';
  button.title = 'Toggle fullscreen (F11)'; button.setAttribute('aria-label', 'Toggle fullscreen');
  Object.assign(button.style, { position: 'absolute', right: '12px', bottom: '10px', zIndex: '40', pointerEvents: 'auto', background: '#101c29dd', color: '#e4f2ff', border: '1px solid #567386', padding: '6px 9px', cursor: 'pointer', font: '11px system-ui' });
  let pending = false;
  const update = () => { button.textContent = document.fullscreenElement ? 'F11 · Exit fullscreen' : 'F11 · Fullscreen'; button.setAttribute('aria-pressed', String(!!document.fullscreenElement)); resize(); };
  const toggle = async () => { if (pending) return; pending = true; await toggleFullscreen(); pending = false; update(); };
  const key = (e: KeyboardEvent) => { if (e.code === 'F11' && document.fullscreenEnabled) { e.preventDefault(); if (!e.repeat) void toggle(); } };
  // Mouse clicks should not steal gameplay keyboard focus; Tab/Enter remains accessible.
  button.onmousedown = (event) => event.preventDefault();
  button.onclick = (event) => { if (event.detail > 0) button.blur(); void toggle(); }; parent.append(button); update();
  window.addEventListener('keydown', key, true); document.addEventListener('fullscreenchange', update);
  return () => { button.remove(); window.removeEventListener('keydown', key, true); document.removeEventListener('fullscreenchange', update); };
}
