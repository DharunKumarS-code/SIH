import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import {
  COIMBATORE_MODEL_TRANSFORM,
  COIMBATORE_INTERIOR_TRANSFORM,
  COIMBATORE_EXTERIOR_UTILITIES,
  COIMBATORE_CAMERA_PRESETS,
} from '../../lib/constants.js'

// ---------------------------------------------------------------------------
// Coimbatore Demonstration Property — 3D Property Explorer scene.
//
// TWO modes of the SAME property (COIMBATORE-DEMO-001), one Three.js scene:
//
//  - exterior: the ACTUAL user-provided ODM 2.5D textured reconstruction
//    (OBJ + MTL + 21 texture maps, /models/coimbatore-demo/) — the loaded
//    model, its transform and its per-mesh appearance are unchanged from the
//    original single-mode explorer. It's now staged inside a reproduced
//    "exterior environment" (ground/road context, an illustrative cadastral
//    parcel prism, illustrative underground utility routing, warm daylight
//    + shadows, orbit camera with presets) matching the scene composition of
//    https://snihaal2006.github.io/3D-ULPIN-Cadastre/ — the same author's
//    public demo for this property. That reference's final.obj/.mtl texture
//    paths point at the identical ODM job (job_233d755c) already used here,
//    so nothing was imported from it; only its surrounding scene/camera
//    treatment is reproduced, with this project's own geometry/loaders (see
//    buildExteriorEnvironment / applyCameraPreset below and
//    COIMBATORE_EXTERIOR_UTILITIES / COIMBATORE_CAMERA_PRESETS in
//    lib/constants.js).
//  - interior: the ACTUAL Scaniverse scan already cloned from the
//    grd-floor-viewer reference repo (OBJ + MTL + 1 texture,
//    /models/coimbatore-demo/interior/). Its own OBJ header embeds capture
//    coordinates ~15m from COIMBATORE_DEMO_PROPERTY's anchor — corroborating
//    it as the same property's interior — but it does NOT share the ODM's
//    local origin/scale/rotation, so it gets its own independent transform
//    (COIMBATORE_INTERIOR_TRANSFORM, lib/constants.js). Neither model's raw
//    vertices are ever treated as geographic coordinates. Completely
//    unchanged by the exterior rework below: same transform, same start
//    pose, same PointerLockControls/WASD walkthrough, same lighting values.
//
// Renderer / camera / scene / keyboard movement are bootstrapped ONCE and
// stay alive across mode switches — one scene, not two. Only the loaded
// model group, the environment/lighting visibility, and the active camera
// controller change when `mode` changes. Each mode's assets (and the
// exterior environment) are built at most once per explorer session (cached
// in modelsRef / envGroup); switching back to an already-visited mode reuses
// the cached Object3D — no re-fetch, no re-parse, no rebuild. Only
// unmounting the explorer (leaving the route) disposes everything.
//
// Interior keeps its original first-person interaction (click-to-lock
// pointer, WASD move, mouse look, Shift sprint, Q/E vertical move, Escape
// releases pointer lock), adapted from the grd-floor-viewer reference
// implementation (https://github.com/snihaal2006/grd-floor-viewer) — same
// PointerLockControls API, same velocity-damped movement integrator — but
// re-implemented as a React-managed Three.js scene using this project's own
// imperative mount-effect pattern (see BuildingScene.jsx /
// UndergroundScene.jsx) instead of the reference's standalone
// <script type="module"> bootstrap.
//
// Exterior instead uses an OrbitControls camera (drag to orbit, scroll to
// zoom, plus named presets), matching the 3D-ULPIN-Cadastre reference's
// interaction model. plControls (interior) and orbitControls (exterior) are
// two independent, additively-created controllers on the SAME camera —
// only one is ever `.enabled`/locked at a time (mode-switch effect below) —
// so the interior's controller and movement code are never touched by this.
// ---------------------------------------------------------------------------

const WALK_SPEED = 3.0 // m/s — human walking pace at this model's (metres) scale
const SPRINT_SPEED = 7.0 // m/s
const DAMPING = 10.0
const EYE_HEIGHT = 1.7 // m

// Exterior's start pose is EXACTLY the original single-mode explorer's
// computation — unchanged, so the existing verified starting viewpoint never
// moves.
function exteriorStartPose(box) {
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const startZ = Math.max(4, size.z * 0.4)
  return { x: center.x, y: box.min.y + EYE_HEIGHT, z: center.z + startZ }
}

// Interior has no semantic "entrance" in the raw scan (Scaniverse's "Area"
// mode capture carries no room/door labels) — the deterministic, defensible
// choice is the horizontal centre of the captured space at eye height above
// the scanned floor: for an area-mode capture this is reliably open interior
// space, never inside a wall, outside the model, under the floor or above
// the ceiling.
function interiorStartPose(box) {
  const center = box.getCenter(new THREE.Vector3())
  return { x: center.x, y: box.min.y + EYE_HEIGHT, z: center.z }
}

function applyExteriorTransform(object) {
  const t = COIMBATORE_MODEL_TRANSFORM
  object.position.set(-t.translation.sourceXCenter, -t.translation.sourceYCenter, -t.translation.sourceZFloor)
  const wrapper = new THREE.Group()
  wrapper.add(object)
  wrapper.rotation.set(...t.rotationEulerXYZ) // Z-up (source) -> Y-up (Three.js)
  wrapper.scale.setScalar(t.scale || 1)
  return wrapper
}

function applyInteriorTransform(object) {
  const t = COIMBATORE_INTERIOR_TRANSFORM
  object.position.set(-t.translation.sourceXCenter, -t.translation.sourceYFloor, -t.translation.sourceZCenter)
  const wrapper = new THREE.Group()
  wrapper.add(object)
  wrapper.rotation.set(...t.rotationEulerXYZ) // already Y-up — identity
  wrapper.scale.setScalar(t.scale || 1)
  return wrapper
}

// Coimbatore ODM/Scaniverse assets (127 MB total) are served from this base
// rather than bundled with the app. VITE_3D_ASSETS_BASE_URL is unset in local
// dev, so basePath falls back to the existing local /models/coimbatore-demo/
// path served straight out of frontend/public/ (unchanged behavior). In
// production it's set to the R2 custom-domain URL, and assets are read from
// ${VITE_3D_ASSETS_BASE_URL}/coimbatore-demo/ (R2 stores coimbatore-demo/ at
// the bucket root, not under a models/ prefix). Either way the MTL/OBJ/
// texture filenames and their relative layout never change — only the origin
// they're fetched from.
const ASSETS_BASE_URL = import.meta.env.VITE_3D_ASSETS_BASE_URL || ''
const COIMBATORE_ASSETS_ROOT = ASSETS_BASE_URL
  ? `${ASSETS_BASE_URL.replace(/\/+$/, '')}/coimbatore-demo/`
  : '/models/coimbatore-demo/'

// ---------------------------------------------------------------------------
// Exterior environment — ground/road context, an illustrative cadastral
// parcel prism, and illustrative underground utility routing, built once
// around the real ODM model's own measured bounding box the first time
// Exterior mode is activated. See COIMBATORE_EXTERIOR_UTILITIES /
// COIMBATORE_CAMERA_PRESETS (lib/constants.js) for the data-honesty
// rationale and the reference site this reproduces.
// ---------------------------------------------------------------------------
function buildExteriorEnvironment(box) {
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const halfX = Math.max(size.x / 2, 4)
  const halfZ = Math.max(size.z / 2, 4)
  const height = Math.max(size.y, 3)
  const groundY = box.min.y
  const disposables = { geometries: new Set(), materials: new Set(), textures: new Set() }
  const group = new THREE.Group()
  group.name = 'coimbatore-exterior-environment'

  // Ground context plane — extends well beyond the model's own footprint so
  // the real ODM mesh (which already includes its own captured immediate
  // ground) reads as sitting within a wider plot/street context, matching
  // the reference site's ground treatment. Muted neutral material — the ODM
  // mesh itself is the real capture; no fabricated satellite imagery here.
  const groundSize = Math.max(halfX, halfZ) * 6
  const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize)
  groundGeo.rotateX(-Math.PI / 2)
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x2b3040, roughness: 0.95, metalness: 0.05 })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.position.set(center.x, groundY - 0.02, center.z)
  ground.receiveShadow = true
  group.add(ground)
  disposables.geometries.add(groundGeo)
  disposables.materials.add(groundMat)

  // Road plane + centre stripe, offset beyond the parcel — the reference
  // site's "roads/street context" element.
  const roadZ = center.z + halfZ * 1.6
  const roadWidth = Math.max(halfX * 3, 12)
  const roadGeo = new THREE.PlaneGeometry(groundSize, roadWidth)
  roadGeo.rotateX(-Math.PI / 2)
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x1e242f, roughness: 0.9, metalness: 0.05 })
  const road = new THREE.Mesh(roadGeo, roadMat)
  road.position.set(center.x, groundY + 0.01, roadZ)
  road.receiveShadow = true
  group.add(road)
  disposables.geometries.add(roadGeo)
  disposables.materials.add(roadMat)

  const stripeGeo = new THREE.PlaneGeometry(groundSize, Math.max(halfX, halfZ) * 0.02)
  stripeGeo.rotateX(-Math.PI / 2)
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })
  const stripe = new THREE.Mesh(stripeGeo, stripeMat)
  stripe.position.set(center.x, groundY + 0.02, roadZ)
  group.add(stripe)
  disposables.geometries.add(stripeGeo)
  disposables.materials.add(stripeMat)

  // Illustrative cadastral parcel prism — translucent volume + wireframe
  // edges + 4 corner boundary stones, sized proportionate to the model's own
  // footprint. Never a fabricated absolute survey size (see the constants
  // file's data-honesty note).
  const parcelW = halfX * 2 * 1.5
  const parcelL = halfZ * 2 * 1.5
  const heightAbove = height * 1.6
  const depthBelow = height * 0.6
  const totalH = heightAbove + depthBelow
  const prismGeo = new THREE.BoxGeometry(parcelW, totalH, parcelL)
  const prismMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b, transparent: true, opacity: 0.1, roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide,
  })
  const prism = new THREE.Mesh(prismGeo, prismMat)
  prism.position.set(center.x, groundY + (heightAbove - depthBelow) / 2, center.z)
  group.add(prism)
  disposables.geometries.add(prismGeo)
  disposables.materials.add(prismMat)

  const edgesGeo = new THREE.EdgesGeometry(prismGeo)
  const edgesMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.7 })
  const wireframe = new THREE.LineSegments(edgesGeo, edgesMat)
  prism.add(wireframe)
  disposables.geometries.add(edgesGeo)
  disposables.materials.add(edgesMat)

  const stoneGeo = new THREE.CylinderGeometry(parcelW * 0.015, parcelW * 0.018, height * 0.12, 12)
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })
  disposables.geometries.add(stoneGeo)
  disposables.materials.add(stoneMat)
  const corners = [
    [center.x - parcelW / 2, center.z - parcelL / 2],
    [center.x + parcelW / 2, center.z - parcelL / 2],
    [center.x + parcelW / 2, center.z + parcelL / 2],
    [center.x - parcelW / 2, center.z + parcelL / 2],
  ]
  corners.forEach(([x, z]) => {
    const stone = new THREE.Mesh(stoneGeo, stoneMat)
    stone.position.set(x, groundY + height * 0.06, z)
    stone.castShadow = true
    group.add(stone)
  })

  // Illustrative (not surveyed) underground utility routing — generic
  // labelled tubes below grade, visible through the semi-transparent parcel
  // volume from the exterior. See COIMBATORE_EXTERIOR_UTILITIES for the
  // data-honesty rationale (no fabricated diameters/materials/operators).
  const utilityGroup = new THREE.Group()
  utilityGroup.name = 'coimbatore-exterior-utilities'
  COIMBATORE_EXTERIOR_UTILITIES.forEach((u, idx) => {
    const depth = groundY - height * u.depthFrac
    const offset = halfZ * u.offsetFrac * (idx % 2 === 0 ? 1 : -1)
    const points = [
      new THREE.Vector3(center.x - groundSize / 2, depth, center.z + offset),
      new THREE.Vector3(center.x + groundSize / 2, depth, center.z + offset),
    ]
    const curve = new THREE.CatmullRomCurve3(points)
    const radius = Math.max(height * 0.04, 0.08)
    const tubeGeo = new THREE.TubeGeometry(curve, 24, radius, 12, false)
    const tubeMat = new THREE.MeshStandardMaterial({
      color: u.color, emissive: u.color, emissiveIntensity: 0.3, roughness: 0.35, metalness: 0.4,
      transparent: true, opacity: 0.95,
    })
    const tube = new THREE.Mesh(tubeGeo, tubeMat)
    tube.userData = { utilityId: u.id, label: u.label }
    utilityGroup.add(tube)
    disposables.geometries.add(tubeGeo)
    disposables.materials.add(tubeMat)
  })
  group.add(utilityGroup)

  return { group, disposables }
}

// Applies a named exterior camera preset (COIMBATORE_CAMERA_PRESETS) via
// OrbitControls' documented technique: set camera position + controls
// target, then call update() so its internal spherical state is recomputed
// from them (never set camera.quaternion directly — OrbitControls owns
// orientation and would just overwrite it on the next frame).
function applyCameraPreset(st, key) {
  const preset = COIMBATORE_CAMERA_PRESETS[key] || COIMBATORE_CAMERA_PRESETS.front
  const box = st.envBox
  if (!box) return
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const halfX = Math.max(size.x / 2, 4)
  const halfZ = Math.max(size.z / 2, 4)
  const height = Math.max(size.y, 3)
  const [px, py, pz] = preset.posFrac
  const [tx, ty, tz] = preset.targetFrac
  st.camera.position.set(center.x + px * halfX, box.min.y + py * height, center.z + pz * halfZ)
  st.orbitControls.target.set(center.x + tx * halfX, box.min.y + ty * height, center.z + tz * halfZ)
  st.orbitControls.update()
}

const MODEL_CONFIGS = {
  exterior: {
    label: 'Exterior',
    basePath: COIMBATORE_ASSETS_ROOT,
    objFile: 'odm_textured_model_geo.obj',
    mtlFile: 'odm_textured_model_geo.mtl',
    applyTransform: applyExteriorTransform,
    getStartPose: exteriorStartPose,
    sizeLabel: '37 MB geometry + 62 MB / 21 textures',
  },
  interior: {
    label: 'Interior',
    basePath: `${COIMBATORE_ASSETS_ROOT}interior/`,
    objFile: 'Scaniverse_2026_09_14_180438.obj',
    mtlFile: 'Scaniverse_2026_09_14_180438.mtl',
    applyTransform: applyInteriorTransform,
    getStartPose: interiorStartPose,
    sizeLabel: '~19 MB geometry + ~12 MB texture',
  },
}

export const CoimbatorePropertyScene = forwardRef(function CoimbatorePropertyScene(
  { mode, onStatusChange, onLockChange },
  ref,
) {
  const mountRef = useRef(null)
  const stateRef = useRef(null) // { scene, camera, renderer, plControls, orbitControls, interiorLights, exteriorLights, models: Map<mode, {wrapper, disposables}>, currentMode, envGroup, envDisposables, envBox }
  const loadTokenRef = useRef(0) // bumped on every mode switch — guards against a stale (superseded) load applying itself
  const cbRef = useRef({ onStatusChange, onLockChange })
  useEffect(() => {
    cbRef.current = { onStatusChange, onLockChange }
  }, [onStatusChange, onLockChange])

  useImperativeHandle(ref, () => ({
    // Interior: enters pointer-lock first-person walkthrough (unchanged).
    // Exterior: there is no pointer-lock concept for the orbit camera — this
    // just dismisses the "click to start" blocker so orbit/zoom/pan work.
    lock: () => {
      const st = stateRef.current
      if (!st) return
      if (st.currentMode === 'interior') st.plControls.lock()
      else cbRef.current.onLockChange?.(true)
    },
    setCameraPreset: (key) => {
      const st = stateRef.current
      if (!st || st.currentMode !== 'exterior' || !st.envBox) return
      applyCameraPreset(st, key)
    },
  }), [])

  // ---- one-time scene/renderer/controls bootstrap — survives mode switches ----
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x151922)
    scene.fog = new THREE.FogExp2(0x151922, 0.012)

    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000)
    camera.position.set(0, EYE_HEIGHT, 6)

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'

    // Interior lighting — UNCHANGED from the original single-mode explorer.
    // Grouped so it can be shown/hidden per mode without altering its values.
    const interiorLights = new THREE.Group()
    interiorLights.add(new THREE.HemisphereLight(0xffffff, 0x30303a, 0.9))
    const interiorKey = new THREE.DirectionalLight(0xffffff, 0.55)
    interiorKey.position.set(10, 20, 10)
    interiorLights.add(interiorKey)
    scene.add(interiorLights)

    // Exterior lighting — warm sun + sky fill + soft shadows, matching the
    // reference site's outdoor daylight treatment. Only visible while
    // mode === 'exterior' (see the mode-switch effect).
    const exteriorLights = new THREE.Group()
    exteriorLights.add(new THREE.AmbientLight(0xffffff, 0.55))
    const sun = new THREE.DirectionalLight(0xfff3d6, 1.15)
    sun.position.set(18, 24, 14)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 0.5
    sun.shadow.camera.far = 120
    sun.shadow.camera.left = -30
    sun.shadow.camera.right = 30
    sun.shadow.camera.top = 30
    sun.shadow.camera.bottom = -30
    sun.shadow.bias = -0.0005
    exteriorLights.add(sun)
    const skyFill = new THREE.DirectionalLight(0x70a6ff, 0.4)
    skyFill.position.set(-14, 12, -14)
    exteriorLights.add(skyFill)
    scene.add(exteriorLights)

    // Three r170+ PointerLockControls drives `camera` directly (no separate
    // yaw/pitch wrapper object) — nothing extra needs adding to the scene.
    // UNCHANGED interior control path — first-person walkthrough, only
    // active while mode === 'interior' (nothing calls plControls.lock() in
    // exterior mode, so it stays inert there).
    const plControls = new PointerLockControls(camera, renderer.domElement)
    plControls.addEventListener('lock', () => cbRef.current.onLockChange?.(true))
    plControls.addEventListener('unlock', () => cbRef.current.onLockChange?.(false))

    // Orbit camera for the exterior environment (ground/parcel/utilities),
    // matching the reference site's interaction model. Disabled by default
    // and only enabled while mode === 'exterior' (mode-switch effect below)
    // so it never competes with plControls during an interior walkthrough.
    const orbitControls = new OrbitControls(camera, renderer.domElement)
    orbitControls.enableDamping = true
    orbitControls.dampingFactor = 0.08
    orbitControls.maxPolarAngle = Math.PI / 2 + 0.3
    orbitControls.minDistance = 1
    orbitControls.enabled = false

    // ---- WASD / Shift / Q-E movement (adapted from grd-floor-viewer/app.js) ----
    // Shared by both modes — spec requires one reusable controller, not two.
    const move = { forward: false, backward: false, left: false, right: false, up: false, down: false, sprint: false }
    const velocity = new THREE.Vector3()
    const direction = new THREE.Vector3()
    let prevTime = performance.now()

    const onKeyDown = (e) => {
      switch (e.code) {
        case 'ArrowUp': case 'KeyW': move.forward = true; break
        case 'ArrowLeft': case 'KeyA': move.left = true; break
        case 'ArrowDown': case 'KeyS': move.backward = true; break
        case 'ArrowRight': case 'KeyD': move.right = true; break
        case 'ShiftLeft': case 'ShiftRight': move.sprint = true; break
        case 'KeyE': move.up = true; break
        case 'KeyQ': move.down = true; break
        default: break
      }
    }
    const onKeyUp = (e) => {
      switch (e.code) {
        case 'ArrowUp': case 'KeyW': move.forward = false; break
        case 'ArrowLeft': case 'KeyA': move.left = false; break
        case 'ArrowDown': case 'KeyS': move.backward = false; break
        case 'ArrowRight': case 'KeyD': move.right = false; break
        case 'ShiftLeft': case 'ShiftRight': move.sprint = false; break
        case 'KeyE': move.up = false; break
        case 'KeyQ': move.down = false; break
        default: break
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)

    const resize = () => {
      const w = mount.clientWidth || 1
      const h = mount.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    let raf
    const tick = () => {
      const time = performance.now()
      if (plControls.isLocked) {
        let delta = (time - prevTime) / 1000
        if (delta > 0.1) delta = 0.1
        velocity.x -= velocity.x * DAMPING * delta
        velocity.z -= velocity.z * DAMPING * delta
        velocity.y -= velocity.y * DAMPING * delta

        direction.z = Number(move.forward) - Number(move.backward)
        direction.x = Number(move.right) - Number(move.left)
        direction.y = Number(move.up) - Number(move.down)
        direction.normalize()

        const speed = move.sprint ? SPRINT_SPEED : WALK_SPEED
        if (move.forward || move.backward) velocity.z -= direction.z * speed * delta
        if (move.left || move.right) velocity.x -= direction.x * speed * delta
        if (move.up || move.down) velocity.y += direction.y * speed * delta

        plControls.moveRight(-velocity.x * delta)
        plControls.moveForward(-velocity.z * delta)
        camera.position.y += velocity.y * delta
      }
      if (orbitControls.enabled) orbitControls.update()
      prevTime = time
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()

    stateRef.current = {
      scene, camera, renderer, plControls, orbitControls, interiorLights, exteriorLights,
      models: new Map(), currentMode: null,
      envGroup: null, envDisposables: null, envBox: null,
    }

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      plControls.dispose()
      orbitControls.dispose()
      // Dispose every cached mode's geometry/material/textures — only on
      // full unmount (leaving /coimbatore-explorer), never on a mode switch.
      for (const entry of stateRef.current?.models.values() || []) {
        for (const g of entry.disposables.geometries) g.dispose()
        for (const m of entry.disposables.materials) m.dispose()
        for (const tex of entry.disposables.textures) tex.dispose()
      }
      const envDisp = stateRef.current?.envDisposables
      if (envDisp) {
        for (const g of envDisp.geometries) g.dispose()
        for (const m of envDisp.materials) m.dispose()
        for (const tex of envDisp.textures) tex.dispose()
      }
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [])

  // ---- mode switch: load (once) or reuse the requested mode's model ----
  useEffect(() => {
    const st = stateRef.current
    const config = MODEL_CONFIGS[mode]
    if (!st || !config) return undefined

    const token = ++loadTokenRef.current
    // Leaving pointer lock on a mode switch is the documented, acceptable
    // pattern (spec: "Escape -> choose mode -> click to re-enter") — never
    // leave the user locked onto a scene mid-transition.
    if (st.plControls.isLocked) st.plControls.unlock()
    st.orbitControls.enabled = mode === 'exterior'
    st.interiorLights.visible = mode === 'interior'
    st.exteriorLights.visible = mode === 'exterior'
    if (st.envGroup) st.envGroup.visible = mode === 'exterior'
    // Any mode switch shows the "click to start" blocker again — matches the
    // existing unlock-driven reset for interior, extended so it also covers
    // the orbit-camera exterior (which has no pointer-lock unlock event).
    cbRef.current.onLockChange?.(false)

    const activate = (entry) => {
      if (loadTokenRef.current !== token) return // superseded by a later switch
      if (st.currentMode && st.currentMode !== mode) {
        const prev = st.models.get(st.currentMode)
        if (prev) st.scene.remove(prev.wrapper)
      }
      if (!st.scene.children.includes(entry.wrapper)) st.scene.add(entry.wrapper)
      st.currentMode = mode
      const box = new THREE.Box3().setFromObject(entry.wrapper)

      if (mode === 'exterior') {
        // Environment (ground/road/parcel prism/utilities) is built once,
        // sized off the real model's own measured box, then just shown/hidden
        // on later switches — same "fetch/build at most once" lifecycle as
        // the models themselves.
        if (!st.envGroup) {
          const built = buildExteriorEnvironment(box)
          st.envGroup = built.group
          st.envDisposables = built.disposables
          st.scene.add(st.envGroup)
        }
        st.envGroup.visible = true
        st.envBox = box
        applyCameraPreset(st, 'front')
      } else {
        const pose = config.getStartPose(box)
        st.camera.position.set(pose.x, pose.y, pose.z)
        st.camera.quaternion.identity() // consistent, deterministic starting look direction each time interior is entered
      }

      cbRef.current.onStatusChange?.('ready')
    }

    const cached = st.models.get(mode)
    if (cached) {
      activate(cached)
      return undefined
    }

    cbRef.current.onStatusChange?.('loading-materials')
    const mtlLoader = new MTLLoader()
    mtlLoader.setPath(config.basePath)
    mtlLoader.load(
      config.mtlFile,
      (materials) => {
        if (loadTokenRef.current !== token) return
        materials.preload()
        cbRef.current.onStatusChange?.('loading-geometry')
        const objLoader = new OBJLoader()
        objLoader.setMaterials(materials)
        objLoader.setPath(config.basePath)
        objLoader.load(
          config.objFile,
          (object) => {
            if (loadTokenRef.current !== token) return
            const disposables = { textures: new Set(), geometries: new Set(), materials: new Set() }
            object.traverse((o) => {
              if (o.geometry) disposables.geometries.add(o.geometry)
              const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
              for (const m of mats) {
                disposables.materials.add(m)
                for (const key of ['map', 'normalMap', 'specularMap', 'aoMap', 'emissiveMap']) {
                  if (m[key]) disposables.textures.add(m[key])
                }
              }
            })
            const wrapper = config.applyTransform(object)
            const entry = { wrapper, disposables }
            st.models.set(mode, entry)
            activate(entry)
          },
          undefined,
          (err) => {
            if (loadTokenRef.current === token) cbRef.current.onStatusChange?.('error')
            console.error(`Coimbatore ${mode}: OBJ load failed`, err)
          },
        )
      },
      undefined,
      (err) => {
        if (loadTokenRef.current === token) cbRef.current.onStatusChange?.('error')
        console.error(`Coimbatore ${mode}: MTL load failed`, err)
      },
    )
    return undefined
  }, [mode])

  return <div ref={mountRef} className="h-full w-full" data-testid="coimbatore-property-scene" />
})

export { MODEL_CONFIGS }
