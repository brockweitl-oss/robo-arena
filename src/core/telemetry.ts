/**
 * Play-test telemetry. Events are buffered and POSTed to the dev server
 * (`/__telemetry`, written to playtest/telemetry.jsonl by a Vite plugin) and
 * mirrored to localStorage. In a static build the POST simply fails silently.
 */
const KEY = 'robo-arena-telemetry';
const session = Math.random().toString(36).slice(2, 10);
let buf: object[] = [];
const t0 = performance.now();

/** Where to send events: the Vite dev server sink locally; a configured endpoint (VITE_TELEMETRY_URL) in production; else nowhere. */
const ENDPOINT: string | null = import.meta.env.DEV ? '/__telemetry' : (import.meta.env.VITE_TELEMETRY_URL as string | undefined) ?? null;

function flush(sync = false) {
  if (!buf.length) return;
  if (!ENDPOINT) {
    buf = [];
    return;
  }
  const body = buf.map((e) => JSON.stringify(e)).join('\n');
  buf = [];
  try {
    if (sync && navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, body);
    else fetch(ENDPOINT, { method: 'POST', body, keepalive: true }).catch(() => {});
  } catch {
    /* offline / static host */
  }
}

export function track(type: string, data: Record<string, unknown> = {}) {
  const ev = { type, build: (import.meta.env.VITE_BUILD as string | undefined) ?? 'dev', session, t: +((performance.now() - t0) / 1000).toFixed(2), at: new Date().toISOString(), ...data };
  buf.push(ev);
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    arr.push(ev);
    localStorage.setItem(KEY, JSON.stringify(arr.slice(-3000)));
  } catch {
    /* storage full/unavailable */
  }
  if (type.startsWith('match_') || buf.length > 20) flush();
}

setInterval(() => flush(), 5000);
window.addEventListener('pagehide', () => flush(true));
