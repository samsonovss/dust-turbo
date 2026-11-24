// Run the deployed module layout with isolated in-memory WebSocket clients.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');

class Socket extends EventTarget {
  events = [];
  accept() {}
  send(data) { this.events.push(JSON.parse(data)); }
  submit(data) {
    this.dispatchEvent(new MessageEvent('message', {data: JSON.stringify({v: 2, ...data})}));
  }
}
const context = vm.createContext({
  crypto, setInterval: () => 1, Response: class {},
  WebSocketPair: class { constructor() { this[1] = new Socket(); } },
});
const root = path.resolve(__dirname, '..');
function moduleAt(file) {
  return new vm.SourceTextModule(fs.readFileSync(path.join(root, file), 'utf8'), {context});
}
(async () => {
  const server = moduleAt('worker/server.js');
  await server.link(spec => { assert.equal(spec, './core.js'); return moduleAt('core.js'); });
  await server.evaluate();
  const lobby = new server.namespace.Lobby({});
  async function connect(name) {
    await lobby.fetch();
    const ws = [...lobby.clients.keys()].at(-1);
    if (name) ws.submit({t: 'join', name});
    return ws;
  }
  const alice = await connect('Аня'), bob = await connect('Борис'), guest = await connect();
  const chat = (ws, text) => ws.submit({t: 'chat', text, name: 'Подмена'});
  chat(alice, '  Раз\n\tдва  ');
  for (const ws of [alice, bob]) assert.deepEqual(ws.events.at(-1),
    {v: 2, t: 'chat', name: 'Аня', text: 'Раз два'});
  assert(!guest.events.some(e => e.t === 'chat'));
  chat(alice, 'Ещё'); assert.equal(alice.events.at(-1).t, 'chatError');
  chat(guest, 'Нет'); assert.equal(guest.events.at(-1).t, 'chatError');
  for (const invalid of ['   ', {}, 'я'.repeat(201)]) {
    chat(bob, invalid); assert.equal(bob.events.at(-1).t, 'chatError');
  }
  chat(bob, '🙂'.repeat(200)); assert.equal(alice.events.at(-1).text, '🙂'.repeat(200));
  lobby.phase = 'racing';
  const waiting = await connect('Вера'), other = await connect('Ира');
  const count = bob.events.length;
  chat(waiting, 'Следующий заезд?');
  assert.equal(other.events.at(-1).text, 'Следующий заезд?');
  assert.equal(bob.events.length, count);
  chat(bob, 'За рулём'); assert.equal(bob.events.at(-1).t, 'chatError');
  assert(!waiting.events.some(e => e.text === 'Раз два'));
  console.log('PASS isolated Worker lobby chat');
})().catch(error => { console.error(error); process.exitCode = 1; });
