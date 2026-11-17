// The game's rules and state, with no drawing and no browser in it: the
// city of Port Solmar, the player on foot and in cars, traffic, pedestrians,
// police, the wanted level, combat and Marla Voss's three missions.
//
// step() advances one fixed step and returns what happened as bit flags, so
// the caller can react (sounds, screens) without the world knowing about
// screens or sound. The renderer reads world.state and draws it.

import {
  CAMERA, DISTRICTS, ENEMY, MISSIONS, PALETTE, PLAYER, POPULATION, WANTED, WORLD,
} from './config.js';
import { angleDelta, clamp, dist2d } from './random.js';

export const EVENT_PICKUP = 1;
export const EVENT_MISSION_DONE = 2;
export const EVENT_BUSTED = 4;
export const EVENT_WASTED = 8;
export const EVENT_PUNCH = 16;
export const EVENT_STEAL = 32;
export const EVENT_MISSION_FAILED = 64;
export const EVENT_HURT = 128;
export const EVENT_KILL = 256;

// Street centrelines, shared by traffic, spawning and the minimap.
export function streetLines() {
  const lines = [];
  for (let k = 0; k <= WORLD.blocksX; k += 1) {
    lines.push(-WORLD.halfExtent + k * (WORLD.blockSize + WORLD.streetWidth));
  }
  return lines;
}

const CAR_COLORS = [0xd8d8d8, 0x2a2a33, 0xb03a2e, 0x2e6db0, 0xd8a03a, 0x4a8f5a, 0x7a4a9e, 0x8a8f96];
const PED_COLORS = [0xe8b88a, 0x8a5a3a, 0xd8d8d8, 0x3a6db0, 0xb03a6e, 0x4a4a55, 0xe0c060, 0x6ab06a];

export function createWorld(random) {
  const streets = streetLines();
  const state = {
    elapsed: 0,
    money: 0,
    buildings: [],
    cars: [],
    peds: [],
    enemies: [],
    wantedHeat: 0,
    wantedStars: 0,
    arrestTimer: 0,
    district: 'Harbourfront',
    camYaw: Math.PI,
    camPitch: 0.32,
    camDistance: CAMERA.walkDistance,
    mission: null,
    messages: [],
    player: null,
    nextCarId: 1,
  };

  // ------------------------------------------------------------------
  // City generation
  // ------------------------------------------------------------------
  function buildCity() {
    state.buildings = [];
    for (let bx = 0; bx < WORLD.blocksX; bx += 1) {
      for (let bz = 0; bz < WORLD.blocksZ; bz += 1) {
        const x0 = streets[bx] + WORLD.streetWidth / 2 + WORLD.sidewalkWidth;
        const z0 = streets[bz] + WORLD.streetWidth / 2 + WORLD.sidewalkWidth;
        const inner = WORLD.blockSize - WORLD.sidewalkWidth * 2;
        // The docks block (east, mid) is low warehouses; the casino block
        // is one tall tower; the rest are 2x2 buildings per block.
        const isDocks = bx === 8 && bz >= 3 && bz <= 5;
        const isCasino = bx === 3 && bz === 4;
        if (isCasino) {
          state.buildings.push({
            x: x0 + inner / 2, z: z0 + inner / 2, w: inner * 0.8, d: inner * 0.8,
            h: 64, color: 0xc9a227, neon: 0xff2e88, landmark: 'casino',
          });
          continue;
        }
        if (isDocks) {
          state.buildings.push({
            x: x0 + inner / 2, z: z0 + inner / 2, w: inner * 0.9, d: inner * 0.45,
            h: 10, color: 0x5a6a72, neon: 0x00e5ff, landmark: 'warehouse',
          });
          continue;
        }
        const cell = inner / 2;
        for (let ix = 0; ix < 2; ix += 1) {
          for (let iz = 0; iz < 2; iz += 1) {
            if (random.chance(0.12)) continue; // occasional plaza / empty lot
            const cx = x0 + cell * (ix + 0.5);
            const cz = z0 + cell * (iz + 0.5);
            // Taller toward the city centre and the north hills.
            const centreBoost = 1 - (Math.abs(cx) + Math.abs(cz)) / (WORLD.halfExtent * 2);
            const h = 8 + random.range(0, 26) + centreBoost * 22;
            state.buildings.push({
              x: cx, z: cz, w: cell * 0.86, d: cell * 0.86, h,
              color: random.pick(PALETTE.buildingColors),
              neon: random.chance(0.3) ? random.pick(PALETTE.neonColors) : 0,
              landmark: '',
            });
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Spawning
  // ------------------------------------------------------------------
  function nearestStreetCoord(v) {
    let best = streets[0];
    for (const s of streets) if (Math.abs(s - v) < Math.abs(best - v)) best = s;
    return best;
  }

  function randomStreetPoint() {
    const axis = random.chance(0.5) ? 'x' : 'z';
    const line = random.pick(streets);
    const along = random.range(-WORLD.halfExtent + 10, WORLD.halfExtent - 10);
    return axis === 'x' ? { x: along, z: line } : { x: line, z: along };
  }

  function makeCar(kind, x, z, heading) {
    const car = {
      id: state.nextCarId,
      kind, // 'parked' | 'traffic' | 'taxi' | 'police'
      x, z, heading,
      speed: 0,
      color: kind === 'police' ? 0xe8e8e8 : kind === 'taxi' ? PALETTE.taxiColor : random.pick(CAR_COLORS),
      axis: random.chance(0.5) ? 'x' : 'z',
      dir: random.chance(0.5) ? 1 : -1,
      lane: random.chance(0.5) ? 3.5 : -3.5,
      targetSpeed: random.range(POPULATION.trafficSpeedMin, POPULATION.trafficSpeedMax),
      hasDriver: kind === 'traffic' || kind === 'taxi',
      wheelSpin: 0,
      sirenPhase: random.range(0, 1),
      ramCooldown: 0,
    };
    state.nextCarId += 1;
    return car;
  }

  function spawnTraffic() {
    while (state.cars.filter((c) => c.kind === 'traffic' || c.kind === 'taxi').length < POPULATION.trafficCars) {
      const p = randomStreetPoint();
      const car = makeCar(random.chance(0.15) ? 'taxi' : 'traffic', p.x, p.z, 0);
      car.axis = Math.abs(p.x - nearestStreetCoord(p.x)) < Math.abs(p.z - nearestStreetCoord(p.z)) ? 'z' : 'x';
      car.heading = car.axis === 'x' ? (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (car.dir > 0 ? 0 : Math.PI);
      car.speed = car.targetSpeed;
      state.cars.push(car);
    }
  }

  function spawnParked() {
    // Parked cars line the streets near the player start and the docks.
    for (let i = 0; i < 10; i += 1) {
      const line = random.pick(streets);
      const along = random.range(-200, 200);
      const onXStreet = random.chance(0.5);
      const x = onXStreet ? along : line + 5.5;
      const z = onXStreet ? line + 5.5 : along;
      const car = makeCar('parked', x, z, onXStreet ? (random.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) : (random.chance(0.5) ? 0 : Math.PI));
      car.hasDriver = false;
      state.cars.push(car);
    }
  }

  function spawnPeds() {
    while (state.peds.length < POPULATION.pedestrians) {
      const p = randomStreetPoint();
      const axis = random.chance(0.5) ? 'x' : 'z';
      state.peds.push({
        x: p.x + random.range(-6, 6),
        z: p.z + random.range(-6, 6),
        heading: random.range(0, Math.PI * 2),
        speed: random.range(POPULATION.pedSpeedMin, POPULATION.pedSpeedMax),
        color: random.pick(PED_COLORS),
        axis,
        dir: random.chance(0.5) ? 1 : -1,
        lane: random.pick([-10, -8.5, 8.5, 10]),
        flee: 0,
        health: 25,
        down: 0,
        walkPhase: random.range(0, Math.PI * 2),
      });
    }
  }

  // ------------------------------------------------------------------
  // Collision: circle vs building boxes, and clamping to the city.
  // ------------------------------------------------------------------
  function collideCircle(pos, radius) {
    for (const b of state.buildings) {
      const hw = b.w / 2 + radius;
      const hd = b.d / 2 + radius;
      const dx = pos.x - b.x;
      const dz = pos.z - b.z;
      if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
        const pushX = hw - Math.abs(dx);
        const pushZ = hd - Math.abs(dz);
        if (pushX < pushZ) pos.x = b.x + (dx > 0 ? hw : -hw);
        else pos.z = b.z + (dz > 0 ? hd : -hd);
        return true;
      }
    }
    return false;
  }

  function clampToCity(pos) {
    const m = WORLD.halfExtent + 6;
    pos.x = clamp(pos.x, -m, m);
    pos.z = clamp(pos.z, -m, m);
  }

  // ------------------------------------------------------------------
  // Missions
  // ------------------------------------------------------------------
  function missionDef(index) {
    return MISSIONS[index] ?? null;
  }

  function startMission(index) {
    const def = missionDef(index);
    if (!def) {
      state.mission = { index, phase: 'free', hasPackage: false, timeLeft: 0, markerX: 0, markerZ: 0, enemiesLeft: 0, def: null };
      return;
    }
    state.mission = {
      index,
      phase: 'pickup',
      hasPackage: false,
      timeLeft: def.timeLimitSeconds,
      markerX: def.pickup.x,
      markerZ: def.pickup.z,
      enemiesLeft: def.enemies ?? 0,
      def,
    };
    pushMessage(`${def.title} — ${def.briefing}`, 9);
  }

  function pushMessage(text, ttl = 4) {
    state.messages.push({ text, ttl });
    if (state.messages.length > 4) state.messages.shift();
  }

  function addHeat(amount) {
    state.wantedHeat = clamp(state.wantedHeat + amount, 0, WANTED.maxStars);
    state.wantedStars = Math.ceil(state.wantedHeat);
  }

  function hurtPlayer(amount) {
    const p = state.player;
    if (p.health <= 0) return;
    p.health = Math.max(0, p.health - amount);
    p.lastHurt = state.elapsed;
    if (p.health <= 0) return; // main.js turns this into EVENT_WASTED
  }

  // ------------------------------------------------------------------
  // Player
  // ------------------------------------------------------------------
  function createPlayer() {
    return {
      x: 0, z: 40, heading: 0, speed: 0,
      health: PLAYER.maxHealth,
      driving: null, // car object or null
      punchTimer: 0,
      punchAnim: 0,
      walkPhase: 0,
      moving: false,
      lastHurt: -99,
    };
  }

  function nearestCar(maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const car of state.cars) {
      const d = dist2d(state.player.x, state.player.z, car.x, car.z);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best;
  }

  function enterCar(car) {
    const p = state.player;
    if (car.hasDriver) {
      // Stealing an occupied car: the driver bails and the police notice.
      car.hasDriver = false;
      addHeat(WANTED.stealCarHeat);
      pushMessage('Car stolen! The harbour police are on to you.', 4);
      p.driving = car;
      car.kind = car.kind === 'police' ? 'police' : 'traffic';
      return EVENT_STEAL;
    }
    if (car.kind === 'police') {
      addHeat(2);
      pushMessage('You stole a police cruiser! Every unit in Port Solmar is coming.', 5);
    }
    p.driving = car;
    car.kind = 'traffic'; // a stolen car is just a car now (unless police)
    if (car.kind === 'police') car.kind = 'police';
    return 0;
  }

  function exitCar() {
    const p = state.player;
    const car = p.driving;
    if (!car) return;
    p.driving = null;
    car.speed = 0;
    // Step out on the driver's side.
    p.x = car.x + Math.cos(car.heading + Math.PI / 2) * 2.2;
    p.z = car.z + Math.sin(car.heading + Math.PI / 2) * 2.2;
    p.heading = car.heading;
    collideCircle(p, 0.7);
    clampToCity(p);
  }

  function punch() {
    const p = state.player;
    if (p.driving || p.punchTimer > 0) return 0;
    p.punchTimer = PLAYER.punchCooldown;
    p.punchAnim = 0.25;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    let hitSomething = false;
    // Enemies first, then pedestrians.
    for (const e of state.enemies) {
      if (!e.alive) continue;
      const d = dist2d(p.x, p.z, e.x, e.z);
      if (d < PLAYER.punchRange) {
        const toX = e.x - p.x;
        const toZ = e.z - p.z;
        const dot = (toX * fx + toZ * fz) / Math.max(d, 0.01);
        if (dot > -0.2) {
          e.health -= PLAYER.punchDamage;
          hitSomething = true;
          if (e.health <= 0) {
            e.alive = false;
            state.mission.enemiesLeft -= 1;
            pushMessage('Viper down.', 2);
            if (state.mission.enemiesLeft <= 0 && state.mission.phase === 'fight') {
              return EVENT_PUNCH | EVENT_KILL | EVENT_MISSION_DONE;
            }
            return EVENT_PUNCH | EVENT_KILL;
          }
        }
      }
    }
    for (const ped of state.peds) {
      if (ped.down > 0) continue;
      const d = dist2d(p.x, p.z, ped.x, ped.z);
      if (d < PLAYER.punchRange) {
        const toX = ped.x - p.x;
        const toZ = ped.z - p.z;
        const dot = (toX * fx + toZ * fz) / Math.max(d, 0.01);
        if (dot > -0.2) {
          ped.health -= PLAYER.punchDamage;
          ped.flee = 4;
          hitSomething = true;
          addHeat(WANTED.assaultHeat * 0.5);
          if (ped.health <= 0) {
            ped.down = 5;
            addHeat(WANTED.killHeat);
            pushMessage('That pedestrian is down. The police saw that.', 3);
            return EVENT_PUNCH | EVENT_KILL;
          }
        }
      }
    }
    return hitSomething ? EVENT_PUNCH : 0;
  }

  // ------------------------------------------------------------------
  // Traffic, pedestrians, police, enemies
  // ------------------------------------------------------------------
  function stepTraffic(dt) {
    for (const car of state.cars) {
      if (car.kind === 'police') continue;
      if (state.player.driving === car) continue;
      if (car.kind === 'parked') continue;
      // Ease toward target speed; slow down for a car ahead.
      let target = car.targetSpeed;
      for (const other of state.cars) {
        if (other === car) continue;
        const dx = other.x - car.x;
        const dz = other.z - car.z;
        const ahead = car.axis === 'x' ? dx * car.dir : dz * car.dir;
        const side = car.axis === 'x' ? Math.abs(dz) : Math.abs(dx);
        if (ahead > 0 && ahead < 9 && side < 3) {
          target = Math.min(target, other.speed);
          break;
        }
      }
      car.speed += clamp(target - car.speed, -14 * dt, 8 * dt);
      const nx = car.x + (car.axis === 'x' ? car.dir * car.speed * dt : 0);
      const nz = car.z + (car.axis === 'z' ? car.dir * car.speed * dt : 0);
      car.x = nx;
      car.z = nz;
      car.wheelSpin += car.speed * dt;
      // Turn at a random intersection.
      const along = car.axis === 'x' ? car.x : car.z;
      const cross = nearestStreetCoord(along);
      if (Math.abs(along - cross) < 0.5 && random.chance(0.06)) {
        car.axis = car.axis === 'x' ? 'z' : 'x';
        car.dir = random.chance(0.5) ? 1 : -1;
        car.heading = car.axis === 'x' ? (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (car.dir > 0 ? 0 : Math.PI);
      }
      // Wrap around the far edge of the city.
      const m = WORLD.halfExtent + 4;
      if (car.axis === 'x' && (car.x > m || car.x < -m)) {
        car.x = car.dir > 0 ? -m : m;
        car.z = nearestStreetCoord(car.z);
      }
      if (car.axis === 'z' && (car.z > m || car.z < -m)) {
        car.z = car.dir > 0 ? -m : m;
        car.x = nearestStreetCoord(car.x);
      }
    }
  }

  function stepPeds(dt) {
    const p = state.player;
    for (const ped of state.peds) {
      if (ped.down > 0) {
        ped.down -= dt;
        if (ped.down <= 0) {
          // Get back up elsewhere, away from the player.
          const spot = randomStreetPoint();
          ped.x = spot.x;
          ped.z = spot.z;
          ped.health = 25;
        }
        continue;
      }
      const dPlayer = dist2d(p.x, p.z, ped.x, ped.z);
      if (ped.flee > 0) ped.flee -= dt;
      if (dPlayer < 6 && (ped.flee > 0 || state.wantedStars >= 2)) {
        // Run away from the player.
        const away = Math.atan2(ped.x - p.x, ped.z - p.z);
        ped.heading = away;
        ped.x += Math.sin(away) * 5 * dt;
        ped.z += Math.cos(away) * 5 * dt;
      } else {
        const speed = ped.speed;
        if (ped.axis === 'x') {
          ped.x += ped.dir * speed * dt;
          ped.heading = ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          ped.z = nearestStreetCoord(ped.z) + ped.lane;
          if (ped.x > WORLD.halfExtent || ped.x < -WORLD.halfExtent) ped.dir *= -1;
        } else {
          ped.z += ped.dir * speed * dt;
          ped.heading = ped.dir > 0 ? 0 : Math.PI;
          ped.x = nearestStreetCoord(ped.x) + ped.lane;
          if (ped.z > WORLD.halfExtent || ped.z < -WORLD.halfExtent) ped.dir *= -1;
        }
      }
      ped.walkPhase += dt * 6;
      collideCircle(ped, 0.5);
    }
  }

  function spawnPolice() {
    const want = Math.min(state.wantedStars * WANTED.policePerStar, POPULATION.policeMax);
    const have = state.cars.filter((c) => c.kind === 'police').length;
    const p = state.player;
    for (let i = have; i < want; i += 1) {
      const angle = random.range(0, Math.PI * 2);
      const dist = random.range(55, 95);
      const x = clamp(p.x + Math.sin(angle) * dist, -WORLD.halfExtent, WORLD.halfExtent);
      const z = clamp(p.z + Math.cos(angle) * dist, -WORLD.halfExtent, WORLD.halfExtent);
      const car = makeCar('police', x, z, 0);
      car.speed = 12;
      state.cars.push(car);
    }
  }

  function stepPolice(dt) {
    const p = state.player;
    let seen = false;
    for (const car of state.cars) {
      if (car.kind !== 'police') continue;
      car.sirenPhase += dt;
      if (car.ramCooldown > 0) car.ramCooldown -= dt;
      const d = dist2d(p.x, p.z, car.x, car.z);
      if (d < 70) seen = true;
      const targetHeading = Math.atan2(p.x - car.x, p.z - car.z);
      const turn = clamp(angleDelta(car.heading, targetHeading), -2.2 * dt, 2.2 * dt);
      car.heading += turn;
      const topSpeed = 26 + state.wantedStars * 1.5;
      car.speed = Math.min(car.speed + 14 * dt, topSpeed);
      car.x += Math.sin(car.heading) * car.speed * dt;
      car.z += Math.cos(car.heading) * car.speed * dt;
      car.wheelSpin += car.speed * dt;
      if (collideCircle(car, 1.6)) car.speed *= 0.4;
      clampToCity(car);
      // Ramming the player.
      if (d < 3.4 && car.ramCooldown <= 0) {
        car.ramCooldown = 1.2;
        if (p.driving) {
          p.driving.speed *= 0.55;
          hurtPlayer(6);
          pushMessage('Police rammed your car!', 2);
        } else {
          hurtPlayer(10);
          pushMessage('A police cruiser hit you!', 2);
        }
      }
      // Arrest: a cruiser sitting on the player on foot.
      if (!p.driving && d < WANTED.arrestDistance) {
        state.arrestTimer += dt;
      }
    }
    // Lose the tail: when no police unit is near, heat cools off.
    if (state.wantedStars > 0) {
      state.wantedHeat = Math.max(0, state.wantedHeat - (seen ? WANTED.decayPerSecondSeen : WANTED.decayPerSecondHidden) * dt);
      state.wantedStars = Math.ceil(state.wantedHeat);
    }
    if (state.wantedStars === 0) {
      state.arrestTimer = 0;
      // Units stand down and drive away.
      state.cars = state.cars.filter((c) => {
        if (c.kind !== 'police') return true;
        if (c === state.player.driving) return true;
        return dist2d(p.x, p.z, c.x, c.z) < 120;
      });
    }
  }

  function spawnEnemies() {
    state.enemies = [];
    const def = state.mission.def;
    const cx = def.pickup.x;
    const cz = def.pickup.z;
    for (let i = 0; i < (def.enemies ?? ENEMY.count); i += 1) {
      state.enemies.push({
        x: cx + random.range(-14, 14),
        z: cz + random.range(-14, 14),
        heading: random.range(0, Math.PI * 2),
        health: ENEMY.health,
        attackTimer: random.range(0, 0.8),
        alive: true,
        walkPhase: random.range(0, Math.PI * 2),
      });
    }
  }

  function stepEnemies(dt) {
    const p = state.player;
    for (const e of state.enemies) {
      if (!e.alive) continue;
      const d = dist2d(p.x, p.z, e.x, e.z);
      if (d < 45) {
        const targetHeading = Math.atan2(p.x - e.x, p.z - e.z);
        e.heading += clamp(angleDelta(e.heading, targetHeading), -3 * dt, 3 * dt);
        if (d > ENEMY.attackRange) {
          e.x += Math.sin(e.heading) * ENEMY.chaseSpeed * dt;
          e.z += Math.cos(e.heading) * ENEMY.chaseSpeed * dt;
          e.walkPhase += dt * 7;
        } else if (e.attackTimer <= 0) {
          e.attackTimer = ENEMY.attackCooldown;
          hurtPlayer(ENEMY.damage);
          pushMessage('A Rust Viper hit you!', 2);
        }
      }
      if (e.attackTimer > 0) e.attackTimer -= dt;
      collideCircle(e, 0.6);
    }
  }

  // ------------------------------------------------------------------
  // Player movement
  // ------------------------------------------------------------------
  function stepPlayer(dt, input, actions) {
    const p = state.player;
    if (p.punchTimer > 0) p.punchTimer -= dt;
    if (p.punchAnim > 0) p.punchAnim -= dt;

    if (actions & 4) { // ACTION_ENTER_CAR
      if (p.driving) exitCar();
      else {
        const car = nearestCar(PLAYER.carEnterRange);
        if (car) {
          const ev = enterCar(car);
          if (ev) return ev;
        } else {
          pushMessage('No car close enough. Walk up to one and press E.', 2);
        }
      }
    }

    if (p.driving) {
      const car = p.driving;
      const accel = input.throttle > 0 ? PLAYER.driveAccel : input.throttle < 0 ? -PLAYER.driveAccel * 0.7 : 0;
      car.speed += accel * dt;
      if (input.brake) car.speed *= Math.max(0, 1 - 3.2 * dt);
      car.speed *= Math.max(0, 1 - 0.35 * dt); // rolling drag
      car.speed = clamp(car.speed, -PLAYER.driveReverseSpeed, PLAYER.driveMaxSpeed);
      const steer = input.steer;
      const speedFactor = clamp(Math.abs(car.speed) / 12, 0, 1);
      car.heading += steer * PLAYER.driveTurn * speedFactor * dt * (car.speed < 0 ? -1 : 1);
      car.x += Math.sin(car.heading) * car.speed * dt;
      car.z += Math.cos(car.heading) * car.speed * dt;
      car.wheelSpin += car.speed * dt;
      if (collideCircle(car, 1.6)) car.speed *= 0.45;
      clampToCity(car);
      p.x = car.x;
      p.z = car.z;
      p.heading = car.heading;
      p.speed = Math.abs(car.speed);
      p.moving = Math.abs(car.speed) > 0.5;
      return 0;
    }

    // On foot: movement is relative to the camera.
    const moveAngle = state.camYaw + Math.PI; // camera looks from behind
    let mx = 0;
    let mz = 0;
    if (input.throttle !== 0 || input.steer !== 0) {
      const forward = { x: Math.sin(moveAngle), z: Math.cos(moveAngle) };
      const right = { x: Math.sin(moveAngle - Math.PI / 2), z: Math.cos(moveAngle - Math.PI / 2) };
      mx = forward.x * input.throttle + right.x * -input.steer;
      mz = forward.z * input.throttle + right.z * -input.steer;
      const len = Math.hypot(mx, mz);
      mx /= len;
      mz /= len;
    }
    const speed = input.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    p.moving = mx !== 0 || mz !== 0;
    if (p.moving) {
      const targetHeading = Math.atan2(mx, mz);
      p.heading += clamp(angleDelta(p.heading, targetHeading), -10 * dt, 10 * dt);
      p.x += mx * speed * dt;
      p.z += mz * speed * dt;
      p.walkPhase += dt * (input.sprint ? 11 : 8);
    }
    p.speed = p.moving ? speed : 0;
    collideCircle(p, 0.7);
    clampToCity(p);
    // Shove pedestrians aside gently.
    for (const ped of state.peds) {
      if (ped.down > 0) continue;
      const d = dist2d(p.x, p.z, ped.x, ped.z);
      if (d < 1.1 && d > 0.01) {
        ped.x += ((ped.x - p.x) / d) * (1.1 - d);
        ped.z += ((ped.z - p.z) / d) * (1.1 - d);
      }
    }
    return 0;
  }

  // ------------------------------------------------------------------
  // Missions
  // ------------------------------------------------------------------
  function stepMission(dt) {
    const m = state.mission;
    if (!m || !m.def) return 0;
    if (m.phase === 'free') return 0;
    m.timeLeft -= dt;
    if (m.timeLeft <= 0) {
      m.phase = 'pickup';
      m.hasPackage = false;
      m.timeLeft = m.def.timeLimitSeconds;
      m.markerX = m.def.pickup.x;
      m.markerZ = m.def.pickup.z;
      if (m.def.id === 'turf') {
        for (const e of state.enemies) e.alive = true;
        m.enemiesLeft = m.def.enemies ?? ENEMY.count;
      }
      pushMessage(`Out of time! ${m.def.title} restarts.`, 4);
      return EVENT_MISSION_FAILED;
    }
    const p = state.player;
    const targetX = m.phase === 'pickup' ? m.markerX : m.markerX;
    const targetZ = m.phase === 'pickup' ? m.markerZ : m.markerZ;
    const d = dist2d(p.x, p.z, targetX, targetZ);
    if (m.phase === 'pickup' && d < 7) {
      if (m.def.id === 'turf') {
        m.phase = 'fight';
        spawnEnemies();
        m.enemiesLeft = state.enemies.length;
        pushMessage('The Rust Vipers are here. Clear them out!', 4);
        return 0;
      }
      m.phase = 'dropoff';
      m.hasPackage = true;
      m.markerX = m.def.dropoff.x;
      m.markerZ = m.def.dropoff.z;
      if (m.def.pickupHeat) addHeat(m.def.pickupHeat);
      pushMessage(m.def.id === 'getaway' ? 'Crew picked up! Lose the cops and reach the safehouse.' : 'Package secured. Deliver it.', 4);
      return EVENT_PICKUP;
    }
    if (m.phase === 'dropoff' && d < 7) {
      state.money += m.def.reward;
      pushMessage(`${m.def.title} complete! +$${m.def.reward}`, 5);
      const next = m.index + 1;
      startMission(next);
      return EVENT_MISSION_DONE;
    }
    if (m.phase === 'fight' && m.enemiesLeft <= 0) {
      state.money += m.def.reward;
      pushMessage(`${m.def.title} complete! The docks are yours. +$${m.def.reward}`, 6);
      startMission(m.index + 1);
      return EVENT_MISSION_DONE;
    }
    return 0;
  }

  function updateDistrict() {
    const p = state.player;
    for (const d of DISTRICTS) {
      if (p.x >= d.x0 && p.x < d.x1 && p.z >= d.z0 && p.z < d.z1) {
        state.district = d.name;
        return;
      }
    }
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------
  function reset() {
    buildCity();
    state.cars = [];
    state.peds = [];
    state.enemies = [];
    state.elapsed = 0;
    state.money = 0;
    state.wantedHeat = 0;
    state.wantedStars = 0;
    state.arrestTimer = 0;
    state.messages = [];
    state.player = createPlayer();
    state.camYaw = Math.PI;
    spawnParked();
    spawnTraffic();
    spawnPeds();
    startMission(0);
  }

  function applySave(save) {
    state.money = save.money ?? 0;
    state.player.health = save.health ?? PLAYER.maxHealth;
    state.player.x = save.player?.x ?? 0;
    state.player.z = save.player?.z ?? 40;
    startMission(save.missionIndex ?? 0);
  }

  function makeSave() {
    return {
      money: state.money,
      missionIndex: state.mission ? state.mission.index : 0,
      missionsDone: MISSIONS.slice(0, state.mission ? state.mission.index : 0).map((m) => m.id),
      player: { x: state.player.x, z: state.player.z },
      health: state.player.health,
      savedAt: Date.now(),
    };
  }

  function step(dt, input, actions) {
    let events = 0;
    state.elapsed += dt;
    for (const msg of state.messages) msg.ttl -= dt;
    state.messages = state.messages.filter((m) => m.ttl > 0);

    events |= stepPlayer(dt, input, actions);
    if (actions & 8) events |= punch(); // ACTION_ATTACK
    stepTraffic(dt);
    stepPeds(dt);
    spawnPolice();
    stepPolice(dt);
    stepEnemies(dt);
    events |= stepMission(dt);
    updateDistrict();

    // Slow health regen when out of trouble.
    const p = state.player;
    if (state.elapsed - p.lastHurt > PLAYER.regenDelaySeconds && p.health > 0 && p.health < PLAYER.maxHealth) {
      p.health = Math.min(PLAYER.maxHealth, p.health + PLAYER.regenPerSecond * dt);
    }
    if (state.arrestTimer >= WANTED.arrestTimeSeconds) {
      state.arrestTimer = 0;
      return events | EVENT_BUSTED;
    }
    if (p.health <= 0) return events | EVENT_WASTED;
    return events;
  }

  reset();
  return { state, reset, step, applySave, makeSave, pushMessage, addHeat, setMission: startMission, streetLines: streets };
}
