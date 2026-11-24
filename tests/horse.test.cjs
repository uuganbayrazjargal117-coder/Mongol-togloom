const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createLobbyServer } = require('../server');

function waitFor(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(Error('Timed out: ' + event)); }, 3000);
    function listener(value) {
      if (!predicate(value)) return;
      clearTimeout(timer); socket.off(event, listener); resolve(value);
    }
    socket.on(event, listener);
  });
}
const emit = (socket, name, ...args) => socket.timeout(3000).emitWithAck(name, ...args);
const request = state => ({ gameId: state.id, turnNumber: state.turnNumber });
function horseState(socket, predicate) {
  return predicate(socket.horse) ? Promise.resolve(socket.horse) : waitFor(socket, 'horse:state', predicate);
}

test('Horse Racing first throw turns horses forward with the v3 movement counts', async () => {
  const { advance, hasHorseMovement } = await import('../race-logic.mjs');
  const throws = [
    { faces: [1, 1, 2, 2], steps: 0, facingForward: false },
    { faces: [0, 1, 1, 1], steps: 0, facingForward: true },
    { faces: [0, 0, 1, 1], steps: 1, facingForward: true },
    { faces: [0, 0, 0, 1], steps: 2, facingForward: true },
    { faces: [0, 0, 0, 0], steps: 3, facingForward: true }
  ];
  for (const { faces, steps, facingForward } of throws) {
    const result = advance({ position: 0, hasThrown: false, facingForward: false }, faces, 12);
    assert.equal(result.steps, steps);
    assert.equal(result.position, steps);
    assert.equal(result.facingForward, facingForward);
  }
  const afterZeroHorseStart = advance(
    { position: 0, hasThrown: true, facingForward: false },
    [0, 1, 1, 1],
    12
  );
  assert.equal(afterZeroHorseStart.steps, 0);
  assert.equal(afterZeroHorseStart.turnedForward, true);
  assert.equal(afterZeroHorseStart.facingForward, true);
  const subsequentHorse = advance(
    { position: 0, hasThrown: true, facingForward: true },
    [0, 1, 1, 1],
    12
  );
  assert.equal(subsequentHorse.steps, 1);
  assert.equal(subsequentHorse.position, 1);
  assert.equal(hasHorseMovement(0, afterZeroHorseStart.position), false);
  assert.equal(hasHorseMovement(0, subsequentHorse.position), true);
});

test('four-berkh remains distinct from four horses and keeps its four-space bonus', async () => {
  const { advance } = await import('../race-logic.mjs');
  const berkh = advance({ position: 0, hasThrown: false, facingForward: false }, [0, 1, 2, 3], 12);
  const fourHorses = advance({ position: 0, hasThrown: false, facingForward: false }, [0, 0, 0, 0], 12);
  assert.equal(berkh.different, true);
  assert.equal(berkh.steps, 4);
  assert.equal(fourHorses.different, false);
  assert.equal(fourHorses.steps, 3);
});

test('horse age ranges convert to selectable distances, curved paths, titles and foal finish message', async () => {
  const {
    HORSE_AGE_CATEGORIES, horseTrackOptions, isValidHorseRaceSelection,
    buildHorseTrackPath, finishTitle, foalLastPlaceAnnouncement,
    HORSE_TRACK_SPACING, HORSE_TRACK_MARKER_SCALE, HORSE_TRACK_CAMERA_HEIGHT,
    horseTrackCameraFrame, horseFinishPosition, horseProgressLabel, buildHorseTrackLayout, advance
  } = await import('../race-logic.mjs');
  const ranges = {
    azarga: [44, 46, 48], 'ikh-nas': [48, 50, 52], soyolon: [36, 38, 40],
    hyzaalan: [30, 32, 34], shudlen: [24, 26, 28], daaga: [20, 22, 24]
  };
  assert.equal(HORSE_AGE_CATEGORIES.length, 6);
  assert.equal(HORSE_TRACK_SPACING, 1);
  assert.equal(HORSE_TRACK_MARKER_SCALE, 1.05);
  assert.equal(HORSE_TRACK_CAMERA_HEIGHT, 13);
  const fixedFrames = [20, 24, 28, 34, 40, 48, 52].map(() => horseTrackCameraFrame(1.6));
  assert.ok(fixedFrames.every(frame => frame.width === 20.8 && frame.height === 13));
  assert.throws(() => horseTrackCameraFrame(0), RangeError);
  const shortTrack = buildHorseTrackPath(20), longTrack = buildHorseTrackPath(52);
  assert.ok(longTrack.at(-1).x - longTrack[0].x > shortTrack.at(-1).x - shortTrack[0].x);
  for (const trackLength of [20, 24, 28, 34, 40, 48, 52]) {
    const layout = buildHorseTrackLayout(trackLength);
    const finishPosition = horseFinishPosition(trackLength), path = layout.path;
    assert.equal(layout.markerPositions.length, trackLength);
    assert.equal(layout.markerPositions.at(-1), trackLength);
    assert.equal(path.length, trackLength + 2);
    assert.equal(finishPosition, trackLength + 1);
    assert.ok(Math.abs(Math.hypot(path[finishPosition].x - path[trackLength].x, path[finishPosition].z - path[trackLength].z) - HORSE_TRACK_SPACING) < 1e-10);
    assert.equal(horseProgressLabel(trackLength, trackLength), `Сүүлийн шагай · ${trackLength} / ${trackLength}`);
    assert.equal(horseProgressLabel(finishPosition, trackLength), 'Барианд');
  }
  const finishLength = 20;
  assert.equal(advance({ position: finishLength - 1, hasThrown: true, facingForward: true }, [0, 1, 1, 1], finishLength).position, finishLength);
  assert.equal(advance({ position: finishLength, hasThrown: true, facingForward: true }, [0, 1, 1, 1], finishLength).position, finishLength + 1);
  assert.equal(advance({ position: finishLength - 1, hasThrown: true, facingForward: true }, [0, 0, 0, 0], finishLength).position, finishLength + 1);
  for (const [category, distances] of Object.entries(ranges)) {
    const options = horseTrackOptions(category);
    assert.deepEqual(options.map(option => option.trackLength), distances);
    for (const option of options) {
      assert.equal(option.trackLength, option.kilometers * 2);
      assert.equal(isValidHorseRaceSelection(category, option.trackLength), true);
      const path = buildHorseTrackPath(option.trackLength);
      assert.equal(path.length, option.trackLength + 1);
      assert.ok(path[0].x < path.at(-1).x);
      assert.ok(Math.abs(path[0].z - path.at(-1).z) < 1e-10);
      const verticalDirections = path.slice(1).map((point, index) => Math.sign(point.z - path[index].z)).filter(Boolean);
      const curveChanges = verticalDirections.slice(1).filter((direction, index) => direction !== verticalDirections[index]).length;
      assert.ok(curveChanges >= 2, `${option.trackLength}-space track should include multiple S-curves`);
      for (let i = 1; i < path.length; i++) {
        assert.ok(Math.abs(Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z) - HORSE_TRACK_SPACING) < 1e-10);
      }
      if (option.trackLength > 24) assert.ok(Math.max(...path.map(point => point.z)) > Math.min(...path.map(point => point.z)));
    }
  }
  assert.equal(isValidHorseRaceSelection('daaga', 18), false);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(finishTitle), [
    'Түрүү магнай', 'Аман хүзүү', 'Айргийн гурав', 'Айргийн дөрөв', 'Айргийн тав',
    'Цулбуурын зургаа', 'Цулбуурын долоо', 'Цулбуурын найм', 'Цулбуурын ес',
    'Цулбуурын арав', 'Цулбуурын арван нэг', 'Цулбуурын арван хоёр'
  ]);
  const message = 'Энэ тоглолтын баян ходоод, ирэх тоглолтын түрүү магнай!';
  assert.equal(foalLastPlaceAnnouncement('daaga', ['a'], 2, true), null);
  assert.equal(foalLastPlaceAnnouncement('daaga', ['a', 'a'], 2, true), null);
  assert.equal(foalLastPlaceAnnouncement('daaga', ['a', 'b'], 2, false), null);
  assert.equal(foalLastPlaceAnnouncement('soyolon', ['a', 'b'], 2, true), null);
  assert.equal(foalLastPlaceAnnouncement('daaga', ['a', 'b'], 2, true), message);
});

test('multiplayer server turns backward horses in place and restores facing/position on reconnect', async t => {
  const faces = [1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1];
  let faceIndex = 0;
  const { host, guest, client } = await fixture(t, {
    randomFace: () => faces[faceIndex++],
    animationMs: 15
  });
  let state = await startHorse(host);
  assert.equal(state.finishPosition, state.trackLength + 1);
  assert.ok(state.players.every(player => !player.facingForward && !player.hasThrown));

  assert.equal((await emit(host, 'horse:throw', request(state))).ok, true);
  state = await horseState(guest, s => s?.lastThrow?.sequence === 1 && s.phase === 'animating');
  assert.equal(state.lastThrow.steps, 0);
  assert.equal(state.players[0].hasThrown, true);
  assert.equal(state.players[0].facingForward, false);

  state = await horseState(guest, s => s?.phase === 'ready' && s.currentPlayerId === guest.session.playerId);
  assert.equal((await emit(guest, 'horse:throw', request(state))).ok, true);
  state = await horseState(host, s => s?.lastThrow?.sequence === 2 && s.phase === 'animating');
  assert.equal(state.lastThrow.steps, 0);
  assert.equal(state.players[1].facingForward, true);
  assert.equal(state.players[1].position, 0);

  state = await horseState(host, s => s?.phase === 'ready' && s.currentPlayerId === host.session.playerId);
  assert.equal((await emit(host, 'horse:throw', request(state))).ok, true);
  const turning = await horseState(host, s => s?.lastThrow?.sequence === 3 && s.phase === 'animating');
  assert.equal(turning.lastThrow.steps, 0);
  assert.equal(turning.lastThrow.turnedForward, true);
  assert.equal(turning.players[0].position, 0);
  assert.equal(turning.players[0].facingForward, true);

  state = await horseState(host, s => s?.phase === 'ready' && s.currentPlayerId === guest.session.playerId);
  assert.equal((await emit(guest, 'horse:throw', request(state))).ok, true);
  const a = await horseState(host, s => s?.lastThrow?.sequence === 4 && s.phase === 'animating');
  const b = await horseState(guest, s => s?.lastThrow?.sequence === 4 && s.phase === 'animating');
  assert.deepEqual(a, b);
  assert.equal(a.lastThrow.steps, 1);
  assert.equal(a.lastThrow.turnedForward, false);
  assert.equal(a.players[1].position, 1);
  assert.equal(a.players[1].facingForward, true);

  const token = guest.session.token;
  guest.disconnect();
  const restored = await client(token);
  const restoredState = await horseState(restored, s => s?.players.some(p => p.id === guest.session.playerId && p.position === 1 && p.facingForward));
  assert.equal(restoredState.players.find(p => p.id === guest.session.playerId).position, 1);
  assert.equal(restoredState.players.find(p => p.id === guest.session.playerId).facingForward, true);
  assert.equal(restoredState.horseCategory, 'daaga');
  assert.equal(restoredState.distanceKm, 10);
  assert.equal(restoredState.finishPosition, restoredState.trackLength + 1);
});

test('only the host can end a race; ended state synchronizes, restores, and resets cleanly', async t => {
  const { host, guest, client } = await fixture(t, { animationMs: 20 });
  const initialState = await startHorse(host);
  const denied = await emit(guest, 'horse:end', request(initialState));
  assert.equal(denied.ok, false);
  assert.equal(host.horse.finished, false);
  assert.equal(guest.horse.finished, false);

  const endedOnGuest = horseState(guest, s => s?.phase === 'ended');
  assert.equal((await emit(host, 'horse:end', request(initialState))).ok, true);
  const ended = await endedOnGuest;
  assert.deepEqual(ended, host.horse);
  assert.equal(ended.finished, true);
  assert.equal(ended.endReason, 'ended-early');
  assert.equal(ended.currentPlayerId, null);
  assert.deepEqual(ended.ranking, []);
  assert.equal(ended.winnerId, null);
  assert.ok(ended.players.every(player => player.position === 0));
  assert.equal((await emit(host, 'horse:throw', request(ended))).ok, false);

  const token = guest.session.token;
  guest.disconnect();
  const restored = await client(token);
  const restoredState = await horseState(restored, s => s?.id === ended.id && s.finished);
  assert.equal(restoredState.endReason, 'ended-early');
  assert.equal(restoredState.horseCategory, ended.horseCategory);
  assert.equal(restoredState.distanceKm, ended.distanceKm);
  assert.deepEqual(restoredState.players, ended.players);

  const restartedState = horseState(restored, s => s?.id !== ended.id);
  assert.equal((await emit(host, 'game:restart', { gameId: ended.id })).ok, true);
  const restarted = await restartedState;
  assert.equal(restarted.finished, false);
  assert.equal(restarted.endReason, null);
  assert.equal(restarted.horseCategory, ended.horseCategory);
  assert.equal(restarted.distanceKm, ended.distanceKm);
  assert.equal(restarted.finishPosition, ended.trackLength + 1);
  assert.deepEqual(restarted.ranking, []);
  assert.equal(restarted.winnerId, null);
  assert.ok(restarted.players.every(player =>
    player.position === 0 && !player.finished && !player.hasThrown && !player.facingForward
  ));
});

test('the final shagai is not a finish and manually ending there declares no winner', async t => {
  const throws = [
    [0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [1, 1, 1, 1],
    [0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [1, 1, 1, 1],
    [0, 0, 0, 0], [1, 1, 1, 1], [0, 1, 1, 1]
  ];
  const faces = throws.flat();
  let faceIndex = 0;
  const { host, guest } = await fixture(t, { randomFace: () => faces[faceIndex++], animationMs: 10 });
  let state = await startHorse(host);
  for (let i = 0; i < throws.length; i++) {
    const before = await horseState(host, snapshot => snapshot?.phase === 'ready' && snapshot.turnNumber === i + 1);
    const actor = before.currentPlayerId === host.session.playerId ? host : guest;
    const animating = horseState(guest, snapshot => snapshot?.lastThrow?.sequence === i + 1 && snapshot.phase === 'animating');
    assert.equal((await emit(actor, 'horse:throw', request(before))).ok, true);
    await animating;
    state = await horseState(host, snapshot => snapshot?.lastThrow?.sequence === i + 1 && snapshot.phase === 'ready');
  }
  const horse = state.players.find(player => player.id === host.session.playerId);
  assert.equal(horse.position, state.trackLength);
  assert.equal(horse.finished, false);
  assert.deepEqual(state.ranking, []);
  assert.equal(state.winnerId, null);

  const endedOnGuest = horseState(guest, snapshot => snapshot?.phase === 'ended');
  assert.equal((await emit(host, 'horse:end', request(state))).ok, true);
  const ended = await endedOnGuest;
  assert.equal(ended.endReason, 'ended-early');
  assert.deepEqual(ended.ranking, []);
  assert.equal(ended.winnerId, null);
});

async function fixture(t, horseOptions) {
  const { httpServer, io } = createLobbyServer({ horseOptions });
  const clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await new Promise(r => io.close(r)); });
  await new Promise(r => httpServer.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + httpServer.address().port;
  async function client(token) {
    const s = connect(base, { autoConnect: false, reconnection: false, forceNew: true, auth: { sessionToken: token } });
    clients.push(s);
    s.on('session', session => { s.session = session; });
    s.on('horse:state', state => { s.horse = state; });
    const ready = waitFor(s, 'lobby:state'); s.connect(); await ready; return s;
  }
  const host = await client(), guest = await client(), spectator = await client();
  await emit(host, 'lobby:join', { name: 'Azaa' });
  await emit(guest, 'lobby:join', { name: 'Bat' });
  return { host, guest, spectator, client, base, clients };
}
async function startHorse(host, length = 20, horseCategory = 'daaga') {
  assert.equal((await emit(host, 'lobby:select', { game: 'horse', horseCategory, trackLength: length })).ok, true);
  assert.equal((await emit(host, 'lobby:start')).ok, true);
  return horseState(host, s => Boolean(s));
}

test('Horse Racing lobby, authoritative throws, movement, turns and full ranking', async t => {
  const throws = [
    [0, 0, 0, 0], [0, 1, 2, 3], [0, 0, 0, 1], [1, 1, 2, 3],
    [0, 0, 0, 0], [1, 1, 2, 3], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]
  ];
  const randomFaces = throws.flat(); let randomCalls = 0;
  const { host, guest, spectator, client } = await fixture(t, {
    randomFace: () => randomFaces[randomCalls++], animationMs: 100, disconnectGraceMs: 100
  });
  await t.test('only host selects game/track; settings synchronize and reject invalid values', async () => {
    assert.equal((await emit(guest, 'lobby:select', { game: 'horse', horseCategory: 'daaga', trackLength: 20 })).ok, false);
    assert.equal((await emit(spectator, 'lobby:select', { game: 'horse', horseCategory: 'daaga', trackLength: 20 })).ok, false);
    assert.equal((await emit(host, 'lobby:select', { game: 'https://evil.test', trackLength: 12 })).ok, false);
    assert.equal((await emit(host, 'lobby:select', { game: 'horse', trackLength: 20 })).ok, false);
    assert.equal((await emit(host, 'lobby:select', { game: 'horse', horseCategory: 'daaga', trackLength: 18 })).ok, false);
    assert.equal((await emit(host, 'lobby:select', { game: 'horse', horseCategory: 'daaga', trackLength: 13 })).ok, false);
    for (const [horseCategory, trackLength] of [['azarga', 44], ['ikh-nas', 52], ['soyolon', 36], ['hyzaalan', 30], ['shudlen', 28], ['daaga', 20]]) {
      const state = waitFor(guest, 'lobby:state', s => s.selectedGame === 'horse' && s.trackLength === trackLength);
      assert.equal((await emit(host, 'lobby:select', { game: 'horse', horseCategory, trackLength })).ok, true);
      const selected = await state;
      assert.equal(selected.trackLength, trackLength);
      assert.equal(selected.horseCategory, horseCategory);
    }
    assert.equal((await emit(host, 'horse:throw', {})).ok, false);
  });
  await t.test('host start broadcasts selected game and the same initial race; Seat 1 starts', async () => {
    const started = waitFor(guest, 'lobby:started');
    assert.equal((await emit(guest, 'lobby:start')).ok, false);
    assert.equal((await emit(host, 'lobby:start')).ok, true);
    const start = await started;
    const a = await horseState(host, s => Boolean(s)), b = await horseState(guest, s => Boolean(s));
    assert.deepEqual(a, b); assert.equal(start.selectedGame, 'horse'); assert.equal(start.gameId, a.id);
    assert.equal(start.horseCategory, 'daaga'); assert.equal(start.trackLength, 20);
    assert.equal(a.trackLength, 20); assert.equal(a.finishPosition, 21); assert.equal(a.distanceKm, 10); assert.equal(a.horseCategory, 'daaga');
    assert.equal(a.currentSeat, 0); assert.equal(a.currentPlayerId, host.session.playerId);
    assert.deepEqual(a.players.map(p => [p.name, p.seat, p.position, p.facingForward]), [['Azaa', 0, 0, false], ['Bat', 1, 0, false]]);
    assert.equal((await emit(host, 'lobby:select', { game: 'alag', trackLength: 24 })).ok, false);
    assert.equal((await emit(host, 'game:roll', {})).ok, false);
  });
  let racer = host;
  await t.test('navigation restores names, IDs, seats, game and current turn without joining', async () => {
    const token = host.session.token, id = host.session.playerId, gameId = host.horse.id;
    host.disconnect(); racer = await client(token);
    const state = await horseState(racer, s => Boolean(s));
    assert.equal(racer.session.playerId, id); assert.equal(state.id, gameId);
    assert.equal(state.currentPlayerId, id); assert.equal(state.players[0].name, 'Azaa'); assert.equal(state.players[0].seat, 0);
    assert.equal(state.horseCategory, 'daaga'); assert.equal(state.distanceKm, 10);
  });
  await t.test('rejects non-current, spectator and forged-seat actions without consuming randomness', async () => {
    const payload = { ...request(racer.horse), seat: 0, playerId: racer.session.playerId, faces: [0, 0, 0, 0], steps: 100 };
    assert.equal((await emit(guest, 'horse:throw', payload)).ok, false);
    assert.equal((await emit(spectator, 'horse:throw', payload)).ok, false);
    assert.equal((await emit(racer, 'horse:throw', { gameId: 'forged', turnNumber: 1 })).ok, false);
    assert.equal(randomCalls, 0);
  });
  const { advance, finishTitle, foalLastPlaceAnnouncement } = await import('../race-logic.mjs');
  let oldRequest;
  for (let i = 0; i < throws.length; i++) {
    await t.test('throw ' + (i + 1) + ': shared rules, synchronized position and turn', async () => {
      const before = await horseState(racer, s => s?.phase === 'ready' && (s.lastThrow?.sequence ?? 0) === i);
      const actor = before.currentPlayerId === racer.session.playerId ? racer : guest;
      const previous = before.players.find(p => p.id === before.currentPlayerId);
      const expected = advance(previous, throws[i], before.trackLength);
      const payload = request(before); oldRequest ??= payload;
      const a = waitFor(racer, 'horse:state', s => s.lastThrow?.sequence === i + 1 && s.phase === 'animating');
      const b = waitFor(guest, 'horse:state', s => s.lastThrow?.sequence === i + 1 && s.phase === 'animating');
      assert.equal((await emit(actor, 'horse:throw', { ...payload, faces: [99], position: 99, steps: 99, seat: 99 })).ok, true);
      const state = await a; assert.deepEqual(state, await b);
      assert.deepEqual(state.faces, throws[i]); assert.equal(state.faces.length, 4);
      assert.ok(state.faces.every(f => Number.isInteger(f) && f >= 0 && f <= 3));
      assert.equal(state.lastThrow.steps, expected.steps);
      assert.equal(state.players.find(p => p.id === previous.id).position, expected.position);
      assert.equal(randomCalls, (i + 1) * 4);
      assert.equal((await emit(actor, 'horse:throw', payload)).ok, false);
      assert.equal((await emit(actor, 'horse:throw', oldRequest)).ok, false);
      if (i === 10) {
        assert.equal(expected.position, 21); assert.equal(previous.position, 18);
        assert.deepEqual(state.ranking, [racer.session.playerId]); assert.equal(state.winnerId, racer.session.playerId);
      }
      const after = await horseState(racer, s => s?.lastThrow?.sequence === i + 1 && s.phase !== 'animating');
      const peer = await horseState(guest, s => s?.lastThrow?.sequence === i + 1 && s.phase !== 'animating');
      assert.deepEqual(after, peer);
      if (i < throws.length - 1) {
        const expectedId = i < 10 ? (actor === racer ? guest.session.playerId : racer.session.playerId) : guest.session.playerId;
        assert.equal(after.currentPlayerId, expectedId); assert.equal(after.turnNumber, before.turnNumber + 1);
        assert.equal(after.phase, 'ready');
      } else {
        assert.equal(after.finished, true); assert.equal(after.currentPlayerId, null);
        assert.equal(after.endReason, 'finish');
        assert.deepEqual(after.ranking, [racer.session.playerId, guest.session.playerId]);
        assert.ok(after.players.every(p => p.finished && p.position === 21));
        assert.deepEqual(after.ranking.map((_id, index) => finishTitle(index + 1)), ['Түрүү магнай', 'Аман хүзүү']);
        assert.equal(foalLastPlaceAnnouncement('daaga', after.ranking, after.players.length, after.endReason === 'finish'),
          'Энэ тоглолтын баян ходоод, ирэх тоглолтын түрүү магнай!');
        assert.equal((await emit(guest, 'horse:throw', request(after))).ok, false);
      }
    });
  }
  await t.test('a refreshed player receives the exact completed ranking and positions', async () => {
    const refreshed = await client(guest.session.token);
    const state = await horseState(refreshed, s => s?.phase === 'finished');
    assert.deepEqual(state.ranking, racer.horse.ranking); assert.deepEqual(state.players, racer.horse.players);
  });
});

test('Horse Racing uses production random faces and handles offline turns/reconnection', async t => {
  const { host, guest, client } = await fixture(t, { animationMs: 30, disconnectGraceMs: 80 });
  await startHorse(host, 24);
  const hostId = host.session.playerId, token = host.session.token;
  const disconnected = waitFor(guest, 'horse:state', s => !s.players[0].connected);
  host.disconnect(); assert.equal((await disconnected).players[0].connected, false);
  const guestTurn = await horseState(guest, s => s?.phase === 'ready' && s.currentPlayerId === guest.session.playerId);
  const staleTurn = request(guestTurn);
  assert.equal((await emit(guest, 'horse:throw', staleTurn)).ok, true);
  const rolled = await horseState(guest, s => s?.lastThrow?.sequence === 1);
  assert.equal(rolled.faces.length, 4); assert.ok(rolled.faces.every(f => Number.isInteger(f) && f >= 0 && f < 4));
  const again = await horseState(guest, s => s?.turnNumber > guestTurn.turnNumber);
  assert.equal(again.currentPlayerId, guest.session.playerId);
  assert.equal((await emit(guest, 'horse:throw', staleTurn)).ok, false);
  const returned = await client(token);
  const restored = await horseState(returned, s => s?.players[0].connected);
  assert.equal(restored.players[0].id, hostId); assert.equal(restored.trackLength, 24);
  const guestDisconnected = waitFor(returned, 'horse:state', s => !s.players[1].connected);
  guest.disconnect(); await guestDisconnected;
  const hostTurn = await horseState(returned, s => s?.currentPlayerId === hostId && s.phase === 'ready');
  assert.equal((await emit(returned, 'horse:throw', request(hostTurn))).ok, true);
  const waitingForNext = await horseState(returned, s => s?.phase === 'ready' && s.lastThrow?.sequence === 2);
  assert.equal(waitingForNext.currentPlayerId, hostId);
});

test('all offline waits safely and a reconnect resumes an unfinished race', async t => {
  const { host, guest, spectator, client } = await fixture(t, { disconnectGraceMs: 30, animationMs: 20 });
  await startHorse(host);
  const token = host.session.token;
  // An unjoined observer can inspect connection updates, but cannot play.
  const waiting = waitFor(spectator, 'horse:state', s => s.phase === 'waiting');
  host.disconnect(); guest.disconnect();
  await waiting;
  const returned = await client(token);
  const state = await horseState(returned, s => s?.phase === 'ready');
  assert.equal(state.currentPlayerId, returned.session.playerId);
  assert.equal((await emit(returned, 'horse:throw', request(state))).ok, true);
});

test('disconnect during animation keeps the accepted move and advances without waiting for acknowledgements', async t => {
  const { host, guest, client } = await fixture(t, { randomFace: () => 0, animationMs: 80, disconnectGraceMs: 1000 });
  const state = await startHorse(host, 20), token = host.session.token, id = host.session.playerId;
  assert.equal((await emit(host, 'horse:throw', request(state))).ok, true);
  host.disconnect();
  const next = await horseState(guest, s => s?.phase === 'ready' && s.currentPlayerId === guest.session.playerId);
  assert.equal(next.players[0].position, 3); assert.equal(next.players[0].connected, false);
  const resumed = await client(token);
  const restored = await horseState(resumed, s => s?.players[0].connected);
  assert.equal(restored.players[0].position, 3); assert.equal(restored.players[0].id, id);
  assert.equal((await emit(guest, 'horse:throw', request(restored))).ok, true);
  const hostTurn = await horseState(resumed, s => s?.phase === 'ready' && s.currentPlayerId === id);
  assert.equal(hostTurn.players[1].position, 3);
});
