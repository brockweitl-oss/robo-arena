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
ra.ws.close(); const left = await rb.next(); assert(left.t === 'left', 'left notice');

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
