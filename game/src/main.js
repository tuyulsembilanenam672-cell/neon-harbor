// Boot and the one loop for Neon Harbor: input is read every frame, the
// world advances in fixed 1/60 s steps (several in a slow frame, none in a
// fast one), and the renderer paints what is there. The game moves between
// four screens: title, play, paused and game over.
//
// ?seed=N fixes the city layout. ?shot=start|drive|chase|mission stages
// that scene instead of running the loop, paints it a few times and sets
// window.__shotReady for a screenshot.

import { GAME_TITLE, PLAYER, SAVE_KEY, STORY_INTRO } from './config.js';
import { createRandom } from './random.js';
import {
  EVENT_BUSTED, EVENT_KILL, EVENT_MISSION_DONE, EVENT_MISSION_FAILED,
  EVENT_PICKUP, EVENT_PUNCH, EVENT_STEAL, EVENT_WASTED, createWorld,
} from './world.js';
import {
  ACTION_ATTACK, ACTION_CONFIRM, ACTION_ENTER_CAR, ACTION_MUTE,
  ACTION_PAUSE, ACTION_SAVE, createInput,
} from './input.js';
import { createAudio } from './audio.js';
import { createRenderer } from './render.js';
import { SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;
const STEP = 1 / 60;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const minimap = document.getElementById('minimap');
const status = document.getElementById('status');
const hud = document.getElementById('hud');
const moneyEl = document.getElementById('money');
const healthFill = document.getElementById('healthFill');
const healthText = document.getElementById('healthText');
const starsEl = document.getElementById('stars');
const districtEl = document.getElementById('district');
const missionTitleEl = document.getElementById('missionTitle');
const missionObjectiveEl = document.getElementById('missionObjective');
const missionTimerEl = document.getElementById('missionTimer');
const speedoEl = document.getElementById('speedo');
const toastEl = document.getElementById('toast');
const hintEl = document.getElementById('hint');
const titleScreen = document.getElementById('titleScreen');
const pauseScreen = document.getElementById('pauseScreen');
const overScreen = document.getElementById('overScreen');
const overTitle = document.getElementById('overTitle');
const overText = document.getElementById('overText');
const storyEl = document.getElementById('story');
const continueBtn = document.getElementById('continueBtn');

const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas, minimap, world);
const audio = createAudio();

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSave() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(world.makeSave()));
    return true;
  } catch {
    return false;
  }
}

function hasSave() {
  return readSave() !== null;
}

const hudCache = { money: -1, health: -1, stars: -1, district: '', mission: '', timer: '', speed: '', hint: '' };

function updateHud(inPlay = true) {
  const s = world.state;
  const p = s.player;
  if (s.money !== hudCache.money) {
    hudCache.money = s.money;
    moneyEl.textContent = `$${s.money.toLocaleString('en-US')}`;
  }
  const hp = Math.max(0, Math.round(p.health));
  if (hp !== hudCache.health) {
    hudCache.health = hp;
    healthFill.style.width = `${hp}%`;
    healthFill.style.background = hp > 50 ? '#7cff5e' : hp > 25 ? '#ffe14d' : '#ff4444';
    healthText.textContent = `${hp}`;
  }
  if (s.wantedStars !== hudCache.stars) {
    hudCache.stars = s.wantedStars;
    starsEl.textContent = '★'.repeat(s.wantedStars) + '☆'.repeat(5 - s.wantedStars);
    starsEl.classList.toggle('hot', s.wantedStars > 0);
  }
  if (s.district !== hudCache.district) {
    hudCache.district = s.district;
    districtEl.textContent = s.district;
  }
  const m = s.mission;
  const missionText = m && m.def ? `${m.def.title}` : 'Free roam — Port Solmar is yours';
  if (missionText !== hudCache.mission) {
    hudCache.mission = missionText;
    missionTitleEl.textContent = missionText;
    missionObjectiveEl.textContent = m && m.def ? m.def.objective : 'Explore, steal cars, and stay out of trouble. Press C to save.';
  }
  const timerText = m && m.def ? `⏱ ${Math.max(0, Math.ceil(m.timeLeft))}s` : '';
  if (timerText !== hudCache.timer) {
    hudCache.timer = timerText;
    missionTimerEl.textContent = timerText;
  }
  const kmh = p.driving ? Math.round(Math.abs(p.driving.speed) * 3.6) : 0;
  const speedText = p.driving ? `${kmh} km/h` : (p.moving ? 'on foot' : '');
  if (speedText !== hudCache.speed) {
    hudCache.speed = speedText;
    speedoEl.textContent = speedText;
  }
  // Context hint: nearest car, or the mission marker direction.
  let hint = '';
  if (!p.driving && inPlay) {
    let bestD = 1e9;
    for (const car of s.cars) {
      const d = Math.hypot(p.x - car.x, p.z - car.z);
      if (d < bestD) bestD = d;
    }
    if (bestD < PLAYER.carEnterRange) hint = 'Press E to get in the car';
    else if (m && m.def) {
      const d = Math.hypot(p.x - m.markerX, p.z - m.markerZ);
      hint = `Follow the yellow beacon — ${Math.round(d)}m`;
    }
  } else if (p.driving) {
    hint = 'E to get out · Space to brake';
  }
  if (hint !== hudCache.hint) {
    hudCache.hint = hint;
    hintEl.textContent = hint;
  }
  const toasts = s.messages.map((msg) => msg.text).join('\n');
  if (toastEl.textContent !== toasts) toastEl.textContent = toasts;
}

function runShot(name) {
  storyEl.textContent = STORY_INTRO;
  const scene = stageShot(name, world);
  renderer.setTitleMode(scene.screen === SCREEN_TITLE);
  if (scene.screen === SCREEN_TITLE) {
    titleScreen.classList.remove('hidden');
    hud.classList.add('hidden');
  } else {
    titleScreen.classList.add('hidden');
    hud.classList.remove('hidden');
    updateHud();
  }
  let painted = 0;
  function paint() {
    renderer.draw(world.state, 0.016, null);
    painted += 1;
    if (painted < 4) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();
  let overReason = '';
  // One-shot presses collected once per frame; handleActions clears the
  // bits it handles (confirm/pause/mute/save) and step() takes the rest
  // (enter car / punch) on its first call that frame.
  let pendingActions = 0;

  function announce(message) {
    status.textContent = message;
  }

  function showOnly(overlay) {
    titleScreen.classList.toggle('hidden', overlay !== titleScreen);
    pauseScreen.classList.toggle('hidden', overlay !== pauseScreen);
    overScreen.classList.toggle('hidden', overlay !== overScreen);
    hud.classList.toggle('hidden', overlay === titleScreen);
    renderer.setTitleMode(overlay === titleScreen);
  }

  function startGame(fromSave) {
    world.reset();
    if (fromSave) {
      const save = readSave();
      if (save) world.applySave(save);
    }
    accumulator = 0;
    screen = SCREEN_PLAY;
    showOnly(null);
    audio.unlock();
    announce(`Playing ${GAME_TITLE}.`);
  }

  function endGame(reason) {
    overReason = reason;
    screen = SCREEN_OVER;
    audio.stopEngine();
    audio.busted();
    writeSave();
    overTitle.textContent = reason === 'busted' ? 'BUSTED!' : 'WASTED!';
    overText.textContent = reason === 'busted'
      ? 'The harbour police caught Rook. Marla Voss will have to find another driver.'
      : 'Rook went down in Port Solmar. The city keeps its secrets.';
    showOnly(overScreen);
    announce(overTitle.textContent);
  }

  function pauseGame() {
    screen = SCREEN_PAUSED;
    audio.stopEngine();
    showOnly(pauseScreen);
    announce('Paused.');
  }

  function resumeGame() {
    screen = SCREEN_PLAY;
    showOnly(null);
    announce('Playing.');
  }

  function handleEvents(events) {
    if (events & EVENT_PICKUP) audio.pickup();
    if (events & EVENT_PUNCH) audio.punch();
    if (events & EVENT_KILL) audio.hit();
    if (events & EVENT_STEAL) audio.pickup();
    if (events & EVENT_MISSION_DONE) {
      audio.missionComplete();
      writeSave();
    }
    if (events & EVENT_MISSION_FAILED) audio.missionFail();
    if (events & EVENT_BUSTED) endGame('busted');
    else if (events & EVENT_WASTED) endGame('wasted');
  }

  function handleActions() {
    const actions = pendingActions;
    // Clear the bits this function owns; enter-car / punch stay pending
    // for step() to take.
    pendingActions &= ~(ACTION_CONFIRM | ACTION_PAUSE | ACTION_MUTE | ACTION_SAVE);
    if (actions & ACTION_MUTE) {
      audio.setMuted(!audio.isMuted());
      announce(audio.isMuted() ? 'Muted.' : 'Sound on.');
    }
    if (actions & ACTION_SAVE && screen === SCREEN_PLAY) {
      const ok = writeSave();
      world.pushMessage(ok ? 'Game saved.' : 'Could not save (storage off).', 3);
    }
    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_CONFIRM) startGame(false);
    } else if (screen === SCREEN_OVER) {
      if (actions & ACTION_CONFIRM) startGame(false);
    } else if (screen === SCREEN_PLAY) {
      if (actions & ACTION_PAUSE) pauseGame();
    } else if (screen === SCREEN_PAUSED) {
      if (actions & ACTION_PAUSE || actions & ACTION_CONFIRM) resumeGame();
    }
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, { throttle: 0, steer: 0, sprint: false, brake: false }, 0);
      return;
    }
    if (screen !== SCREEN_PLAY) return;
    const actions = pendingActions;
    pendingActions = 0;
    const events = world.step(STEP, input.state(), actions);
    handleEvents(events);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    pendingActions |= input.takeActions();
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    const drag = input.takeDrag();
    renderer.draw(world.state, STEP, drag.x || drag.y ? drag : null);
    if (screen === SCREEN_PLAY) {
      const p = world.state.player;
      audio.engine(p.driving ? Math.abs(p.driving.speed) / PLAYER.driveMaxSpeed : 0, !!p.driving);
      audio.siren(STEP, world.state.wantedStars);
      updateHud();
    }
  }

  // Buttons.
  document.getElementById('startBtn').addEventListener('click', () => { audio.click(); startGame(false); });
  continueBtn.addEventListener('click', () => { audio.click(); startGame(true); });
  document.getElementById('resumeBtn').addEventListener('click', () => { audio.click(); resumeGame(); });
  document.getElementById('saveBtn').addEventListener('click', () => {
    audio.click();
    const ok = writeSave();
    world.pushMessage(ok ? 'Game saved.' : 'Could not save (storage off).', 3);
    resumeGame();
  });
  document.getElementById('pauseRestartBtn').addEventListener('click', () => { audio.click(); startGame(false); });
  document.getElementById('pauseTitleBtn').addEventListener('click', () => { audio.click(); screen = SCREEN_TITLE; showOnly(titleScreen); });
  document.getElementById('overRestartBtn').addEventListener('click', () => { audio.click(); startGame(false); });
  document.getElementById('overTitleBtn').addEventListener('click', () => { audio.click(); screen = SCREEN_TITLE; showOnly(titleScreen); });
  document.getElementById('muteBtn').addEventListener('click', () => {
    audio.setMuted(!audio.isMuted());
    document.getElementById('muteBtn').textContent = audio.isMuted() ? '🔇 Muted' : '🔊 Sound';
  });

  // Leaving the tab pauses a running game rather than letting the police close in unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) pauseGame();
  });

  storyEl.textContent = STORY_INTRO;
  if (hasSave()) continueBtn.classList.remove('hidden');
  showOnly(titleScreen);
  announce(`${GAME_TITLE}. Press Enter or click Start.`);
  // Probe handle for play-testing: window.__neon.
  window.__neon = { world, start: () => startGame(false), screen: () => screen };
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
