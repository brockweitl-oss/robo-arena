/**
 * On-screen prompt card for the guided first match (src/game/guide.ts).
 * A small DOM panel under the HUD timer: step counter, key glyph, prompt text.
 */
import { GUIDE_STEPS, type Guide } from '../game/guide';
import { keyName, padName, type Bindings } from '../core/input';

const CSS = `
.gd { position:absolute; left:50%; top:96px; transform:translateX(-50%); width:min(560px, 86vw); padding:12px 16px 12px 14px;
  display:grid; grid-template-columns:auto 1fr; gap:4px 14px; align-items:center; font-family:'Chakra Petch', system-ui, sans-serif; color:#eef2f8;
  background:linear-gradient(90deg, rgba(10,14,22,.92), rgba(10,14,22,.78)); border-left:3px solid #37e8ff;
  clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px); pointer-events:none;
  transition:opacity .3s, transform .3s; z-index:6; }
.gd.off { opacity:0; transform:translate(-50%, -8px); }
.gd-key { grid-row:span 2; min-width:58px; height:58px; padding:0 10px; display:grid; place-items:center; font-family:'Russo One', sans-serif; font-size:18px;
  color:#061018; background:linear-gradient(180deg,#9ff6ff,#37e8ff); box-shadow:0 0 18px rgba(55,232,255,.45); clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px); }
.gd-top { display:flex; gap:10px; align-items:baseline; }
.gd-n { font-size:11px; font-weight:700; letter-spacing:.22em; color:#37e8ff; text-transform:uppercase; }
.gd-t { font-family:'Russo One', sans-serif; font-size:20px; text-transform:uppercase; letter-spacing:.03em; }
.gd-x { font-size:14px; line-height:1.35; color:#c9d3e2; }
.gd-pips { position:absolute; right:12px; top:10px; display:flex; gap:4px; }
.gd-pips i { width:14px; height:4px; background:rgba(160,190,230,.2); }
.gd-pips i.on { background:#37e8ff; }
.gd-pips i.ok { background:#3ef08a; }
.gd.nice { border-left-color:#3ef08a; }
.gd.nice .gd-key { background:linear-gradient(180deg,#b6ffcf,#3ef08a); box-shadow:0 0 18px rgba(62,240,138,.5); }
`;

export class GuideView {
  readonly el: HTMLElement;
  private key: HTMLElement;
  private n: HTMLElement;
  private t: HTMLElement;
  private x: HTMLElement;
  private pips: HTMLElement;
  private niceUntil = 0;
  private static styled = false;

  constructor(parent: HTMLElement) {
    if (!GuideView.styled) {
      const st = document.createElement('style');
      st.textContent = CSS;
      document.head.append(st);
      GuideView.styled = true;
    }
    this.el = document.createElement('div');
    this.el.className = 'gd off';
    this.el.innerHTML = '<div class="gd-key"></div><div class="gd-top"><span class="gd-n"></span><span class="gd-t"></span></div><div class="gd-x"></div><div class="gd-pips"></div>';
    this.key = this.el.querySelector('.gd-key')!;
    this.n = this.el.querySelector('.gd-n')!;
    this.t = this.el.querySelector('.gd-t')!;
    this.x = this.el.querySelector('.gd-x')!;
    this.pips = this.el.querySelector('.gd-pips')!;
    this.pips.innerHTML = GUIDE_STEPS.map(() => '<i></i>').join('');
    parent.append(this.el);
  }

  /** Refresh from the guide state. `now` is render time in seconds. */
  update(g: Guide, visible: boolean, pad: boolean, b: Bindings, now: number) {
    if (g.justDone) {
      this.niceUntil = now + 0.9;
      g.justDone = null;
      this.el.classList.add('nice');
      this.key.textContent = '✓';
      this.t.textContent = 'Nice!';
    }
    const nice = now < this.niceUntil;
    this.el.classList.toggle('off', !visible || (g.finished && !nice));
    if (nice) return;
    this.el.classList.remove('nice');
    const s = g.step;
    if (!s) return;
    if (!g.changed && this.t.textContent === s.title) return;
    g.changed = false;
    const glyph = s.action === 'move' ? (pad ? 'L-Stick' : `${keyName(b.keys.forward[0])}${keyName(b.keys.left[0])}${keyName(b.keys.back[0])}${keyName(b.keys.right[0])}`)
      : pad ? padName(b.pad[s.action]?.[0]) : keyName(b.keys[s.action]?.[0] ?? '');
    this.key.textContent = glyph;
    this.n.textContent = `Step ${Math.min(g.index + 1, GUIDE_STEPS.length)} / ${GUIDE_STEPS.length}`;
    this.t.textContent = s.title;
    this.x.textContent = s.text.replace('{key}', glyph);
    this.pips.querySelectorAll('i').forEach((p, i) => {
      p.className = i < g.index ? (g.done.includes(GUIDE_STEPS[i].id) ? 'ok' : 'on') : i === g.index ? 'on' : '';
    });
  }

  dispose() {
    this.el.remove();
  }
}
