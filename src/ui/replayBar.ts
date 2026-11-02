/**
 * Replay timeline: progress bar with hit / knockdown markers, pause, ±10 s skips and a
 * damage log. The match owns the sim; this only renders and reports requests.
 * Seeking forward fast-simulates; seeking back restarts the replay and fast-forwards
 * (the sim is deterministic, so that lands on the exact same state).
 */
export interface ReplayMark { t: number; side: 0 | 1; text: string; big: boolean }

export class ReplayBar {
  readonly el: HTMLDivElement;
  private fill: HTMLDivElement;
  private track: HTMLDivElement;
  private time: HTMLSpanElement;
  private log: HTMLDivElement;
  private playBtn: HTMLButtonElement;
  private marks: ReplayMark[] = [];
  private onKey: (e: KeyboardEvent) => void;

  constructor(parent: HTMLElement, private total: number, private act: { toggle: () => void; seek: (t: number) => void; now: () => number }) {
    const el = (this.el = document.createElement('div'));
    el.className = 'rp-bar';
    const css = document.createElement('style');
    css.textContent = `
.rp-bar { position:absolute; left:50%; bottom:28px; transform:translateX(-50%); width:min(820px, 92vw); z-index:9; pointer-events:auto;
  background:#08131ee8; border:1px solid #7193a7; padding:8px 10px; color:#e8f5ff; font:600 12px 'Chakra Petch', system-ui; }
.rp-row { display:flex; align-items:center; gap:8px; }
.rp-bar button { padding:5px 9px; cursor:pointer; color:inherit; background:#14222d; border:1px solid #7193a7; font:inherit; }
.rp-bar button:hover { background:#24536c; }
.rp-track { position:relative; flex:1; height:14px; background:#0d1c27; border:1px solid #31495a; cursor:pointer; }
.rp-fill { position:absolute; inset:0 auto 0 0; background:linear-gradient(90deg,#1f6f93,#37e8ff); opacity:.55; }
.rp-mark { position:absolute; top:-3px; width:2px; height:20px; transform:translateX(-1px); }
.rp-mark.s0 { background:#37e8ff; } .rp-mark.s1 { background:#ff5a4a; } .rp-mark.big { width:4px; top:-5px; height:24px; }
.rp-time { min-width:92px; text-align:right; font-variant-numeric:tabular-nums; }
.rp-log { margin-top:6px; display:grid; grid-template-columns:repeat(3, 1fr); gap:2px 12px; opacity:.85; font-weight:500; }
.rp-log .s0 { color:#8ff1ff; } .rp-log .s1 { color:#ff9a8a; }`;
    el.append(css);
    const btn = (label: string, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = fn;
      return b;
    };
    this.playBtn = btn('❚❚', 'Pause / play (K)', () => act.toggle());
    this.track = document.createElement('div');
    this.track.className = 'rp-track';
    this.fill = document.createElement('div');
    this.fill.className = 'rp-fill';
    this.track.append(this.fill);
    this.track.onclick = (e) => {
      const r = this.track.getBoundingClientRect();
      act.seek(((e.clientX - r.left) / r.width) * this.total);
    };
    this.time = document.createElement('span');
    this.time.className = 'rp-time';
    const row = document.createElement('div');
    row.className = 'rp-row';
    row.append(btn('⟲10', 'Back 10 s (J)', () => act.seek(act.now() - 10)), this.playBtn, btn('10⟳', 'Forward 10 s (L)', () => act.seek(act.now() + 10)), this.track, this.time);
    this.log = document.createElement('div');
    this.log.className = 'rp-log';
    el.append(row, this.log);
    parent.append(el);
    this.onKey = (e) => {
      if (e.code === 'KeyK') act.toggle();
      else if (e.code === 'KeyJ') act.seek(act.now() - 10);
      else if (e.code === 'KeyL') act.seek(act.now() + 10);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', this.onKey);
  }

  mark(m: ReplayMark) {
    if (this.marks.some((x) => Math.abs(x.t - m.t) < 1e-6 && x.text === m.text)) return;
    this.marks.push(m);
    const d = document.createElement('div');
    d.className = `rp-mark s${m.side}${m.big ? ' big' : ''}`;
    d.style.left = `${Math.min(100, (m.t / this.total) * 100)}%`;
    d.title = `${fmt(m.t)} ${m.text}`;
    this.track.append(d);
    const recent = this.marks.slice(-6);
    this.log.replaceChildren(...recent.map((x) => {
      const r = document.createElement('div');
      r.className = `s${x.side}`;
      r.textContent = `${fmt(x.t)} ${x.text}`;
      return r;
    }));
  }

  update(t: number, playing: boolean, seeking: boolean) {
    this.fill.style.width = `${Math.min(100, (t / this.total) * 100)}%`;
    this.time.textContent = seeking ? 'seeking…' : `${fmt(t)} / ${fmt(this.total)}`;
    this.playBtn.textContent = playing ? '❚❚' : '▶';
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }
}

const fmt = (t: number) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
