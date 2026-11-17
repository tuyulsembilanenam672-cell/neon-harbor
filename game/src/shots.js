// The screenshot scenes behind ?shot=start|drive|chase|mission. Each one
// plays the real rules forward from a fresh world for a fixed number of
// steps, steered by a simple autopilot (drive along the street, steer toward
// the mission marker), so the frame is what a short game really looks like
// and the same seed always gives the same frame.

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const STEP = 1 / 60;

function idleInput() {
  return { throttle: 0, steer: 0, sprint: false, brake: false };
}

function driveInput() {
  return { throttle: 1, steer: 0, sprint: false, brake: false };
}

// Drive straight along the street for `seconds` (steering off-street would
// wedge the car into a building; the street is the shot).
function autopilotDrive(world, seconds) {
  const steps = Math.floor(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    const s = world.state;
    world.step(STEP, { throttle: 1, steer: 0, sprint: false, brake: false }, 0);
    if (s.player.health <= 0) break;
  }
}

// Put the player in the nearest parked car and drive off.
function stealAndDrive(world) {
  const s = world.state;
  let best = null;
  let bestD = 1e9;
  for (const car of s.cars) {
    if (car.kind !== 'parked') continue;
    const d = Math.hypot(s.player.x - car.x, s.player.z - car.z);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  if (best) {
    s.player.x = best.x + 2;
    s.player.z = best.z;
    world.step(STEP, idleInput(), 4); // ACTION_ENTER_CAR
  }
}

/**
 * Set `world` to the named scene and return the screen to draw over it.
 * Names: start (title over the city), drive (mission 1, driving), chase
 * (mission 2, wanted 3, police pursuit), mission (job 3 turf war, on foot).
 */
export function stageShot(name, world) {
  world.reset();
  const s = world.state;
  if (name === 'start') {
    for (let i = 0; i < 5 / STEP; i += 1) world.step(STEP, idleInput(), 0);
    return { screen: SCREEN_TITLE };
  }
  if (name === 'drive') {
    stealAndDrive(world);
    autopilotDrive(world, 6);
    // Follow camera: behind the car, looking down the street ahead.
    s.camYaw = s.player.heading + Math.PI;
    return { screen: SCREEN_PLAY };
  }
  if (name === 'chase') {
    world.setMission(1);
    s.messages.length = 0;
    stealAndDrive(world);
    world.addHeat(2);
    autopilotDrive(world, 7);
    world.addHeat(1);
    autopilotDrive(world, 2);
    // Front camera: the player car drives toward the lens with the police
    // cruisers visible chasing behind it.
    s.camYaw = s.player.heading;
    return { screen: SCREEN_PLAY };
  }
  if (name === 'mission') {
    world.setMission(2);
    s.messages.length = 0;
    const def = s.mission.def;
    // Stand right on the pickup so the fight triggers at once.
    s.player.x = def.pickup.x + 2;
    s.player.z = def.pickup.z + 2;
    s.player.heading = Math.atan2(def.pickup.x - s.player.x, def.pickup.z - s.player.z);
    // Camera south of the player, looking north at the beacon and the Vipers.
    s.camYaw = 0;
    // Walk into the pickup to trigger the fight.
    for (let i = 0; i < 4 / STEP; i += 1) {
      world.step(STEP, idleInput(), 0);
      if (s.mission.phase === 'fight') break;
    }
    // Let the Vipers close in, and throw one punch.
    for (let i = 0; i < 2.5 / STEP; i += 1) world.step(STEP, idleInput(), i === 30 ? 8 : 0);
    return { screen: SCREEN_PLAY };
  }
  // Unknown name: title.
  return { screen: SCREEN_TITLE };
}
