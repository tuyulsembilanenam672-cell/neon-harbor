// Drawing only: the three.js scene for Port Solmar and the 2D minimap.
//
// The renderer owns no game rules. It reads world.state every frame, keeps
// one three.js mesh (or small group) per car, pedestrian, enemy and building,
// and moves them to match the state. The HUD itself is DOM (see index.html);
// this file only paints the 3D view and the minimap canvas.

import { CAMERA, PALETTE, WORLD } from './config.js';
import { clamp } from './random.js';

const THREE = window.THREE;

function makeGroundTexture(streets) {
  const size = 1024;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  const half = WORLD.halfExtent + 31;
  const toPx = (v) => ((v + half) / (half * 2)) * size;
  // Base: dark asphalt everywhere, then lighter sidewalk blocks.
  ctx.fillStyle = '#1b1b26';
  ctx.fillRect(0, 0, size, size);
  const pitch = WORLD.blockSize + WORLD.streetWidth;
  for (let bx = 0; bx < WORLD.blocksX; bx += 1) {
    for (let bz = 0; bz < WORLD.blocksZ; bz += 1) {
      const x0 = toPx(streets[bx] + WORLD.streetWidth / 2);
      const z0 = toPx(streets[bz] + WORLD.streetWidth / 2);
      const w = ((WORLD.blockSize) / (half * 2)) * size;
      ctx.fillStyle = '#7d7d8c';
      ctx.fillRect(x0, z0, w, w);
      // Pavement edge.
      ctx.strokeStyle = '#4a4a58';
      ctx.lineWidth = 3;
      ctx.strokeRect(x0, z0, w, w);
    }
  }
  // Centre dashes along every street.
  ctx.fillStyle = '#f0e8a0';
  for (const s of streets) {
    const p = toPx(s);
    for (let v = -half; v < half; v += 12) {
      ctx.fillRect(toPx(v), p - 2, 20, 4);
      ctx.fillRect(p - 2, toPx(v), 4, 20);
    }
  }
  // Crosswalks at every intersection.
  ctx.fillStyle = '#c8c8c8';
  for (const sx of streets) {
    for (const sz of streets) {
      for (let i = -3; i <= 3; i += 1) {
        ctx.fillRect(toPx(sx + i * 2 - 0.8), toPx(sz - 7), 1.6, 14);
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}

function makeWindowTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 8; y < 120; y += 14) {
    for (let x = 6; x < 58; x += 12) {
      const lit = Math.random() < 0.55;
      ctx.fillStyle = lit ? '#ffd98a' : '#2a2f45';
      ctx.fillRect(x, y, 7, 9);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makePerson(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b88a });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.32), mat);
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), skin);
  head.position.y = 1.62;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.2), new THREE.MeshLambertMaterial({ color: 0x2a2a33 }));
  legL.position.set(-0.14, 0.35, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.16), mat);
  armL.position.set(-0.38, 1.05, 0);
  const armR = armL.clone();
  armR.position.x = 0.38;
  group.add(torso, head, legL, legR, armL, armR);
  group.userData = { legL, legR, armL, armR, torso };
  return group;
}

function makeCarMesh(color, isPolice) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1a2436 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.62, 4.4), bodyMat);
  body.position.y = 0.55;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.2), glassMat);
  cabin.position.set(0, 1.1, -0.2);
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const wheels = [];
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.34, wz);
    wheels.push(w);
    group.add(w);
  }
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  const hl1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.08), lightMat);
  hl1.position.set(-0.6, 0.62, 2.22);
  const hl2 = hl1.clone();
  hl2.position.x = 0.6;
  group.add(body, cabin, hl1, hl2);
  let lightRed = null;
  let lightBlue = null;
  if (isPolice) {
    lightRed = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: PALETTE.policeLightRed }));
    lightRed.position.set(-0.4, 1.48, -0.2);
    lightBlue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: PALETTE.policeLightBlue }));
    lightBlue.position.set(0.4, 1.48, -0.2);
    group.add(lightRed, lightBlue);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.2, 4.42), new THREE.MeshLambertMaterial({ color: PALETTE.policeColor }));
    stripe.position.y = 0.72;
    group.add(stripe);
  }
  group.userData = { wheels, lightRed, lightBlue, bodyMat };
  return group;
}

export function createRenderer(canvas, minimapCanvas, world) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyBottom);
  scene.fog = new THREE.Fog(PALETTE.fogColor, 90, 420);

  const hemi = new THREE.HemisphereLight(0xffd9a0, 0x2a2140, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sunColor, 1.2);
  sun.position.set(-120, 180, 220);
  scene.add(sun);
  const amb = new THREE.AmbientLight(0x604a80, 0.5);
  scene.add(amb);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);

  // Ground: one big textured plane, plus a water plane past the harbour.
  const groundSize = (WORLD.halfExtent + 31) * 2;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshLambertMaterial({ map: makeGroundTexture(world.streetLines) }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, 160),
    new THREE.MeshLambertMaterial({ color: PALETTE.waterColor }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.4, WORLD.halfExtent + 31 + 80);
  scene.add(water);

  // Sunset gradient sky dome (a big sphere, back side).
  const skyGeo = new THREE.SphereGeometry(700, 16, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      bottom: { value: new THREE.Color(PALETTE.skyBottom) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bottom; void main(){ float h = clamp(vP.y / 700.0 * 1.6 + 0.25, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // City group, rebuilt whenever the world regenerates its buildings.
  const cityGroup = new THREE.Group();
  scene.add(cityGroup);
  const windowTex = makeWindowTexture();
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildingMats = new Map();
  function buildingMaterial(color) {
    if (!buildingMats.has(color)) {
      buildingMats.set(color, new THREE.MeshLambertMaterial({ color, map: windowTex }));
    }
    return buildingMats.get(color);
  }
  let lastBuildings = null;
  function rebuildCity(buildings) {
    while (cityGroup.children.length > 0) cityGroup.remove(cityGroup.children[0]);
    for (const b of buildings) {
      const mesh = new THREE.Mesh(buildingGeo, buildingMaterial(b.color));
      mesh.scale.set(b.w, b.h, b.d);
      mesh.position.set(b.x, b.h / 2, b.z);
      cityGroup.add(mesh);
      // Roof edge.
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(b.w * 0.9, 0.3, b.d * 0.9),
        new THREE.MeshLambertMaterial({ color: 0x1a1a22 }),
      );
      roof.position.set(b.x, b.h + 0.15, b.z);
      cityGroup.add(roof);
      if (b.neon) {
        const sign = new THREE.Mesh(
          new THREE.BoxGeometry(Math.min(b.w * 0.7, 10), 1.1, 0.25),
          new THREE.MeshBasicMaterial({ color: b.neon }),
        );
        sign.position.set(b.x, Math.min(b.h * 0.75, 26), b.z + b.d / 2 + 0.2);
        cityGroup.add(sign);
      }
    }
    lastBuildings = buildings;
  }

  // Dynamic actors, keyed by id.
  const carMeshes = new Map();
  const pedMeshes = new Map();
  const enemyMeshes = new Map();
  const playerMesh = makePerson(0x2e6db0);
  scene.add(playerMesh);
  const markerGroup = new THREE.Group();
  const markerBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 30, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
  );
  markerBeam.position.y = 15;
  const markerDiamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.1),
    new THREE.MeshBasicMaterial({ color: 0xffe14d }),
  );
  markerDiamond.position.y = 9;
  markerGroup.add(markerBeam, markerDiamond);
  scene.add(markerGroup);

  const mapCtx = minimapCanvas.getContext('2d');
  let titleMode = false;
  let titleAngle = 0;

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    minimapCanvas.width = 190 * ratio;
    minimapCanvas.height = 190 * ratio;
  }
  resize();
  window.addEventListener('resize', resize);

  function syncCars(state) {
    const seen = new Set();
    for (const car of state.cars) {
      seen.add(car.id);
      let mesh = carMeshes.get(car.id);
      if (!mesh) {
        mesh = makeCarMesh(car.color, car.kind === 'police');
        carMeshes.set(car.id, mesh);
        scene.add(mesh);
      }
      mesh.position.set(car.x, 0, car.z);
      mesh.rotation.y = car.heading;
      const spin = car.wheelSpin || 0;
      for (const w of mesh.userData.wheels) w.rotation.x = spin;
      if (mesh.userData.lightRed) {
        const flash = Math.floor(car.sirenPhase * 3) % 2 === 0;
        mesh.userData.lightRed.visible = flash;
        mesh.userData.lightBlue.visible = !flash;
      }
    }
    for (const [id, mesh] of carMeshes) {
      if (!seen.has(id)) {
        scene.remove(mesh);
        carMeshes.delete(id);
      }
    }
  }

  function syncPeople(state) {
    const seen = new Set();
    state.peds.forEach((ped, i) => {
      seen.add(i);
      let mesh = pedMeshes.get(i);
      if (!mesh) {
        mesh = makePerson(ped.color);
        pedMeshes.set(i, mesh);
        scene.add(mesh);
      }
      mesh.position.set(ped.x, ped.down > 0 ? -0.9 : 0, ped.z);
      mesh.rotation.y = ped.heading;
      mesh.rotation.x = ped.down > 0 ? Math.PI / 2 : 0;
      const u = mesh.userData;
      const swing = ped.down > 0 ? 0 : Math.sin(ped.walkPhase) * 0.5;
      u.legL.rotation.x = swing;
      u.legR.rotation.x = -swing;
      u.armL.rotation.x = -swing;
      u.armR.rotation.x = swing;
    });
    for (const [i, mesh] of pedMeshes) {
      if (!seen.has(i)) {
        scene.remove(mesh);
        pedMeshes.delete(i);
      }
    }
    const seenE = new Set();
    state.enemies.forEach((e, i) => {
      if (!e.alive) return;
      seenE.add(i);
      let mesh = enemyMeshes.get(i);
      if (!mesh) {
        mesh = makePerson(0xb03a2e);
        enemyMeshes.set(i, mesh);
        scene.add(mesh);
      }
      mesh.position.set(e.x, 0, e.z);
      mesh.rotation.y = e.heading;
      const u = mesh.userData;
      const swing = Math.sin(e.walkPhase) * 0.5;
      u.legL.rotation.x = swing;
      u.legR.rotation.x = -swing;
    });
    for (const [i, mesh] of enemyMeshes) {
      if (!seenE.has(i)) {
        scene.remove(mesh);
        enemyMeshes.delete(i);
      }
    }
  }

  function drawMinimap(state) {
    const size = minimapCanvas.width;
    const ctx = mapCtx;
    const half = WORLD.halfExtent + 31;
    const toMap = (v) => ((v + half) / (half * 2)) * size;
    ctx.fillStyle = 'rgba(12, 12, 22, 0.92)';
    ctx.fillRect(0, 0, size, size);
    // Water at the bottom (south).
    ctx.fillStyle = '#1d4e6b';
    ctx.fillRect(0, toMap(WORLD.halfExtent), size, size - toMap(WORLD.halfExtent));
    // Streets.
    ctx.strokeStyle = '#3a3a44';
    ctx.lineWidth = Math.max(2, size / 90);
    for (const s of world.streetLines) {
      ctx.beginPath();
      ctx.moveTo(toMap(s), 0);
      ctx.lineTo(toMap(s), size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, toMap(s));
      ctx.lineTo(size, toMap(s));
      ctx.stroke();
    }
    // Buildings.
    ctx.fillStyle = '#6a6a78';
    for (const b of state.buildings) {
      ctx.fillRect(toMap(b.x - b.w / 2), toMap(b.z - b.d / 2), Math.max(2, (b.w / (half * 2)) * size), Math.max(2, (b.d / (half * 2)) * size));
    }
    // Mission marker.
    const m = state.mission;
    if (m && m.def) {
      ctx.fillStyle = '#ffe14d';
      const mx = toMap(m.markerX);
      const my = toMap(m.markerZ);
      ctx.beginPath();
      ctx.moveTo(mx, my - 7);
      ctx.lineTo(mx + 7, my);
      ctx.lineTo(mx, my + 7);
      ctx.lineTo(mx - 7, my);
      ctx.closePath();
      ctx.fill();
    }
    // Traffic.
    ctx.fillStyle = '#cccccc';
    for (const car of state.cars) {
      if (car.kind === 'police') continue;
      ctx.fillRect(toMap(car.x) - 1.5, toMap(car.z) - 1.5, 3, 3);
    }
    // Enemies.
    ctx.fillStyle = '#ff4444';
    for (const e of state.enemies) {
      if (!e.alive) continue;
      ctx.beginPath();
      ctx.arc(toMap(e.x), toMap(e.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Police, flashing.
    const flash = Math.floor(state.elapsed * 3) % 2 === 0;
    ctx.fillStyle = flash ? '#ff3333' : '#3366ff';
    for (const car of state.cars) {
      if (car.kind !== 'police') continue;
      ctx.beginPath();
      ctx.arc(toMap(car.x), toMap(car.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player arrow.
    const p = state.player;
    ctx.save();
    ctx.translate(toMap(p.x), toMap(p.z));
    ctx.rotate(Math.atan2(Math.sin(p.heading), -Math.cos(p.heading)));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
  }

  function updateCamera(state, dt, drag) {
    if (drag) {
      state.camYaw -= drag.x * 0.005;
      state.camPitch = clamp(state.camPitch + drag.y * 0.003, 0.12, 0.95);
    }
    const p = state.player;
    const driving = !!p.driving;
    const targetDist = driving ? CAMERA.driveDistance : CAMERA.walkDistance;
    const targetHeight = driving ? CAMERA.driveHeight : CAMERA.walkHeight;
    state.camDistance += (targetDist - state.camDistance) * Math.min(1, dt * 4);
    if (titleMode) {
      titleAngle += dt * 0.05;
      const r = 260;
      camera.position.set(Math.sin(titleAngle) * r, 150, Math.cos(titleAngle) * r);
      camera.lookAt(0, 0, 0);
      return;
    }
    const yaw = state.camYaw;
    const cx = p.x + Math.sin(yaw) * state.camDistance;
    const cz = p.z + Math.cos(yaw) * state.camDistance;
    const cy = targetHeight + Math.sin(state.camPitch) * state.camDistance * 0.45;
    camera.position.set(cx, cy, cz);
    camera.lookAt(p.x - Math.sin(yaw) * CAMERA.lookAhead * 0.4, 2, p.z - Math.cos(yaw) * CAMERA.lookAhead * 0.4);
  }

  function draw(state, dt, drag) {
    if (state.buildings !== lastBuildings) rebuildCity(state.buildings);
    const p = state.player;
    syncCars(state);
    syncPeople(state);
    // Player figure.
    const pm = playerMesh;
    if (p.driving) {
      pm.visible = false;
    } else {
      pm.visible = true;
      pm.position.set(p.x, 0, p.z);
      pm.rotation.y = p.heading;
      const u = pm.userData;
      const swing = p.moving ? Math.sin(p.walkPhase) * 0.55 : 0;
      u.legL.rotation.x = swing;
      u.legR.rotation.x = -swing;
      u.armL.rotation.x = -swing + (p.punchAnim > 0 ? -1.4 : 0);
      u.armR.rotation.x = swing;
    }
    // Mission marker beacon.
    const m = state.mission;
    if (m && m.def && m.phase !== 'free') {
      markerGroup.visible = true;
      markerGroup.position.set(m.markerX, 0, m.markerZ);
      markerDiamond.position.y = 9 + Math.sin(state.elapsed * 2.5) * 1.2;
      markerDiamond.rotation.y = state.elapsed * 2;
      markerBeam.material.opacity = 0.22 + Math.sin(state.elapsed * 2.5) * 0.08;
    } else {
      markerGroup.visible = false;
    }
    updateCamera(state, dt, drag);
    drawMinimap(state);
    renderer.render(scene, camera);
  }

  return {
    draw,
    setTitleMode(value) {
      titleMode = value;
    },
    // Exposed for the screenshot driver: force one render without stepping.
    renderOnce(state) {
      this.draw(state, 0.016, null);
    },
  };
}
