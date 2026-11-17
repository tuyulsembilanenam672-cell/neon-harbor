// Neon Harbor — central tuning, city layout and story data.
//
// Port Solmar is an invented harbour city: neon signs, a fish market, a
// casino, container docks and steep northern streets. Every name, person,
// vehicle and place in this file is original.
//
// You play Rook, an ex-getaway driver who drifted back to Port Solmar with
// no money and a burned reputation. Fixer Marla Voss hands him three jobs.
// Finish them and the docks — and Rook's way out — are his.

export const GAME_TITLE = 'Neon Harbor';
export const CITY_NAME = 'Port Solmar';
export const PLAYER_NAME = 'Rook';
export const FIXER_NAME = 'Marla Voss';

// ---------------------------------------------------------------------------
// City layout
// ---------------------------------------------------------------------------
// The city is a flat grid. Streets run every (blockSize + streetWidth)
// metres; the harbour waterfront is the south edge (positive z) and the
// hills rise to the north (negative z). Buildings fill the blocks between
// streets, with pavements around each block.
export const WORLD = {
  blocksX: 9,
  blocksZ: 9,
  blockSize: 48,
  streetWidth: 14,
  sidewalkWidth: 3,
  // Half the city span in metres, used for clamping, spawning and the map.
  get halfExtent() {
    return (this.blocksX * (this.blockSize + this.streetWidth)) / 2;
  },
  get halfDepth() {
    return (this.blocksZ * (this.blockSize + this.streetWidth)) / 2;
  },
};

// Named districts, shown on the HUD when the player crosses into one.
export const DISTRICTS = [
  { name: 'Harbourfront', x0: -280, z0: 110, x1: 280, z1: 280 },
  { name: 'Old Market', x0: -280, z0: -40, x1: -60, z1: 110 },
  { name: 'Casino Row', x0: -60, z0: -40, x1: 140, z1: 110 },
  { name: 'The Docks', x0: 140, z0: -40, x1: 280, z1: 110 },
  { name: 'North Hills', x0: -280, z0: -280, x1: 280, z1: -40 },
];

// ---------------------------------------------------------------------------
// Look: a warm sunset that never quite sets over the harbour.
// ---------------------------------------------------------------------------
export const PALETTE = {
  skyTop: 0x241a55,
  skyBottom: 0xff8c42,
  sunColor: 0xffb347,
  fogColor: 0x3a2a55,
  asphalt: 0x23232e,
  sidewalk: 0x6f6f7c,
  laneMark: 0xd8d8c0,
  buildingColors: [0x8f5fa8, 0x4a7fa5, 0xc96f4a, 0x5aa58a, 0xa88f4a, 0x7a5a9e, 0x3f6d8e],
  neonColors: [0xff2e88, 0x00e5ff, 0xffe14d, 0x7cff5e, 0xff6b35],
  policeColor: 0x2a3cff,
  policeLightRed: 0xff2222,
  policeLightBlue: 0x2244ff,
  taxiColor: 0xffc93c,
  waterColor: 0x1d4e6b,
};

// ---------------------------------------------------------------------------
// Controls — WASD to move/drive, E to get in or steal a car, F to fight.
// ---------------------------------------------------------------------------
export const CONTROLS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  brake: 'Space',
  enterCar: 'KeyE',
  attack: 'KeyF',
  sprint: 'ShiftLeft',
  pause: 'KeyP',
  mute: 'KeyM',
  restart: 'KeyR',
};

// ---------------------------------------------------------------------------
// Wanted level: 0–5 stars. Crimes add heat; staying out of police sight
// cools it off. More stars bring more (and faster) police units.
// ---------------------------------------------------------------------------
export const WANTED = {
  maxStars: 5,
  stealCarHeat: 1,
  assaultHeat: 1,
  killHeat: 2,
  missionHeat: 1,
  decayPerSecondHidden: 0.12,
  decayPerSecondSeen: 0.02,
  policePerStar: 2,
  arrestDistance: 3.2,
  arrestTimeSeconds: 2.5,
  // Below this speed (m/s) while hidden, the player counts as "laying low".
  layLowSpeed: 1.5,
};

// ---------------------------------------------------------------------------
// Population: traffic cars and pedestrians roaming the streets.
// ---------------------------------------------------------------------------
export const POPULATION = {
  trafficCars: 14,
  pedestrians: 24,
  policeMax: 10,
  pedSpeedMin: 1.2,
  pedSpeedMax: 2.4,
  trafficSpeedMin: 7,
  trafficSpeedMax: 12,
  // How far ahead of the player new traffic/peds may spawn, in metres.
  spawnRadius: 220,
};

// ---------------------------------------------------------------------------
// Player, cars and combat tuning.
// ---------------------------------------------------------------------------
export const PLAYER = {
  walkSpeed: 6,
  sprintSpeed: 9.5,
  maxHealth: 100,
  punchDamage: 25,
  punchRange: 2.4,
  punchCooldown: 0.45,
  driveAccel: 22,
  driveMaxSpeed: 34,
  driveReverseSpeed: 10,
  driveTurn: 1.9,
  carEnterRange: 4.5,
  // Health slowly returns when the player is out of trouble.
  regenPerSecond: 1.5,
  regenDelaySeconds: 6,
};

// Enemy (Rust Viper) tuning for the turf-war mission.
export const ENEMY = {
  health: 50,
  damage: 8,
  attackRange: 2.2,
  attackCooldown: 0.9,
  chaseSpeed: 4.2,
  count: 6,
};

// Camera: third-person follow, pulled back and higher while driving.
export const CAMERA = {
  walkDistance: 9,
  walkHeight: 4.5,
  driveDistance: 13,
  driveHeight: 6,
  lookAhead: 6,
};

// ---------------------------------------------------------------------------
// Missions — three jobs from Marla Voss, in order. The third ends the
// story; after that the player keeps free-roaming Port Solmar.
// ---------------------------------------------------------------------------
export const MISSIONS = [
  {
    id: 'courier',
    title: 'Job 1 — Harbor Courier',
    giver: 'Marla Voss',
    briefing:
      'Marla: "Rook. A package is waiting at the fish market. Take it to ' +
      'the north garage, no questions, no cops — and $400 is yours."',
    objective: 'Pick up the package at the fish market, then deliver it to the north garage.',
    pickup: { x: -120, z: 120 },
    dropoff: { x: 120, z: -120 },
    reward: 400,
    timeLimitSeconds: 150,
  },
  {
    id: 'getaway',
    title: 'Job 2 — The Getaway',
    giver: 'Marla Voss',
    briefing:
      'Marla: "My crew just hit the Solmar casino vault. They need a driver, ' +
      'not a hero. Fetch them, then get to the safehouse before the harbour police box you in."',
    objective: 'Reach the casino, pick up the crew, then lose the police and reach the safehouse.',
    pickup: { x: 60, z: 60 },
    dropoff: { x: -150, z: -60 },
    reward: 900,
    timeLimitSeconds: 180,
    // Picking up the crew puts the police on the player at once.
    pickupHeat: 2,
  },
  {
    id: 'turf',
    title: 'Job 3 — Docks Turf War',
    giver: 'Marla Voss',
    briefing:
      'Marla: "The Rust Vipers own the docks, and they taxed my last driver ' +
      'to death. Clear them out and the docks — and this city — are ours."',
    objective: 'Defeat the Rust Vipers guarding the docks. Watch your health.',
    pickup: { x: 0, z: 150 },
    dropoff: { x: 0, z: 150 },
    reward: 1500,
    timeLimitSeconds: 240,
    enemies: 6,
  },
];

// Intro text shown on the start screen.
export const STORY_INTRO =
  'Port Solmar, 9:47 PM. Rook came home with empty pockets and a burned ' +
  'reputation. One phone call from Marla Voss changes everything: three ' +
  'jobs, one city, and a way out — if the harbour police don\'t catch him first.';

// ---------------------------------------------------------------------------
// Save game (localStorage).
// ---------------------------------------------------------------------------
export const SAVE_KEY = 'neon-harbor-save-v1';

export function defaultSave() {
  return {
    money: 0,
    missionIndex: 0,
    missionsDone: [],
    player: { x: 0, z: 40 },
    health: PLAYER.maxHealth,
    savedAt: Date.now(),
  };
}
