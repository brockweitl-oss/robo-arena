import { Game } from './game/game';
import { installFullscreen } from './core/fullscreen';
import { RIVALS } from './data/characters';

const style = document.createElement('style');
style.textContent = `
  html, body { margin:0; height:100%; overflow:hidden; background:#07090d; }
  #app { position:fixed; inset:0; }
  #game-canvas { display:block; position:absolute; inset:0; width:100%; height:100%; outline:none; }
`;
document.head.appendChild(style);

const app = document.getElementById('app')!;
const game = new Game(app);
const disposeFullscreen = installFullscreen(app, () => game.gr.resize());
if (import.meta.hot) import.meta.hot.dispose(disposeFullscreen);
game.start();

const params = new URLSearchParams(location.search);
// ?quick=<rivalId>&arena=<id> jumps straight into a match (dev + automated tests).
const quick = params.get('quick');
if (quick !== null) {
  const rival = RIVALS.find((r) => r.id === quick) ?? RIVALS[0];
  const run = () =>
    game
      .startMatch({ mode: 'free', playerLoadout: game.save.loadout, rivalId: rival.id, arenaId: params.get('arena') ?? rival.arena, timeLimit: Number(params.get('time') ?? 90) })
      .then((r) => {
        (window as any).__lastResult = r;
        run();
      });
  run();
} else {
  import('./ui/menus')
    .then(({ Menus }) => {
      const menus = new Menus(game, game.menuRoot);
      game.menus = menus;
      // ?replay=CODE: a shared replay link plays right after the title screen
      const shared = params.get('replay');
      if (shared && /^[A-Za-z0-9]{6}$/.test(shared)) menus.queueSharedReplay(shared);
      menus.showTitle();
    })
    .catch((e) => console.error('menus failed to load', e));
}
