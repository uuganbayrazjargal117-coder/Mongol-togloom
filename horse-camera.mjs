export const HORSE_CAMERA_IDLE_MS = 5000;
export const HORSE_CAMERA_MIN_ZOOM = 0.65;
export const HORSE_CAMERA_MAX_ZOOM = 2.5;

export function horseCameraBounds(points, padding = 1) {
  if (!Array.isArray(points) || points.length === 0 || !Number.isFinite(padding) || padding < 0) {
    throw new RangeError('Camera bounds require points and nonnegative padding.');
  }
  const xs = points.map(point => point.x), zs = points.map(point => point.z);
  if (xs.some(value => !Number.isFinite(value)) || zs.some(value => !Number.isFinite(value))) {
    throw new RangeError('Camera bounds require finite point coordinates.');
  }
  return {
    minX: Math.min(...xs) - padding, maxX: Math.max(...xs) + padding,
    minZ: Math.min(...zs) - padding, maxZ: Math.max(...zs) + padding
  };
}

export function createHorseCameraController({ getViewport, getFrame, getBounds, now = () => performance.now() }) {
  let focus = { x: 0, z: 0 };
  let zoom = 1;
  let manualUntil = 0;
  const pointers = new Map();
  let gesture = null;

  function state() {
    return { focus: { ...focus }, zoom };
  }

  function clamped(nextFocus) {
    const bounds = getBounds();
    if (!bounds) return nextFocus;
    const frame = getFrame();
    const halfWidth = frame.width / (2 * zoom);
    const halfHeight = frame.height / (2 * zoom);
    const axis = (value, min, max, half) => {
      const lower = min + half, upper = max - half;
      return lower > upper ? (min + max) / 2 : Math.max(lower, Math.min(upper, value));
    };
    return {
      x: axis(nextFocus.x, bounds.minX, bounds.maxX, halfWidth),
      z: axis(nextFocus.z, bounds.minZ, bounds.maxZ, halfHeight)
    };
  }

  function suspendFollow() {
    manualUntil = now() + HORSE_CAMERA_IDLE_MS;
  }

  function focusOn(point) {
    focus = clamped({ x: point.x, z: point.z });
    manualUntil = 0;
  }

  function panBy(dx, dy, rect = getViewport()) {
    if (!rect?.width || !rect?.height) return;
    const frame = getFrame();
    focus = clamped({
      x: focus.x - dx * frame.width / (zoom * rect.width),
      z: focus.z + dy * frame.height / (zoom * rect.height)
    });
    suspendFollow();
  }

  function zoomAt(factor, clientX, clientY, rect = getViewport()) {
    if (!rect?.width || !rect?.height || !Number.isFinite(factor) || factor <= 0) return;
    const frame = getFrame();
    const x = clientX - rect.left, y = clientY - rect.top;
    const anchor = {
      x: focus.x + (x - rect.width / 2) * frame.width / (zoom * rect.width),
      z: focus.z + (y - rect.height / 2) * frame.height / (zoom * rect.height)
    };
    zoom = Math.max(HORSE_CAMERA_MIN_ZOOM, Math.min(HORSE_CAMERA_MAX_ZOOM, zoom * factor));
    focus = clamped({
      x: anchor.x - (x - rect.width / 2) * frame.width / (zoom * rect.width),
      z: anchor.z - (y - rect.height / 2) * frame.height / (zoom * rect.height)
    });
    suspendFollow();
  }

  function updateFollow(target, deltaMs, timestamp = now()) {
    if (target && timestamp >= manualUntil) {
      const elapsed = Math.min(50, Math.max(0, deltaMs));
      const amount = 1 - Math.exp(-elapsed / 320);
      focus = clamped({
        x: focus.x + (target.x - focus.x) * amount,
        z: focus.z + (target.z - focus.z) * amount
      });
    }
    return state();
  }

  function onPointerDown(canvas, event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      gesture = { kind: 'pan', ...pointers.get(event.pointerId) };
    } else if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      gesture = {
        kind: 'pinch',
        distance: Math.hypot(b.x - a.x, b.y - a.y),
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2
      };
    }
  }

  function onPointerMove(event) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture?.kind === 'pan' && pointers.size === 1) {
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (Math.hypot(dx, dy) > 1) panBy(dx, dy);
      gesture = { kind: 'pan', x: event.clientX, y: event.clientY };
    } else if (gesture?.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      if (gesture.distance > 0 && Math.abs(distance - gesture.distance) > 1) {
        zoomAt(distance / gesture.distance, (x + gesture.x) / 2, (y + gesture.y) / 2);
      }
      gesture = { kind: 'pinch', distance, x, y };
    }
  }

  function onPointerUp(event) {
    pointers.delete(event.pointerId);
    if (pointers.size === 1) {
      const remaining = [...pointers.values()][0];
      gesture = { kind: 'pan', ...remaining };
    } else if (!pointers.size) {
      gesture = null;
    }
  }

  function attach(canvas) {
    canvas.style.touchAction = 'none';
    const down = event => onPointerDown(canvas, event);
    const up = event => onPointerUp(event);
    const wheel = event => {
      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * 0.001), event.clientX, event.clientY, canvas.getBoundingClientRect());
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }

  return {
    attach, focusOn, panBy, zoomAt, updateFollow,
    isFollowing: (timestamp = now()) => timestamp >= manualUntil,
    getState: state
  };
}
