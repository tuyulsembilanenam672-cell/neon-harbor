// Keyboard and pointer input for Neon Harbor.
//
// Held keys give a steering state every frame; one-shot presses (enter a
// car, punch, pause, confirm) are queued as bit flags and taken once by the
// loop, so a press between two frames is never lost and never counted twice.
// Dragging the mouse orbits the third-person camera; clicking a menu button
// is left to the DOM buttons, which is why clicks on the canvas only start
// a drag.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER_CAR = 4;
export const ACTION_ATTACK = 8;
export const ACTION_MUTE = 16;
export const ACTION_SAVE = 32;

const FORWARD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const SPRINT = new Set(['ShiftLeft', 'ShiftRight']);
const BRAKE = new Set(['Space']);
const CONFIRM = new Set(['Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const ENTER_CAR = new Set(['KeyE']);
const ATTACK = new Set(['KeyF']);
const MUTE = new Set(['KeyM']);
const SAVE = new Set(['KeyC']);

export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  // Camera orbit: accumulated drag deltas, consumed by the renderer.
  let dragX = 0;
  let dragY = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      if (FORWARD.has(event.code) || BACK.has(event.code) || LEFT.has(event.code) ||
          RIGHT.has(event.code) || SPRINT.has(event.code) || BRAKE.has(event.code)) {
        held.add(event.code);
      }
      return;
    }
    if (FORWARD.has(event.code) || BACK.has(event.code) || LEFT.has(event.code) ||
        RIGHT.has(event.code) || SPRINT.has(event.code) || BRAKE.has(event.code)) {
      held.add(event.code);
    } else if (CONFIRM.has(event.code)) {
      actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      actions |= ACTION_PAUSE;
    } else if (ENTER_CAR.has(event.code)) {
      actions |= ACTION_ENTER_CAR;
    } else if (ATTACK.has(event.code)) {
      actions |= ACTION_ATTACK;
    } else if (MUTE.has(event.code)) {
      actions |= ACTION_MUTE;
    } else if (SAVE.has(event.code)) {
      actions |= ACTION_SAVE;
    } else {
      return;
    }
    // Don't scroll the page with game keys; Space is the handbrake.
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  window.addEventListener('blur', () => held.clear());

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    dragX += event.clientX - lastX;
    dragY += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
  });
  function endDrag() {
    dragging = false;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  function hasAny(set) {
    for (const code of set) if (held.has(code)) return true;
    return false;
  }

  return {
    // -1/0/1 throttle, -1/0/1 steering, sprint and brake flags.
    state() {
      return {
        throttle: (hasAny(FORWARD) ? 1 : 0) - (hasAny(BACK) ? 1 : 0),
        steer: (hasAny(LEFT) ? 1 : 0) - (hasAny(RIGHT) ? 1 : 0),
        sprint: hasAny(SPRINT),
        brake: hasAny(BRAKE),
      };
    },
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    // Camera orbit deltas since the last call, in pixels.
    takeDrag() {
      const d = { x: dragX, y: dragY };
      dragX = 0;
      dragY = 0;
      return d;
    },
    // Test / screenshot helper: pretend a key is held.
    press(code) {
      held.add(code);
    },
    release(code) {
      held.delete(code);
    },
  };
}
