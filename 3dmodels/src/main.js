import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';

const app = document.querySelector('#app');
app.innerHTML = `
  <div class="shell">
    <div id="scene"></div>

    <div class="topbar">
      <div class="brand">
        <strong>3D Building Explorer</strong>
        <span>Interactive digital building model</span>
      </div>
      <div class="toolbar">
        <button class="btn active" id="orbitBtn">3D View</button>
        <button class="btn" id="topBtn">Floor Plan</button>
        <button class="btn" id="explodeBtn">Explode Floors</button>
        <button class="btn" id="resetBtn">Reset</button>
      </div>
    </div>

    <aside class="panel left">
      <h3>Building levels</h3>
      <div class="muted">Select a floor to isolate and inspect its units.</div>
      <div class="floor-list" id="floorList"></div>
      <input class="search" id="search" placeholder="Search unit e.g. 302" />
    </aside>

    <aside class="panel right">
      <h3>Selected unit</h3>
      <div class="muted">Click a unit on the building.</div>
      <div class="info-card" id="info">
        <div class="unit-title">No unit selected</div>
        <div class="muted">Choose a highlighted block to inspect its metadata.</div>
      </div>
    </aside>

    <div class="hint" id="modeHint">Drag to orbit • Scroll to zoom • Click a unit</div>

    <div class="legend">
      <div class="legend-item"><span class="legend-dot" style="background:#4ade80"></span>Available</div>
      <div class="legend-item"><span class="legend-dot" style="background:#fbbf24"></span>Occupied</div>
      <div class="legend-item"><span class="legend-dot" style="background:#fb7185"></span>Maintenance</div>
      <div class="legend-item"><span class="legend-dot" style="background:#60a5fa"></span>Selected</div>
    </div>

    <img class="reference" src="/building-reference.webp" alt="Building reference" />
  </div>
`;

const sceneHost = document.querySelector('#scene');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9eb7d0);
scene.fog = new THREE.Fog(0x9eb7d0, 32, 60);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 120);
camera.position.set(12, 9, 17);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
sceneHost.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 5.2, 0);
controls.minDistance = 8;
controls.maxDistance = 35;
controls.maxPolarAngle = Math.PI * 0.49;

scene.add(new THREE.HemisphereLight(0xffffff, 0x566b80, 2.1));
const sun = new THREE.DirectionalLight(0xffffff, 3.0);
sun.position.set(-8, 16, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(55, 55),
  new THREE.MeshStandardMaterial({ color: 0x738b72, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const building = new THREE.Group();
building.position.y = 0.02;
scene.add(building);

const floorGroups = [];
const units = [];
let selectedUnit = null;
let selectedFloor = null;
let exploded = false;
let topMode = false;
let popTweenActive = false;

const STATUS = {
  available: 0x4ade80,
  occupied: 0xfbbf24,
  maintenance: 0xfb7185
};

/* ---------------------------------------------------------------- */
/* Lightweight tween engine (no external dependency needed)          */
/* ---------------------------------------------------------------- */

const tweens = [];

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function animateValue({ from, to, duration = 450, easing = easeInOutCubic, onUpdate, onComplete }) {
  const start = performance.now();
  tweens.push({
    update(now) {
      const t = Math.min((now - start) / duration, 1);
      onUpdate(from + (to - from) * easing(t), t);
      if (t >= 1) {
        if (onComplete) onComplete();
        return true;
      }
      return false;
    }
  });
}

/* ---------------------------------------------------------------- */
/* Geometry helpers                                                   */
/* ---------------------------------------------------------------- */

function mat(color, roughness = 0.78) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

function box(w, h, d, material, x, y, z, parent = building) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addWindow(parent, x, y, z, width = 1.25, height = 1.55, front = true) {
  const frame = mat(0xf1f1ee, .6);
  const glass = new THREE.MeshStandardMaterial({
    color: 0x89a9c4,
    roughness: .18,
    metalness: .15,
    transparent: true,
    opacity: .86
  });
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);

  box(width, height, .10, frame, 0, 0, 0, group);
  box(width * .78, height * .76, .13, glass, 0, 0, front ? -.07 : .07, group);
  box(.055, height * .78, .15, frame, 0, 0, front ? -.15 : .15, group);
  box(width * .84, .055, .15, frame, 0, 0, front ? -.15 : .15, group);
  return group;
}

function addTree(x, z, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  scene.add(g);
  box(.24, 1.2, .24, mat(0x73513b), 0, .6, 0, g);
  const crown = new THREE.Mesh(
    new THREE.SphereGeometry(.85, 14, 12),
    mat(0x4b7d4c)
  );
  crown.position.y = 1.55;
  crown.scale.set(1, 1.15, 1);
  crown.castShadow = true;
  g.add(crown);
}

function createUnit(floorNumber, unitNumber, x, y, z, status) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.userData = {
    type: 'unit',
    id: `${floorNumber}${unitNumber}`,
    floor: floorNumber,
    area: 112 + floorNumber * 7 + unitNumber * 4,
    capacity: 4 + floorNumber * 3,
    typeName: floorNumber === 1 ? 'Entrance / Common Unit' : 'Residential / Office Unit',
    status,
    originalY: y
  };
  building.add(group);

  // Transparent selectable volume behind the facade.
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.18, 3.25, 2.75),
    new THREE.MeshStandardMaterial({
      color: 0xe4e2dc,
      roughness: .92,
      transparent: true,
      opacity: .12
    })
  );
  body.position.y = 1.62;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Floor-specific accent strip.
  box(3.18, .10, 2.78, mat(0xb3b0a9), 0, .06, 0, group);

  // Front windows.
  addWindow(group, -.72, 1.72, -1.40, 1.08, 1.45, true);
  addWindow(group, .72, 1.72, -1.40, 1.08, 1.45, true);

  // Unit label plaque.
  const plaque = new THREE.Mesh(
    new THREE.BoxGeometry(.55, .20, .045),
    mat(STATUS[status])
  );
  plaque.position.set(0, .42, -1.43);
  group.add(plaque);

  units.push(group);
  return group;
}

function createBuilding() {
  const width = 10.2;
  const depth = 6.2;
  const floorHeight = 3.25;

  // Ground-level plinth.
  box(11.0, .42, 7.0, mat(0x77736d), 0, .21, 0);

  for (let floor = 1; floor <= 4; floor++) {
    const floorGroup = new THREE.Group();
    floorGroup.userData.floor = floor;
    building.add(floorGroup);
    floorGroups.push(floorGroup);

    const y = .45 + (floor - 1) * floorHeight;
    floorGroup.position.y = y;
    floorGroup.userData.originalY = y;

    const facadeColor = floor === 1 ? 0x9c5c39 : 0xe5e2db;
    box(width, floorHeight, depth, mat(facadeColor), 0, floorHeight / 2, 0, floorGroup);

    // Floor slab / horizontal seam.
    box(width + .16, .10, depth + .12, mat(0xb6b2aa), 0, floorHeight - .05, 0, floorGroup);

    // Three unit bays.
    [-3.4, 0, 3.4].forEach((x, index) => {
      const status = ['available', 'occupied', 'maintenance'][(floor + index) % 3];
      const unit = createUnit(floor, index + 1, x, y, 0, status);
      unit.userData.parentFloor = floorGroup;
    });

    // Front entrance on ground floor.
    if (floor === 1) {
      box(1.25, 2.25, .12, mat(0x363c40), 0, 1.18, -3.13, floorGroup);
      box(.92, 2.02, .08, mat(0x7191a0, .4), 0, 1.12, -3.21, floorGroup);
    }
  }

  // Roof / parapet.
  const roofY = .45 + 4 * floorHeight;
  const roof = box(11.0, .32, 6.95, mat(0xddd9d0), 0, roofY + .16, 0);
  const parapet = box(11.2, .16, 7.15, mat(0x8f8a81), 0, roofY + .36, 0);
  roof.userData.isRoof = true;
  parapet.userData.isRoof = true;

  // Side walls / neighboring buildings from reference image.
  const sideLeft = box(4.8, 9.0, 8.0, mat(0x8c8b85), -7.4, 4.5, 0, scene);
  const sideRight = box(4.8, 8.0, 8.0, mat(0x777772), 7.4, 4.0, 0, scene);
  sideLeft.userData.isContext = true;
  sideRight.userData.isContext = true;

  // Front path and landscaping.
  box(4.2, .08, 8.0, mat(0xc2b9a7), 0, .04, -6.4, scene);
  [-4.4, -3.1, 3.1, 4.4].forEach((x, i) => addTree(x, -4.7, i % 2 ? .8 : 1));
}

createBuilding();

function setUnitVisual(unit, mode = 'normal') {
  const status = STATUS[unit.userData.status];
  const body = unit.children.find(c => c.isMesh && c.geometry.type === 'BoxGeometry' && c.position.y === 1.62);
  if (body?.material) {
    body.material.color.set(mode === 'selected' ? 0x60a5fa : 0xe4e2dc);
    body.material.opacity = mode === 'selected' ? .42 : .10;
  }
  unit.children.forEach(c => {
    if (c.isMesh && c.position.y === .42) {
      c.material.color.set(mode === 'selected' ? 0x60a5fa : status);
    }
  });
}

function popUnit(unit) {
  popTweenActive = true;
  animateValue({
    from: 0.82,
    to: 1,
    duration: 420,
    easing: easeOutBack,
    onUpdate: s => { unit.scale.setScalar(s); },
    onComplete: () => { popTweenActive = false; }
  });
}

function selectUnit(unit) {
  if (selectedUnit) {
    setUnitVisual(selectedUnit, 'normal');
    selectedUnit.scale.setScalar(1);
  }
  selectedUnit = unit;
  if (!unit) {
    document.querySelector('#info').innerHTML = `
      <div class="unit-title">No unit selected</div>
      <div class="muted">Choose a unit on the building to inspect its metadata.</div>`;
    return;
  }

  setUnitVisual(unit, 'selected');
  popUnit(unit);

  const d = unit.userData;
  document.querySelector('#info').innerHTML = `
    <div class="unit-title">Unit ${d.id}</div>
    <div class="status" style="color:${'#' + STATUS[d.status].toString(16)}">
      <span class="dot"></span>${d.status.toUpperCase()}
    </div>
    <div class="kv"><span>Floor</span><span>${d.floor}</span></div>
    <div class="kv"><span>Area</span><span>${d.area} m²</span></div>
    <div class="kv"><span>Capacity</span><span>${d.capacity}</span></div>
    <div class="kv"><span>Type</span><span>${d.typeName}</span></div>
    <div class="kv"><span>Unit ID</span><span>${d.id}</span></div>`;
}

// Changes the building into an architectural "X-ray" when a floor is selected.
// The selected floor stays readable while the rest of the building becomes a
// translucent ghost. Units belonging to the selected floor remain fully visible.
// Opacity changes are tweened for a smooth crossfade instead of a hard snap.
function setObjectOpacity(root, targetOpacity, duration = 450) {
  root.traverse(obj => {
    if (!obj.isMesh || !obj.material) return;

    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];

    materials.forEach(material => {
      if (material.userData.__baseOpacity === undefined) {
        material.userData.__baseOpacity = material.opacity;
        material.userData.__baseTransparent = material.transparent;
      }

      const finalOpacity = Math.min(material.userData.__baseOpacity, targetOpacity);
      const startOpacity = material.opacity;

      material.transparent = true;
      material.depthWrite = finalOpacity > 0.5;

      animateValue({
        from: startOpacity,
        to: finalOpacity,
        duration,
        easing: easeInOutCubic,
        onUpdate: val => {
          material.opacity = val;
          material.needsUpdate = true;
        },
        onComplete: () => {
          material.transparent = finalOpacity < 0.999 || material.userData.__baseTransparent;
          material.needsUpdate = true;
        }
      });
    });
  });
}

function applyFloorFocus(floor) {
  const SELECTED_OPACITY = 0.85; // tweak this: 1 = fully solid, lower = more see-through

  floorGroups.forEach(group => {
    const isSelected = !floor || group.userData.floor === floor;
    setObjectOpacity(group, floor ? (isSelected ? SELECTED_OPACITY : 0.035) : 1);
    group.visible = true;
  });

  units.forEach(unit => {
    const isSelected = !floor || unit.userData.floor === floor;
    // keep units fully solid even if the shell is slightly transparent
    setObjectOpacity(unit, floor ? (isSelected ? 1 : 0.035) : 1);
    unit.visible = true;
  });

  const roofObjects = building.children.filter(obj => obj.userData && obj.userData.isRoof);
  roofObjects.forEach(obj => setObjectOpacity(obj, floor ? 0.035 : 1));

  scene.children.forEach(obj => {
    if (obj === building || obj.isLight || obj === ground) return;
    if (obj.userData && obj.userData.isContext) {
      setObjectOpacity(obj, floor ? 0.10 : 1);
    }
  });
}

function pulseFloor(group) {
  animateValue({
    from: 0.94,
    to: 1,
    duration: 480,
    easing: easeOutBack,
    onUpdate: s => { group.scale.set(s, 1, s); }
  });
}

function isolateFloor(floor) {
  selectedFloor = floor;
  applyFloorFocus(floor);

  if (floor) {
    const group = floorGroups.find(g => g.userData.floor === floor);
    if (group) pulseFloor(group);
  }

  document.querySelectorAll('.floor-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.floor) === floor);
  });

  const hint = document.querySelector('#modeHint');
  if (hint) {
    hint.textContent = floor
      ? `Floor ${floor} focus • other levels are transparent • click a unit`
      : 'Drag to orbit • Scroll to zoom • Click a unit';
  }

  // Clear a unit selection if it belongs to another floor.
  if (selectedUnit && floor && selectedUnit.userData.floor !== floor) {
    setUnitVisual(selectedUnit, 'normal');
    selectedUnit.scale.setScalar(1);
    selectedUnit = null;
    document.querySelector('#info').innerHTML = `
      <div class="unit-title">Floor ${floor} selected</div>
      <div class="muted">The selected level is exposed. Click one of its units to inspect it.</div>`;
  }
}

function updateExplode() {
  exploded = !exploded;
  const EXPLODE_GAP = 1.6;
  const DURATION = 650;

  floorGroups.forEach(g => {
    const floor = g.userData.floor;
    const targetY = g.userData.originalY + (exploded ? (floor - 1) * EXPLODE_GAP : 0);
    const startY = g.position.y;
    animateValue({
      from: startY,
      to: targetY,
      duration: DURATION,
      easing: easeInOutCubic,
      onUpdate: y => { g.position.y = y; }
    });
  });

  units.forEach(u => {
    const base = u.userData.originalY;
    const targetY = base + (exploded ? (u.userData.floor - 1) * EXPLODE_GAP : 0);
    const startY = u.position.y;
    animateValue({
      from: startY,
      to: targetY,
      duration: DURATION,
      easing: easeInOutCubic,
      onUpdate: y => { u.position.y = y; }
    });
  });

  document.querySelector('#explodeBtn').classList.toggle('active', exploded);
}

const floorList = document.querySelector('#floorList');
for (let floor = 4; floor >= 1; floor--) {
  const btn = document.createElement('button');
  btn.className = 'floor-btn';
  btn.dataset.floor = floor;
  btn.innerHTML = `<span>Floor ${floor}</span><small>3 units</small>`;
  btn.addEventListener('click', () => {
    if (selectedFloor === floor) {
      isolateFloor(null);
    } else {
      isolateFloor(floor);
    }
  });
  floorList.appendChild(btn);
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

renderer.domElement.addEventListener('pointerdown', event => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(units, true);
  const unit = hits.find(h => h.object.parent?.userData?.type === 'unit')?.object.parent;
  if (unit) selectUnit(unit);
});

document.querySelector('#explodeBtn').addEventListener('click', updateExplode);

document.querySelector('#resetBtn').addEventListener('click', () => {
  selectedFloor = null;
  isolateFloor(null);
  const hint = document.querySelector('#modeHint');
  if (hint) hint.textContent = 'Drag to orbit • Scroll to zoom • Click a unit';
  if (selectedUnit) setUnitVisual(selectedUnit, 'normal');
  selectedUnit = null;
  selectUnit(null);
  if (exploded) updateExplode();
  topMode = false;
  camera.position.set(12, 9, 17);
  controls.target.set(0, 5.2, 0);
  controls.maxPolarAngle = Math.PI * .49;
  controls.update();
  document.querySelector('#topBtn').classList.remove('active');
  document.querySelector('#orbitBtn').classList.add('active');
});

document.querySelector('#orbitBtn').addEventListener('click', () => {
  topMode = false;
  camera.position.set(12, 9, 17);
  controls.target.set(0, 5.2, 0);
  controls.maxPolarAngle = Math.PI * .49;
  controls.update();
  document.querySelector('#orbitBtn').classList.add('active');
  document.querySelector('#topBtn').classList.remove('active');
});

document.querySelector('#topBtn').addEventListener('click', () => {
  topMode = true;
  camera.position.set(0, 21, .01);
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI / 2.02;
  controls.update();
  document.querySelector('#topBtn').classList.add('active');
  document.querySelector('#orbitBtn').classList.remove('active');
});

document.querySelector('#search').addEventListener('input', e => {
  const q = e.target.value.trim();
  if (!q) return;
  const unit = units.find(u => u.userData.id === q);
  if (unit) {
    isolateFloor(unit.userData.floor);
    selectUnit(unit);
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  const now = performance.now();
  for (let i = tweens.length - 1; i >= 0; i--) {
    if (tweens[i].update(now)) tweens.splice(i, 1);
  }

  // Very subtle breathing animation for selected unit (paused during the click "pop").
  if (selectedUnit && !popTweenActive) {
    const s = 1 + Math.sin(clock.getElapsedTime() * 3) * .012;
    selectedUnit.scale.setScalar(s);
  }
  renderer.render(scene, camera);
}
animate();