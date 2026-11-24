import { createSessionStore } from './session-storage.mjs';
import { horseTrackOptions, isValidHorseRaceSelection } from './race-logic.mjs';
(() => {
  const $ = id => document.getElementById(id);
  if (typeof io !== 'function') {
    $('connection').textContent = 'Server unavailable. Open this lobby from the running multiplayer website.';
    return;
  }
  const sessionStore=createSessionStore();
  let waitingForStart=false;
  const requestedGame=new URLSearchParams(location.search).get('game');
  const preferredGame=['alag','horse'].includes(requestedGame)?requestedGame:null;
  let initialSelectionDone=false;
  const socket = io({ auth: { sessionToken: sessionStore.getItem('lan-session-token') } });
  let playerId = null;
  socket.on('session', session => {
    playerId = session.playerId;
    sessionStore.setItem('lan-session-token', session.token);
    socket.auth.sessionToken = session.token;
  });
  let state = { players: [], maxPlayers: 12, hostId: null, started: false, selectedGame: 'alag', trackLength: 18 };
  let pending = false;
  let selectionDraft = null;
  // The name and server-issued session token are remembered per tab.
  let rememberedName = '';
  try { rememberedName = sessionStore.getItem('lan-player-name') || ''; } catch {}
  $('player-name').value = rememberedName;

  function populateRaceDistances(categoryId, selectedLength) {
    const select = $('race-length');
    const options = horseTrackOptions(categoryId);
    select.replaceChildren(new Option('Замын зайг сонгоно уу', ''));
    for (const option of options) {
      select.add(new Option(`${option.kilometers} км · ${option.trackLength} шагай`, String(option.trackLength)));
    }
    select.value = selectedLength == null ? '' : String(selectedLength);
  }

  function settingsMatch(snapshot, draft) {
    return snapshot.selectedGame === draft.game &&
      snapshot.trackLength === draft.trackLength &&
      (draft.game !== 'horse' || snapshot.horseCategory === draft.horseCategory);
  }

  function render() {
    const me = state.players.find(player => player.id === playerId);
    const host = state.players.find(player => player.id === state.hostId);
    const isHost = Boolean(me && me.id === state.hostId);
    $('player-count').textContent = `${state.players.length} / ${state.maxPlayers}`;
    $('players').replaceChildren(...state.players.map(player => {
      const item = document.createElement('li');
      item.value = player.seat + 1;
      item.textContent = `Seat ${player.seat + 1}: ${player.name}${player.id === state.hostId ? ' — Host' : ''}${player.id === playerId ? ' (you)' : ''}`;
      return item;
    }));
    $('empty').hidden = state.players.length > 0;
    $('player-name').disabled = Boolean(me) || pending;
    $('join').disabled = !socket.connected || Boolean(me) || pending || state.players.length >= state.maxPlayers;
    $('join').textContent = me ? 'Joined' : 'Join Game';
    $('start').hidden = !isHost||state.started;
    $('resume').hidden=!(me&&state.started);
    if (preferredGame && isHost && !state.started && !initialSelectionDone && !selectionDraft &&
        !pending && socket.connected && state.selectedGame !== preferredGame) {
      selectionDraft = {
        game: preferredGame,
        horseCategory: '',
        trackLength: preferredGame === 'horse' ? null : ([12, 18, 24].includes(state.trackLength) ? state.trackLength : 18)
      };
      if (preferredGame === 'alag') {
        initialSelectionDone = true;
        const draft = selectionDraft;
        queueMicrotask(() => request('lobby:select', { game: draft.game, trackLength: draft.trackLength }));
      }
    }
    const settings = selectionDraft || {
      game: state.selectedGame || 'alag',
      horseCategory: state.selectedGame === 'horse' ? state.horseCategory || '' : '',
      trackLength: state.selectedGame === 'horse' ? state.trackLength : null
    };
    const horseSelected = settings.game === 'horse';
    $('game-choice').value = settings.game;
    $('horse-age-label').hidden = !horseSelected;
    $('horse-category').hidden = !horseSelected;
    $('horse-category').value = settings.horseCategory || '';
    $('race-length-label').hidden = !horseSelected;
    $('race-length').hidden = !horseSelected;
    populateRaceDistances(settings.horseCategory, settings.trackLength);
    $('game-choice').disabled = !isHost || !socket.connected || pending || state.started;
    $('horse-category').disabled = !isHost || !socket.connected || pending || state.started || !horseSelected;
    $('race-length').disabled = !isHost || !socket.connected || pending || state.started || !horseSelected || !settings.horseCategory;
    $('start').disabled = !socket.connected || pending || state.started || settings.game !== state.selectedGame ||
      (state.selectedGame === 'horse' && !isValidHorseRaceSelection(state.horseCategory, state.trackLength));
    $('status').textContent = state.started
      ? (me?'Your saved game is ready. Return without joining again.':'A game is already in progress.')
      : horseSelected && (!settings.horseCategory || settings.trackLength == null)
        ? 'Уралдааны насны ангилал болон яг замын зайг сонгоно уу.'
      : me ? (isHost ? 'You are the host. Start when everyone has joined.' : `Waiting for ${host?.name || 'the host'} to start.`)
        : state.players.length >= state.maxPlayers ? 'The lobby is full.' : 'Enter your name and press Join Game.';
  }

  function request(event, payload) {
    pending = true;
    $('error').textContent = '';
    render();
    const done = (error, response) => {
      pending = false;
      if (error) $('error').textContent = 'The server did not respond. Reconnect or try again.';
      else if (!response?.ok) $('error').textContent = response?.error || 'The request was rejected.';
      else if (event === 'lobby:join') {
        rememberedName = payload.name.trim();
        try { sessionStore.setItem('lan-player-name', rememberedName); } catch {}
      }
      render();
    };
    if (payload === undefined) socket.timeout(5000).emit(event, done);
    else socket.timeout(5000).emit(event, payload, done);
  }

  socket.on('connect', () => {
    $('connection').textContent = 'Connected to the multiplayer server.';
    $('error').textContent = '';
    pending = false;
    render();
  });
  function navigateToGame() {
    if (!state.started || !state.players.some(p => p.id === playerId)) return;
    // Only known server-selected game IDs map to local pages; never accept a redirect URL.
    const pages = { alag: 'turtle.html?lan=1', horse: 'race.html?lan=1' };
    if (pages[state.selectedGame]) location.replace(pages[state.selectedGame]);
  }
  socket.on('lobby:state', snapshot => {
    state = snapshot;
    if (selectionDraft && settingsMatch(state, selectionDraft)) selectionDraft = null;
    if(!state.started&&state.players.some(p=>p.id===playerId))waitingForStart=true;
    render();
    if(waitingForStart)navigateToGame();
  });
  socket.on('disconnect', () => {
    state = { players: [], maxPlayers: 12, hostId: null, started: false, selectedGame: 'alag', trackLength: 18 };
    pending = false;
    $('connection').textContent = 'Disconnected. Reconnecting… Your seat will be restored automatically.';
    render();
  });
  socket.on('connect_error', () => {
    $('connection').textContent = 'Cannot reach the multiplayer server. Check your connection and reload this website.';
    render();
  });
  $('join-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('join').disabled) request('lobby:join', { name: $('player-name').value });
  });
  $('resume').addEventListener('click',navigateToGame);
  socket.on('session:invalid',()=>{sessionStore.removeItem('lan-session-token');socket.auth.sessionToken=null;playerId=null;render();$('error').textContent='Saved session expired. Join again.';});
  $('start').addEventListener('click', () => {
    if (!$('start').disabled) request('lobby:start');
  });
  function selectGame() {
    const game = $('game-choice').value;
    if (game === 'horse') {
      const horseCategory = $('horse-category').value;
      const trackLength = Number($('race-length').value);
      selectionDraft = { game, horseCategory, trackLength: Number.isInteger(trackLength) && trackLength > 0 ? trackLength : null };
      if (!isValidHorseRaceSelection(horseCategory, trackLength)) {
        $('error').textContent = 'Морь уралдуулахын тулд насны ангилал, замын зайг сонгоно уу.';
        render();
        return;
      }
      initialSelectionDone = true;
      request('lobby:select', { game, horseCategory, trackLength });
      return;
    }
    const trackLength = [12, 18, 24].includes(state.trackLength) ? state.trackLength : 18;
    selectionDraft = { game, horseCategory: '', trackLength };
    initialSelectionDone = true;
    request('lobby:select', { game, trackLength });
  }
  $('game-choice').addEventListener('change', selectGame);
  $('horse-category').addEventListener('change', () => {
    selectionDraft = { game: 'horse', horseCategory: $('horse-category').value, trackLength: null };
    $('error').textContent = '';
    render();
  });
  $('race-length').addEventListener('change', selectGame);
  render();
})();
