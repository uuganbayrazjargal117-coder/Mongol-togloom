const { test } = require('node:test');
const assert = require('node:assert/strict');

function fakeCanvas(rect) {
  const handlers = new Map();
  return {
    style: {},
    addEventListener(name, callback) { handlers.set(name, callback); },
    removeEventListener(name) { handlers.delete(name); },
    getBoundingClientRect() { return rect; },
    setPointerCapture() {},
    releasePointerCapture() {},
    dispatch(name, event) { handlers.get(name)?.(event); }
  };
}

function pointer(pointerId, pointerType, clientX, clientY, button = 0) {
  return {
    pointerId, pointerType, clientX, clientY, button,
    preventDefault() { this.defaultPrevented = true; }
  };
}

test('desktop drag and wheel navigation pause follow, stay bounded, then resume smoothly', async () => {
  const { createHorseCameraController, HORSE_CAMERA_IDLE_MS, HORSE_CAMERA_MIN_ZOOM } = await import('../horse-camera.mjs');
  let time = 100;
  const rect = { left: 40, top: 20, width: 200, height: 130 };
  const camera = createHorseCameraController({
    getViewport: () => rect,
    getFrame: () => ({ width: 20, height: 13 }),
    getBounds: () => ({ minX: -15, maxX: 15, minZ: -10, maxZ: 10 }),
    now: () => time
  });
  const canvas = fakeCanvas(rect), detach = camera.attach(canvas);
  assert.equal(camera.isFollowing(), true);
  assert.equal(canvas.style.touchAction, 'none');

  const down = pointer(1, 'mouse', 100, 80);
  canvas.dispatch('pointerdown', down);
  canvas.dispatch('pointermove', pointer(1, 'mouse', 10000, 10000));
  canvas.dispatch('pointerup', pointer(1, 'mouse', 10000, 10000));
  assert.equal(down.defaultPrevented, true);
  assert.equal(camera.isFollowing(), false);
  const panned = camera.getState().focus;
  assert.ok(panned.x <= 5 && panned.z <= 3.5);

  const wheel = { deltaY: -120, clientX: 140, clientY: 85, preventDefault() { this.defaultPrevented = true; } };
  canvas.dispatch('wheel', wheel);
  assert.equal(wheel.defaultPrevented, true);
  const zoomed = camera.getState();
  assert.ok(zoomed.zoom > 1);
  assert.ok(zoomed.zoom <= 2.5);

  time += HORSE_CAMERA_IDLE_MS + 1;
  const resumed = camera.updateFollow({ x: 0, z: 0 }, 16, time);
  assert.equal(camera.isFollowing(time), true);
  assert.ok(resumed.focus.x > zoomed.focus.x);
  assert.ok(resumed.focus.x < 0);
  let follow = resumed;
  for (let i = 0; i < 80; i++) follow = camera.updateFollow({ x: 0, z: 0 }, 16, time + i * 16);
  assert.ok(Math.abs(follow.focus.x) < Math.abs(resumed.focus.x));
  canvas.dispatch('wheel', { deltaY: 10000, clientX: 140, clientY: 85, preventDefault() {} });
  assert.equal(camera.getState().zoom, HORSE_CAMERA_MIN_ZOOM);
  detach();
});

test('mobile pinch zoom and one-finger pan suspend automatic following', async () => {
  const { createHorseCameraController, HORSE_CAMERA_IDLE_MS, HORSE_CAMERA_MAX_ZOOM } =
    await import('../horse-camera.mjs');
  let time = 500;
  const rect = { left: 0, top: 0, width: 240, height: 160 };
  const camera = createHorseCameraController({
    getViewport: () => rect,
    getFrame: () => ({ width: 24, height: 16 }),
    getBounds: () => ({ minX: -60, maxX: 60, minZ: -30, maxZ: 30 }),
    now: () => time
  });
  const canvas = fakeCanvas(rect);
  camera.attach(canvas);
  canvas.dispatch('pointerdown', pointer(1, 'touch', 80, 80));
  canvas.dispatch('pointerdown', pointer(2, 'touch', 160, 80));
  canvas.dispatch('pointermove', pointer(2, 'touch', 200, 80));
  assert.ok(camera.getState().zoom > 1);
  assert.equal(camera.isFollowing(), false);

  canvas.dispatch('pointerup', pointer(2, 'touch', 200, 80));
  const beforePan = camera.getState().focus.x;
  canvas.dispatch('pointermove', pointer(1, 'touch', 100, 80));
  assert.notEqual(camera.getState().focus.x, beforePan);
  canvas.dispatch('pointerup', pointer(1, 'touch', 100, 80));

  canvas.dispatch('wheel', { deltaY: -10000, clientX: 120, clientY: 80, preventDefault() {} });
  assert.equal(camera.getState().zoom, HORSE_CAMERA_MAX_ZOOM);
  time += HORSE_CAMERA_IDLE_MS + 1;
  const target = { x: 20, z: 5 }, start = camera.getState().focus;
  const step = camera.updateFollow(target, 16, time);
  assert.equal(camera.isFollowing(time), true);
  assert.ok(Math.hypot(step.focus.x - start.x, step.focus.z - start.z) < Math.hypot(target.x - start.x, target.z - start.z));
});

test('camera bounds keep both ends of every supported curved track reachable', async () => {
  const { buildHorseTrackLayout } = await import('../race-logic.mjs');
  const { createHorseCameraController, horseCameraBounds } = await import('../horse-camera.mjs');
  const rect = { left: 0, top: 0, width: 200, height: 130 };
  for (const trackLength of [20, 24, 28, 34, 40, 48, 52]) {
    const layout = buildHorseTrackLayout(trackLength), bounds = horseCameraBounds(layout.path, 2);
    const camera = createHorseCameraController({
      getViewport: () => rect, getFrame: () => ({ width: 20, height: 13 }), getBounds: () => bounds
    });
    for (const endpoint of [layout.path[0], layout.path[layout.finishPosition]]) {
      camera.focusOn(endpoint);
      const { focus, zoom } = camera.getState();
      assert.ok(Math.abs(endpoint.x - focus.x) <= 10 / zoom);
      assert.ok(Math.abs(endpoint.z - focus.z) <= 6.5 / zoom);
    }
  }
});
