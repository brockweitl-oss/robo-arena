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
ra.send({ t: 'hello', ruleset: 9, name: 'A', arena: 'garden' }); rb.send({ t: 'hello', ruleset: 9, name: 'B' });
const pa = await ra.next(), pb = await rb.next();
assert(pa.t === 'peer' && pa.hello.name === 'B' && pb.hello.name === 'A', 'peer exchange');
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
const ka = 'key-a-' + Math.random().toString(36).slice(2, 14), kb = 'key-b-' + Math.random().toString(36).slice(2, 14);
const qa = await open('/quick?ranked=1&key=' + ka); await qa.next();
const qb = await open('/quick?ranked=1&key=' + kb);
const code = (await qa.next()).code; await qb.next();
const x = await open('/room/' + code), y = await open('/room/' + code);
await x.next(); await y.next();
x.send({ t: 'hello', ruleset: 9, name: 'Ann', key: ka, ranked: true, arena: 'garden' });
y.send({ t: 'hello', ruleset: 9, name: 'Bo<b>', key: kb, ranked: true });
const px = await x.next(), py = await y.next();
assert(!('key' in px.hello) && !('key' in py.hello) && px.hello.rating === 1000 && px.hello.name === 'Bob', 'keys hidden, names cleaned');
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
assert(top.some((p) => p.name === 'Ann'), 'leaderboard');
console.log('ranked', JSON.stringify(r1));
console.log('PASS'); process.exit(0);
