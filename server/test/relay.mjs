// Integration test: two clients via quick match, then a room handshake and input relay.
// Usage: node test/relay.mjs [baseUrl]
const base = (process.argv[2] ?? 'http://127.0.0.1:8799').replace(/^http/, 'ws');
const open = (path) => new Promise((res, rej) => {
  const ws = new WebSocket(base + path); const q = []; const waiters = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const w = waiters.shift(); w ? w(m) : q.push(m); };
  ws.onopen = () => res({ ws, next: () => q.length ? Promise.resolve(q.shift()) : new Promise((r) => waiters.push(r)), send: (o) => ws.send(JSON.stringify(o)) });
  ws.onerror = rej;
});
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } };
const a = await open('/quick'); assert((await a.next()).t === 'waiting', 'a waits');
const b = await open('/quick');
const ma = await a.next(), mb = await b.next();
assert(ma.t === 'match' && mb.t === 'match' && ma.code === mb.code && ma.host !== mb.host, 'matched same room');
const ra = await open('/room/' + ma.code), rb = await open('/room/' + mb.code);
const sa = await ra.next(), sb = await rb.next();
assert(sa.slot === 0 && sb.slot === 1, 'seats');
ra.send({ t: 'hello', ruleset: 9, name: 'A', arena: 'garden', rating: 5000, placed: true }); rb.send({ t: 'hello', ruleset: 9, name: 'B' });
const pa = await ra.next(), pb = await rb.next();
assert(pa.t === 'peer' && pa.hello.name === 'B' && pb.hello.name === 'A', 'peer exchange');
assert(!('rating' in pb.hello) && !('placed' in pb.hello), 'client-sent rating is dropped ' + JSON.stringify(pb.hello));
ra.send({ t: 'ready' }); rb.send({ t: 'ready' });
const st1 = await ra.next(), st2 = await rb.next();
assert(st1.t === 'start' && st1.seed === st2.seed && st1.arena === 'garden' && st1.players[0].name === 'A', 'start');
const t0 = Date.now();
for (let i = 0; i < 120; i++) ra.send({ t: 'i', n: i, x: i });
for (let i = 0; i < 120; i++) { const m = await rb.next(); assert(m.n === i, 'ordered relay ' + i); }
console.log('relay 120 inputs in', Date.now() - t0, 'ms');
const third = await open('/room/' + ma.code); assert((await third.next()).reason === 'full', 'third rejected');

// spectators: a late joiner gets the start + every input so far; then live inputs tagged by slot
for (let i = 0; i < 30; i++) rb.send({ t: 'i', n: i, i: {}, f: i });
for (let i = 0; i < 30; i++) await ra.next();
const sp = await open('/room/' + ma.code + '?spectate=1');
const w = await sp.next();
assert(w.t === 'watch' && w.players.join() === 'A,B', 'watch hello ' + JSON.stringify(w));
const ss = await sp.next();
assert(ss.t === 'start' && ss.spectate && ss.seed === st1.seed && ss.players[1].name === 'B', 'spectator start');
const lg = await sp.next();
assert(lg.t === 'log' && lg.m.length === 150 && lg.m[0].s === 0 && lg.m[0].n === 0 && lg.m[149].s === 1 && lg.m[149].n === 29, 'spectator log ' + lg.m?.length);
ra.send({ t: 'i', n: 120, i: { moveX: 1 } }); rb.send({ t: 'i', n: 30, i: {} });
const l1 = await sp.next(), l2 = await sp.next();
assert(l1.s === 0 && l1.n === 120 && l1.i.moveX === 1 && l2.s === 1 && l2.n === 30, 'live tagged inputs');
await rb.next(); await ra.next();
// spectators never reach the players, and pings/sums are not forwarded to them
sp.send({ t: 'i', n: 999 }); ra.send({ t: 'sum', n: 0, h: 1 });
const sm = await rb.next(); assert(sm.t === 'sum', 'spectator input not relayed');
const live = await (await fetch(base.replace(/^ws/, 'http') + '/live')).json();
assert(live.some((r) => r.code === ma.code && r.names.join() === 'A,B'), 'live directory ' + JSON.stringify(live));
const late = await open('/room/' + ma.code + '?spectate=1'); await late.next(); await late.next();
assert((await late.next()).m.length === 152, 'second spectator sees the whole log');

ra.ws.close(); const left = await rb.next(); assert(left.t === 'left', 'left notice');
assert((await sp.next()).t === 'left', 'spectator told the match ended');
const live2 = await (await fetch(base.replace(/^ws/, 'http') + '/live')).json();
assert(!live2.some((r) => r.code === ma.code), 'room left the live directory');

// ranked writes to the leaderboard: only against a local `wrangler dev`
if (!/127\.0\.0\.1|localhost/.test(base)) { console.log('PASS (ranked skipped: not local)'); process.exit(0); }
// ranked: both report the same winner -> ratings move; keys stay private
// unique names: local state persists between runs
const tag = Math.random().toString(36).slice(2, 7);
const nameA = 'RelayA' + tag, nameB = 'RelayB' + tag;
const ka = 'key-a-' + Math.random().toString(36).slice(2, 14), kb = 'key-b-' + Math.random().toString(36).slice(2, 14);
const qa = await open('/quick?ranked=1&key=' + ka); await qa.next();
const qb = await open('/quick?ranked=1&key=' + kb);
const code = (await qa.next()).code; await qb.next();
const x = await open('/room/' + code), y = await open('/room/' + code);
await x.next(); await y.next();
x.send({ t: 'hello', ruleset: 9, name: nameA, key: ka, ranked: true, arena: 'garden' });
y.send({ t: 'hello', ruleset: 9, name: 'Relay<B>' + tag, key: kb, ranked: true });
const px = await x.next(), py = await y.next();
assert(!('key' in px.hello) && !('key' in py.hello) && px.hello.rating === 1000 && px.hello.name === nameB && px.hello.placed === false, 'keys hidden, names cleaned');
x.send({ t: 'ready' }); y.send({ t: 'ready' });
const s1 = await x.next(); await y.next();
assert(s1.ranked === true, 'ranked start');
x.send({ t: 'result', winner: 0 }); y.send({ t: 'result', winner: 0 });
const r1 = await x.next(), r2 = await y.next();
assert(r1.t === 'rated' && r1.counted && r1.ratings[0] > 1000 && r1.ratings[1] < 1000 && r2.counted, 'elo moved ' + JSON.stringify(r1));
// disagreement does not count
x.send({ t: 'ready' }); y.send({ t: 'ready' }); await x.next(); await y.next();
x.send({ t: 'result', winner: 0 }); y.send({ t: 'result', winner: 1 });
const r3 = await x.next(); await y.next();
assert(r3.counted === false, 'disagreement not rated');
const top = await (await fetch(base.replace(/^ws/, 'http') + '/top')).json();
assert(top.some((p) => p.name === nameA), 'leaderboard');
console.log('ranked', JSON.stringify(r1));

// seasons: placements use the bigger K, rank hidden until 5 games, season fields on every route
const http = base.replace(/^ws/, 'http');
const get = async (p) => { const r = await fetch(http + p); return { status: r.status, body: await r.json() }; };
const post = async (p, body) => { const r = await fetch(http + p, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
assert(r1.season && /^\d{4}-\d\d$/.test(r1.season) && r1.games[0] === 1 && r1.games[1] === 1, 'season fields in rated ' + JSON.stringify(r1));
assert(r1.before[0] === 1000 && r1.deltas[0] === 32 && r1.deltas[1] === -32, 'placement K (64 x 0.5) ' + JSON.stringify(r1));
const me = (await get('/me?key=' + ka)).body;
assert(me.rating === 1032 && me.games === 1 && me.wins === 1 && me.placed === false && me.rank === null && me.season === r1.season && me.lifetime.games === 1, 'me ' + JSON.stringify(me));
assert('prevSeason' in me && typeof me.endsAt === 'number', 'me season info');
const season = (await get('/season')).body;
assert(season.season === r1.season && season.prev < season.season, 'season route');
const top2 = (await get('/top?season=' + r1.season)).body;
const rowA = top2.find((p) => p.name === nameA);
assert(Array.isArray(top2) && rowA && rowA.placed === false && rowA.rank === null && rowA.rating === 1032, 'season top ' + JSON.stringify(rowA));
assert((await get('/top?season=1999-01')).body.length === 0, 'empty old season');
assert((await get('/top?season=2026-1x')).status === 400, 'bad season rejected');
// five games places the player
for (let i = 0; i < 4; i++) {
  x.send({ t: 'ready' }); y.send({ t: 'ready' }); await x.next(); await y.next();
  x.send({ t: 'result', winner: 0 }); y.send({ t: 'result', winner: 0 });
  const r = await x.next(); await y.next();
  assert(r.counted && r.games[0] === i + 2, 'placement game ' + JSON.stringify(r));
}
const placed = (await get('/me?key=' + ka)).body;
assert(placed.placed === true && placed.games === 5 && typeof placed.rank === 'string' && placed.peak === placed.rating, 'placed ' + JSON.stringify(placed));
console.log('season', JSON.stringify({ rating: placed.rating, rank: placed.rank }));

// a fast "Fight!" click before the opponent's report arrives must not wipe the early report
x.send({ t: 'ready' }); y.send({ t: 'ready' }); await x.next(); await y.next();
x.send({ t: 'result', winner: 0 }); x.send({ t: 'ready' });
await new Promise((r) => setTimeout(r, 150));
y.send({ t: 'result', winner: 0 });
const rf1 = await x.next(); await y.next();
assert(rf1.t === 'rated' && rf1.counted && rf1.games[0] === 6, 'early report survives a quick ready ' + JSON.stringify(rf1));
// the winner reports and closes the tab during the outro: the loser's matching report rates it (no forfeit)
y.send({ t: 'ready' });
const rs = await x.next(); await y.next();
assert(rs.t === 'start' && rs.ranked, 'next ranked start');
x.send({ t: 'result', winner: 0 });
await new Promise((r) => setTimeout(r, 150));
x.ws.close();
assert((await y.next()).t === 'left', 'winner left');
y.send({ t: 'result', winner: 0 });
const rw = await y.next();
assert(rw.t === 'rated' && rw.counted && !rw.forfeit && rw.deltas[0] > 0 && rw.deltas[1] < 0 && rw.games[0] === 7, 'winner who left after reporting keeps the win ' + JSON.stringify(rw));

// survival board: best per player per season, absurd values rejected, names cleaned
assert((await post('/survival', { key: ka, name: 'Surv<A>', rounds: 6, build: { gun: 'rifle', body: 'striker;--' } })).body.best === 6, 'survival post');
assert((await post('/survival', { key: ka, name: 'SurvA', rounds: 3 })).body.best === 6, 'survival keeps best');
assert((await post('/survival', { key: ka, rounds: 100000 })).status === 400, 'survival clamps absurd rounds');
assert((await post('/survival', { key: ka, rounds: 2.5 })).status === 400, 'survival integers only');
assert((await post('/survival', { key: 'short', rounds: 4 })).status === 400, 'survival needs a key');
assert((await post('/survival', 'not json')).status === 400, 'survival bad body');
await post('/survival', { key: kb, name: 'SurvB', rounds: 9, build: {} });
const sv = (await get('/survival/top?key=' + ka)).body;
const svA = sv.top.find((p) => p.you);
assert(sv.season === r1.season && sv.me.rounds === 6 && sv.me.place >= 2 && sv.top.length <= 10, 'survival top ' + JSON.stringify(sv));
// (local state accumulates across runs, so this run's row may have dropped out of the top 10)
if (svA) assert(svA.name === 'SurvA' && svA.rounds === 6 && svA.build.body === 'striker--', 'survival row ' + JSON.stringify(svA));
assert(sv.top.every((p, i) => i === 0 || sv.top[i - 1].rounds >= p.rounds), 'survival ordered');

// replay share links
const replay = { rulesVersion: 6, v: 1, config: { mode: 'free', rivalId: 'dex', arenaId: 'foundry', playerLoadout: { gun: 'rifle' } }, worldSeed: 1, aiSeed: 2, streams: ['AQIDBA=='], frames: 10, date: new Date().toISOString() };
const up = await post('/replay', replay);
assert(up.status === 200 && /^[A-Z0-9]{6}$/.test(up.body.code), 'replay upload ' + JSON.stringify(up));
const again = await post('/replay', replay);
assert(again.body.code === up.body.code, 'same replay, same code');
const down = await get('/replay/' + up.body.code);
assert(down.status === 200 && down.body.frames === 10 && down.body.config.arenaId === 'foundry', 'replay download');
assert((await get('/replay/ZZZZZZ')).status === 404, 'unknown code 404');
assert((await post('/replay', { ...replay, v: 2 })).status === 400, 'replay shape checked');
assert((await post('/replay', { ...replay, streams: ['<script>'] })).status === 400, 'replay streams checked');
assert((await post('/replay', { ...replay, pad: 'x'.repeat(300 * 1024) })).status === 413, 'replay size cap');
const pre = await fetch(http + '/replay', { method: 'OPTIONS' });
assert(pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*', 'cors preflight');
console.log('survival + replay ok', up.body.code);
console.log('PASS'); process.exit(0);
