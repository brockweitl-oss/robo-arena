// First-2-hours economy model. Usage: node econ.mjs <priceMul> <ladder win probs comma>
const priceMul = +(process.argv[2] ?? 1);
const P = (process.argv[3] ?? '0.85,0.6,0.55,0.45,0.35').split(',').map(Number);
const PLUS = [0.6, 0.45, 0.4, 0.3, 0.25];
const CYCLE = 150; // s per match loop: ~60-75 s fight + intro/versus + results screen
const credits = (win, mode = 1) => Math.round(((win ? 120 + 30 * 0.8 : 40) + 12 + (win ? 15 : 8)) * mode); // + ~4 dodges, ~1 parry
const stock = [425 * 2, 175 * 2, 440, 275].reduce((a, b) => a + b, 0) * priceMul; // one day's 6-item rotation
let t = 0, cr = 0, matches = 0, wins = 0, ladder = 0, plus = 0, xp = 0, dailies = 0;
const log = [];
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
while (t < 7200) {
  const story = ladder < 5; const p = story ? P[ladder] : plus < 5 ? PLUS[plus] : 0.5;
  const win = rnd() < p; matches++; t += CYCLE;
  cr += credits(win); if (win) wins++;
  xp += win ? 105 : 55;
  if (win) { if (story) { ladder++; log.push(`${(t / 60).toFixed(0)} min: beat ladder ${ladder} (match ${matches})`); } else if (plus < 5) { plus++; log.push(`${(t / 60).toFixed(0)} min: beat Rival+ ${plus}`); } }
  // dailies: ~3 x 120 cr, roughly one completes every ~5 matches in the first session
  if (matches % 5 === 0 && dailies < 3) { dailies++; cr += 120; }
  if (matches === 10 || matches === 20 || matches === 40) log.push(`${(t / 60).toFixed(0)} min: ${matches} matches, ${cr} credits (stock today ${stock}), mastery L${[0,300,800,1500,2500].filter((x) => xp >= x).length}`);
}
console.log(log.join('\n'));
console.log(`2 h: ${matches} matches, ${wins} wins, ${cr} credits earned = ${(cr / stock).toFixed(1)}x today's whole stock; avg ${(cr / matches).toFixed(0)}/match; avg item ${(stock / 6).toFixed(0)}`);
