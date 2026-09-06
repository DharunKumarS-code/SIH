import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// ---------------------------------------------------------------------------
// Detailed 3D Building Explorer — focused Three.js visualisation (Phase 10).
//
// This is deliberately NOT a second Chennai GIS viewer. It renders ONE building
// from the prototype 3D volume model (stacked floor slabs + the apartments on
// the selected floor) so an officer can inspect a single property in isolation.
// The Chennai-wide geographic context stays in the single CesiumJS viewer on
// /map. Data comes from the existing backend (GET /api/buildings/:id,
// /api/floors/:id) — nothing is duplicated or fabricated here.
//
// Light government palette only: off-white ground, muted navy/slate massing,
// a single restrained amber for the active selection. No neon, no glass.
// ---------------------------------------------------------------------------

const M_PER_DEG_LAT = 111320
const mPerDegLon = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
const finite = (n) => typeof n === 'number' && Number.isFinite(n)
const DEFAULT_STOREY_M = 3

const COLORS = {
  ground: 0xeef1f5,
  grid: 0xd5dde8,
  gridCenter: 0xc0cbdb,
  shell: 0x94a3b8,
  floor: 0x64748b,
  floorActive: 0x1e5fa8,
  unit: 0x93a4bb,
  unitActive: 0xb7791f,
  outline: 0x475569,
}

/** Local-metre box {cx,cy,cz,w,h,d} for a volume, relative to `origin` (deg). */
function boxFor(v, origin, fallback) {
  if (!v) return null
  const hasXY = finite(v.xmin) && finite(v.xmax) && finite(v.ymin) && finite(v.ymax)
  const latRef = origin.lat
  let w = fallback?.w ?? 16
  let d = fallback?.d ?? 16
  let cx = 0
  let cz = 0
  if (hasXY) {
    const x0 = (v.xmin - origin.lon) * mPerDegLon(latRef)
    const x1 = (v.xmax - origin.lon) * mPerDegLon(latRef)
    // North (+lat) maps to -Z so the model faces the viewer like a map.
    const z0 = -(v.ymin - origin.lat) * M_PER_DEG_LAT
    const z1 = -(v.ymax - origin.lat) * M_PER_DEG_LAT
    w = Math.max(Math.abs(x1 - x0), 1)
    d = Math.max(Math.abs(z1 - z0), 1)
    cx = (x0 + x1) / 2
    cz = (z0 + z1) / 2
  }
  const y0 = finite(v.zmin) ? v.zmin : fallback?.y0 ?? 0
  const y1 = finite(v.zmax) ? v.zmax : fallback?.y1 ?? y0 + DEFAULT_STOREY_M
  const h = Math.max(Math.abs(y1 - y0), 0.5)
  return { cx, cy: (y0 + y1) / 2, cz, w, h, d, y0, y1 }
}

export function BuildingScene({
  building,
  floors = [],
  units = [],
  activeFloorId,
  activeUnitId,
  onSelectFloor,
  onSelectUnit,
}) {
  const mountRef = useRef(null)
  const stateRef = useRef(null)
  const cbRef = useRef({ onSelectFloor, onSelectUnit })
  useEffect(() => {
    cbRef.current = { onSelectFloor, onSelectUnit }
  }, [onSelectFloor, onSelectUnit])

  // ---- one-time scene bootstrap ----
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf5f7fa)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000)
    camera.position.set(60, 55, 80)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI / 2.02
    controls.minDistance = 8
    controls.maxDistance = 600

    scene.add(new THREE.AmbientLight(0xffffff, 0.85))
    const key = new THREE.DirectionalLight(0xffffff, 0.65)
    key.position.set(40, 80, 30)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.25)
    fill.position.set(-50, 30, -40)
    scene.add(fill)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.02
    ground.name = 'ground'
    scene.add(ground)

    const grid = new THREE.GridHelper(400, 40, COLORS.gridCenter, COLORS.grid)
    grid.position.y = 0
    scene.add(grid)

    const content = new THREE.Group()
    content.name = 'content'
    scene.add(content)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let down = null

    const onPointerDown = (e) => { down = { x: e.clientX, y: e.clientY } }
    const onPointerUp = (e) => {
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > 5) return
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects(content.children, true)
      const hit = hits.find((h) => h.object?.userData?.pickable)
      if (!hit) return
      const { type, id } = hit.object.userData
      if (type === 'unit') cbRef.current.onSelectUnit?.(id)
      else if (type === 'floor') cbRef.current.onSelectFloor?.(id)
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)

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
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()

    stateRef.current = { scene, camera, renderer, controls, content, framedFor: null }

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      controls.dispose()
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose())
      })
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [])

  // ---- rebuild massing whenever the data / selection changes ----
  useEffect(() => {
    const st = stateRef.current
    if (!st || !building) return

    const { content } = st
    while (content.children.length) {
      const c = content.children.pop()
      c.traverse?.((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose())
      })
    }

    const bv = building.volume || {}
    const origin = {
      lon: finite(bv.xmin) && finite(bv.xmax) ? (bv.xmin + bv.xmax) / 2 : 80.22705,
      lat: finite(bv.ymin) && finite(bv.ymax) ? (bv.ymin + bv.ymax) / 2 : 12.90045,
    }

    // Building footprint size (for fallbacks when a floor/unit volume lacks XY).
    const shellBox = boxFor(bv, origin, { w: 20, d: 20, y0: 0, y1: (floors.length || 4) * DEFAULT_STOREY_M })
    const fpW = shellBox?.w ?? 20
    const fpD = shellBox?.d ?? 20

    // Translucent building shell.
    if (shellBox) {
      const shell = new THREE.Mesh(
        new THREE.BoxGeometry(shellBox.w, shellBox.h, shellBox.d),
        new THREE.MeshStandardMaterial({
          color: COLORS.shell, transparent: true, opacity: 0.08, depthWrite: false, roughness: 1,
        }),
      )
      shell.position.set(shellBox.cx, shellBox.h / 2, shellBox.cz)
      content.add(shell)
    }

    // Floor slabs, stacked bottom→top.
    const ordered = [...floors].sort((a, b) => (a.floorNumber ?? 0) - (b.floorNumber ?? 0))
    ordered.forEach((f, i) => {
      const fb =
        boxFor(f.volume, origin, {
          w: fpW, d: fpD,
          y0: i * DEFAULT_STOREY_M,
          y1: i * DEFAULT_STOREY_M + DEFAULT_STOREY_M,
        }) || null
      if (!fb) return
      const isActive = f.floorId === activeFloorId
      const slabH = Math.min(fb.h * 0.55, DEFAULT_STOREY_M * 0.5)
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(fb.w, slabH, fb.d),
        new THREE.MeshStandardMaterial({
          color: isActive ? COLORS.floorActive : COLORS.floor,
          transparent: true,
          opacity: isActive ? 0.5 : 0.16,
          roughness: 0.9,
        }),
      )
      mesh.position.set(fb.cx, fb.y0 + slabH / 2, fb.cz)
      mesh.userData = { pickable: true, type: 'floor', id: f.floorId }
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: isActive ? COLORS.floorActive : COLORS.outline, transparent: true, opacity: isActive ? 0.8 : 0.3 }),
      )
      mesh.add(edges)
      content.add(mesh)
    })

    // Apartments / units on the active floor.
    const activeFloor = ordered.find((f) => f.floorId === activeFloorId)
    const floorIdx = Math.max(0, ordered.findIndex((f) => f.floorId === activeFloorId))
    const activeFb = activeFloor
      ? boxFor(activeFloor.volume, origin, {
          w: fpW, d: fpD, y0: floorIdx * DEFAULT_STOREY_M, y1: floorIdx * DEFAULT_STOREY_M + DEFAULT_STOREY_M,
        })
      : null
    const baseY = activeFb?.y0 ?? floorIdx * DEFAULT_STOREY_M

    const cols = Math.max(1, ...units.map((u) => (u.gridCol ?? 0) + 1))
    const rows = Math.max(1, ...units.map((u) => (u.gridRow ?? 0) + 1))

    units.forEach((u, i) => {
      let ub = boxFor(u.volume, origin, null)
      const hasOwnFootprint = ub && (finite(u.volume?.xmin))
      if (!hasOwnFootprint) {
        // Lay the unit out on the floor's grid as a fallback.
        const gc = u.gridCol ?? i % cols
        const gr = u.gridRow ?? Math.floor(i / cols)
        const cellW = (fpW * 0.82) / cols
        const cellD = (fpD * 0.82) / rows
        const x = -fpW * 0.41 + cellW * (gc + 0.5)
        const z = -fpD * 0.41 + cellD * (gr + 0.5)
        ub = { cx: (activeFb?.cx ?? 0) + x, cz: (activeFb?.cz ?? 0) + z, w: cellW * 0.88, d: cellD * 0.88, h: DEFAULT_STOREY_M * 0.8, y0: baseY }
      }
      const isActive = u.unitId === activeUnitId || u.propertyId === activeUnitId
      const h = ub.h || DEFAULT_STOREY_M * 0.8
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(ub.w, h, ub.d),
        new THREE.MeshStandardMaterial({
          color: isActive ? COLORS.unitActive : COLORS.unit,
          roughness: 0.85,
          transparent: !isActive,
          opacity: isActive ? 1 : 0.9,
          emissive: isActive ? new THREE.Color(COLORS.unitActive) : new THREE.Color(0x000000),
          emissiveIntensity: isActive ? 0.18 : 0,
        }),
      )
      mesh.position.set(ub.cx, (ub.y0 ?? baseY) + h / 2 + 0.05, ub.cz)
      mesh.userData = { pickable: true, type: 'unit', id: u.propertyId || u.unitId }
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: COLORS.outline, transparent: true, opacity: 0.45 }),
      )
      mesh.add(edges)
      content.add(mesh)
    })

    // Frame the camera on the building once (not on every selection change).
    const frameKey = building.buildingId || building.volume?.volumeId || 'b'
    if (st.framedFor !== frameKey && shellBox) {
      st.framedFor = frameKey
      const span = Math.max(shellBox.w, shellBox.d, shellBox.h, 12)
      st.controls.target.set(shellBox.cx, shellBox.h / 2, shellBox.cz)
      st.camera.position.set(shellBox.cx + span * 1.1, shellBox.h + span * 0.9, shellBox.cz + span * 1.3)
      st.camera.near = 0.1
      st.camera.far = span * 40
      st.camera.updateProjectionMatrix()
      st.controls.update()
    }
  }, [building, floors, units, activeFloorId, activeUnitId])

  return <div ref={mountRef} className="h-full w-full" data-testid="building-scene" />
}
