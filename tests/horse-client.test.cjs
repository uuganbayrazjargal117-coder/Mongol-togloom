const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));

class Socket {
  connected = true;
  auth = {};
  listeners = new Map();
  requests = [];
  on(name, handler) { this.listeners.set(name, handler); }
  receive(name, value) { this.listeners.get(name)?.(value); }
  timeout() { return this; }
  emit(name, payload, ack) { this.requests.push({ name, payload, ack }); }
}
function storage() {
  const values = new Map([['lan-session-token', 'saved-token']]);
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
}
const initial = () => ({ id: 'race-1', phase: 'ready', finished: false, currentPlayerId: 'a', turnNumber: 1, lastThrow: null });

test('Horse Racing client restores session and gates buttons/gestures to the authoritative turn', async () => {
  const { createHorseMultiplayer } = await import('../race-multiplayer.mjs');
  const socket = new Socket(), saved = storage(), applied = [], statuses = [];
  let controls;
  const client = createHorseMultiplayer({
    applyState: async (state, options) => applied.push({ state, options }),
    renderControls: value => { controls = value; }, onStatus: text => statuses.push(text)
  }, { ioFactory: options => { assert.equal(options.auth.sessionToken, 'saved-token'); return socket; }, storage: saved });
  socket.receive('session', { playerId: 'b', token: 'new-token' });
  socket.receive('horse:state', initial());
  assert.equal(applied.length, 0); assert.equal(client.canThrow(), false);
  client.ready(); await tick();
  assert.equal(saved.getItem('lan-session-token'), 'new-token');
  assert.equal(socket.auth.sessionToken, 'new-token'); assert.equal(controls.playerId, 'b');
  assert.equal(client.requestThrow(), false); assert.equal(socket.requests.length, 0);
  socket.receive('horse:state', { ...initial(), currentPlayerId: 'b', turnNumber: 2 }); await tick();
  assert.equal(client.canThrow(), true);
  assert.equal(client.requestThrow(), true); assert.equal(client.requestThrow(), false);
  assert.deepEqual(socket.requests[0].payload, { gameId: 'race-1', turnNumber: 2 });
  assert.equal(socket.requests[0].name, 'horse:throw');
  assert.equal('faces' in socket.requests[0].payload, false); assert.equal('position' in socket.requests[0].payload, false);
  socket.requests[0].ack(null, { ok: false, error: 'Rejected by server' });
  assert.equal(statuses.at(-1), 'Rejected by server');
  socket.connected = false; socket.receive('disconnect');
  assert.equal(client.canThrow(), false); assert.equal(controls.canThrow, false);
});

test('Horse Racing client serializes animations, coalesces turn updates and never replays a result', async () => {
  const { createHorseMultiplayer } = await import('../race-multiplayer.mjs');
  const socket = new Socket(), applied = []; let finishAnimation;
  const animation = new Promise(resolve => { finishAnimation = resolve; });
  const client = createHorseMultiplayer({
    applyState: async (state, options) => { applied.push({ state, options }); if (options.animate) await animation; },
    renderControls: () => {}, onStatus: () => {}
  }, { ioFactory: () => socket, storage: storage() });
  socket.receive('session', { playerId: 'a', token: 'token' });
  socket.receive('horse:state', initial()); client.ready(); await tick();
  // An incorrect local/server clock offset must not suppress an authoritative animation.
  const lastThrow = { sequence: 1, faces: [0, 1, 2, 3], animationEndsAt: Date.now() - 10000 };
  socket.receive('horse:state', { ...initial(), phase: 'animating', lastThrow }); await tick();
  assert.equal(client.canThrow(), false);
  // Server turn timer may advance while this client's rendering is delayed or in a background tab.
  socket.receive('horse:state', { ...initial(), lastThrow, turnNumber: 2, currentPlayerId: 'b' });
  socket.receive('horse:state', { ...initial(), lastThrow, turnNumber: 3, currentPlayerId: 'a' });
  assert.equal(client.requestThrow(), false);
  finishAnimation(); await tick();
  assert.equal(applied.filter(a => a.options.animate).length, 1);
  assert.equal(applied.at(-1).state.turnNumber, 3); assert.equal(client.canThrow(), true);
  socket.receive('horse:state', { ...initial(), lastThrow, turnNumber: 3 }); await tick();
  assert.equal(applied.filter(a => a.options.animate).length, 1);
  const finished = { ...initial(), phase: 'finished', finished: true, currentPlayerId: null, lastThrow };
  socket.receive('horse:state', finished); await tick(); assert.equal(client.canThrow(), false);
});

test('Horse Racing refresh restores an old result without replaying its animation', async () => {
  const { createHorseMultiplayer } = await import('../race-multiplayer.mjs');
  const socket = new Socket(), applied = [];
  const client = createHorseMultiplayer({ applyState: async (state, options) => applied.push(options), renderControls() {}, onStatus() {} },
    { ioFactory: () => socket, storage: storage() });
  socket.receive('horse:state', { ...initial(), lastThrow: { sequence: 10, animationEndsAt: Date.now() - 1 } });
  client.ready(); await tick(); assert.equal(applied[0].animate, false);
});

test('Horse Racing multiplayer end requests are available only to the host and stop after ending', async () => {
  const { createHorseMultiplayer } = await import('../race-multiplayer.mjs');
  const socket = new Socket(), controls = [];
  const client = createHorseMultiplayer({
    applyState: async () => {}, renderControls: value => controls.push(value), onStatus() {}
  }, { ioFactory: () => socket, storage: storage() });
  socket.receive('session', { playerId: 'host', token: 'token' });
  socket.receive('horse:state', { ...initial(), hostId: 'host' });
  client.ready(); await tick();
  assert.equal(client.canEnd(), true);
  assert.equal(client.requestEnd(), true);
  assert.equal(socket.requests[0].name, 'horse:end');
  assert.deepEqual(socket.requests[0].payload, { gameId: 'race-1', turnNumber: 1 });
  socket.receive('horse:state', { ...initial(), hostId: 'host', phase: 'ended', finished: true, endReason: 'ended-early' });
  await tick();
  assert.equal(client.canEnd(), false);
  assert.equal(client.requestEnd(), false);
  assert.equal(controls.at(-1).canEnd, false);

  const guestSocket = new Socket();
  const guestClient = createHorseMultiplayer(
    { applyState: async () => {}, renderControls() {}, onStatus() {} },
    { ioFactory: () => guestSocket, storage: storage() }
  );
  guestSocket.receive('session', { playerId: 'guest', token: 'guest-token' });
  guestSocket.receive('horse:state', { ...initial(), hostId: 'host' });
  guestClient.ready(); await tick();
  assert.equal(guestClient.canEnd(), false);
  assert.equal(guestClient.requestEnd(), false);
  assert.equal(guestSocket.requests.length, 0);
});

test('local Horse Racing confirmation cancel preserves the game and confirm ends it', () => {
  const source = fs.readFileSync(path.join(__dirname, '../race.js'), 'utf8');
  const endFunctionStart = source.indexOf('function endLocalGame()');
  const endFunctionEnd = source.indexOf('\nfunction renderNetworkControls', endFunctionStart);
  const handlersStart = source.indexOf("$('end-game').onclick=");
  const handlersEnd = source.indexOf("$('rules').onclick", handlersStart);
  assert.ok(endFunctionStart >= 0 && endFunctionEnd > endFunctionStart);
  assert.ok(handlersStart >= 0 && handlersEnd > handlersStart);

  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: id === 'game-over', disabled: false, open: false,
      showModal() { this.open = true; }, close() { this.open = false; }
    });
    return elements.get(id);
  };
  const context = {
    active: true, busy: false, localRun: 0, localEndReason: null, localAnimation: null,
    ranking: [], multiplayerMode: false, multiplayer: null,
    $: element, cancelRaceAnimations() {}, update() {},
    showLocalGameOver() { element('game-over').hidden = false; }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(endFunctionStart, endFunctionEnd) + '\n' +
    source.slice(handlersStart, handlersEnd), context);

  element('end-game').onclick();
  assert.equal(element('end-game-confirmation').open, true);
  assert.equal(context.active, true);
  assert.equal(context.localRun, 0);
  element('cancel-end-game').onclick();
  assert.equal(element('end-game-confirmation').open, false);
  assert.equal(context.active, true);
  assert.equal(context.localEndReason, null);
  assert.equal(element('game-over').hidden, true);

  element('end-game').onclick();
  element('confirm-end-game').onclick();
  assert.equal(context.active, false);
  assert.equal(context.localEndReason, 'ended-early');
  assert.equal(context.localRun, 1);
  assert.equal(element('throw').disabled, true);
  assert.equal(element('end-game').hidden, true);
  assert.equal(element('game-over').hidden, false);
});
