const { test } = require('node:test');
const assert = require('node:assert/strict');
const tick = () => new Promise(r => setImmediate(r));
class Socket {
  connected = true; auth = {}; callbacks = new Map(); requests = [];
  on(event, callback) { this.callbacks.set(event, callback); }
  receive(event, value) { this.callbacks.get(event)?.(value); }
  timeout() { return this; }
  emit(...args) { this.requests.push(args); }
}
for (const type of ['alag', 'horse']) test(type + ' switch cancels old client work, notifies guests and navigates once to a fixed page', async () => {
  const create = type === 'alag' ? (await import('../alag-multiplayer.mjs')).createAlagMultiplayer : (await import('../race-multiplayer.mjs')).createHorseMultiplayer;
  const socket = new Socket(), paths = [], stored = new Map(), messages = [], writes = []; let release;
  const animation = new Promise(r => { release = r; });
  const client = create({
    async applyState(state, { animate, signal }) { if (animate) await animation; if (!signal.aborted) writes.push(state.id); },
    renderControls() {}, onStatus: message => messages.push(message)
  }, { ioFactory: () => socket, navigate: path => paths.push(path), storage: { getItem: k => stored.get(k), setItem: (k, v) => stored.set(k, v) } });
  const state = { id: 'old', hostId: 'a', currentPlayerId: 'a', players: [{ id: 'a' }], phase: 'ready', rolled: 0, rollSequence: 0 };
  const event = type === 'alag' ? 'game:state' : 'horse:state', target = type === 'alag' ? 'horse' : 'alag';
  socket.receive('session', { playerId: 'a', token: 'token' }); socket.receive(event, state); client.ready(); await tick();
  socket.receive(event, { ...state, rolled: 3, rollSequence: 1, phase: 'animating', lastThrow: { sequence: 1 } }); await tick();
  assert.equal(client.canSwitch(), true);
  assert.equal(client.requestSwitch(target, target === 'horse' ? 20 : 12, target === 'horse' ? 'daaga' : undefined), true);
  const ack = socket.requests[0][2];
  assert.deepEqual(socket.requests[0][1], {
    gameId: 'old', targetGame: target, trackLength: target === 'horse' ? 20 : 12,
    ...(target === 'horse' ? { horseCategory: 'daaga' } : {})
  });
  socket.receive('game:switched', { previousGameId: 'old', gameId: 'new', targetGame: target });
  const page = target === 'horse' ? 'race.html?lan=1' : 'turtle.html?lan=1';
  assert.deepEqual(paths, [page]); assert.equal(client.canRestart(), false); assert.equal(client.canSwitch(), false);
  assert.match(messages[0], /Host/); assert.deepEqual(JSON.parse(stored.get('lan-current-game')), { gameId: 'new', gameType: target });
  ack(null, { ok: false, error: 'stale' }); release(); await tick();
  socket.receive(event, state); socket.receive('game:switched', { previousGameId: 'old', gameId: 'new', targetGame: target });
  assert.deepEqual(paths, [page]); assert.equal(messages.some(s => s === 'stale'), false);
  assert.equal(writes.length, 1); assert.equal(type === 'alag' ? client.requestRoll() : client.requestThrow(), false);
});

test('restoring an obsolete game page redirects to the server-confirmed current game; guests cannot request switches', async () => {
  const { createAlagMultiplayer } = await import('../alag-multiplayer.mjs');
  const socket = new Socket(), paths = [];
  const client = createAlagMultiplayer({ applyState: async () => {}, renderControls() {}, onStatus() {} },
    { ioFactory: () => socket, navigate: page => paths.push(page), storage: { getItem() {}, setItem() {} } });
  socket.receive('session', { playerId: 'guest', token: 'same-token' });
  socket.receive('lobby:state', { started: true, selectedGame: 'horse', currentGameId: 'current-horse', hostId: 'host', players: [{ id: 'guest' }] });
  assert.deepEqual(paths, ['race.html?lan=1']); assert.equal(client.requestSwitch('alag', 12), false);
  assert.equal(socket.requests.length, 0);
});

test('switch dialog requires a horse category/distance and sends the selected settings', async () => {
  const { mountGameSwitch } = await import('../game-switch-ui.mjs');
  const elements = new Map(), sent = [], confirmations = [];
  const doc = {
    createElement() { return { textContent: '', value: '', setAttribute() {} }; },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        options: id === 'switch-target' ? [{ value: 'alag' }, { value: 'horse' }] : [],
        replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; },
        add(option) { this.options.push(option); },
        append(child) { elements.set(child.id, child); },
        showModal() { this.open = true; }, close() { this.open = false; }
      });
      return elements.get(id);
    }
  };
  let confirm = false;
  mountGameSwitch({ canSwitch: () => true, switchSettings: () => ({ gameType: 'alag', trackLength: 24, horseCategory: null, alagTrackLength: 24 }), requestSwitch: (...args) => { sent.push(args); return true; } },
    doc, message => { confirmations.push(message); return confirm; });
  doc.getElementById('switch-game').onclick(); assert.equal(doc.getElementById('switch-target').value, 'horse');
  doc.getElementById('switch-cancel').onclick(); assert.equal(sent.length, 0);
  doc.getElementById('switch-game').onclick(); doc.getElementById('switch-confirm').onclick(); assert.equal(sent.length, 0);
  assert.equal(doc.getElementById('switch-error').textContent, 'Насны ангилал болон замын зайг сонгоно уу.');
  confirm = true;
  doc.getElementById('switch-category').value = 'daaga';
  doc.getElementById('switch-category').onchange();
  doc.getElementById('switch-distance').value = '20';
  doc.getElementById('switch-confirm').onclick();
  assert.deepEqual(sent, [['horse', 20, 'daaga']]);
  assert.match(confirmations.at(-1), /Алаг мэлхий/); assert.match(confirmations.at(-1), /Морь уралдуулах/);
});
