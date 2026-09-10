import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  UNDERGROUND_LAYERS, layerForType, toLocalMeters, geometryCentroid,
  drawDepth, drawThickness, drawWidth, depthVisibility,
} from '../../lib/underground3d.js'

// ---------------------------------------------------------------------------
// Underground Infrastructure 3D Explorer — the ONE Three.js WebGL scene.
//
// This is NOT a second Chennai geographic viewer. The Chennai-wide map stays in
// the single CesiumJS viewer on /map. This scene renders a focused CUTAWAY
// section of the ground for ONE locality / property: translucent surface +
// soil, simplified building massing above, and the underground utility network
// below, each object positioned at the depth the source data actually supplied
// (spec sections 3, 8-9). Nothing here fabricates geometry, depth or ownership.
//
// Light government palette only — off-white ground, muted soil, restrained
// per-layer colours + distinct object shapes. No dark theme, no neon.
// ---------------------------------------------------------------------------

const SOIL_DEPTH = 22 // metres of soil volume drawn below the surface cut

const COLORS = {
  bg: 0xf5f7fa,
  ground: 0xe8edf3,
  grid: 0xd5dde8,
  gridCenter: 0xc0cbdb,
  soilHex: 0xd8cbb3,
  road: 0xb8c0cc,
  parcel: 0x1e5fa8,
  building: 0x9aa7ba,
  buildingEdge: 0x64748b,
  selection: 0xf59e0b,
  unknownTray: 0x94a3b8,
}

const hexToInt = (h) => parseInt(String(h).replace('#', ''), 16)

/** Vector3 in scene space from a local [east, north] metres pair + up (Y) metres. */
const v3 = (east, north, up) => new THREE.Vector3(east, up, -north)

// Segment-oriented box between two Vector3 points, given cross-section w × h.
function segmentBox(a, b, w, h, material) {
  const len = a.distanceTo(b)
  if (!(len > 0.01)) return null
  const geo = new THREE.BoxGeometry(w, h, len)
  const mesh = new THREE.Mesh(geo, material)
  mesh.position.copy(a).lerp(b, 0.5)
  mesh.lookAt(b)
  return mesh
}

function disposeTree(obj) {
  obj.traverse?.((o) => {
    if (o.geometry) o.geometry.dispose()
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose())
  })
}

export function UndergroundScene({
  origin,
  infra = [],
  buildings = [],
  parcels = [],
  visibleLayers,
  depthState = { sliceDepth: 6, mode: 'ALL' },
  viewMode = 'CUTAWAY',
  selectedId = null,
  onSelect,
  command = null,
}) {
  const mountRef = useRef(null)
  const stateRef = useRef(null)
  const cbRef = useRef({ onSelect })
  useEffect(() => { cbRef.current = { onSelect } }, [onSelect])

  // ---- one-time bootstrap ----
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(COLORS.bg)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20000)
    camera.position.set(120, 90, 150)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.localClippingEnabled = true
    mount.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 6
    controls.maxDistance = 2000

    scene.add(new THREE.AmbientLight(0xffffff, 0.9))
    const key = new THREE.DirectionalLight(0xffffff, 0.6)
    key.position.set(80, 160, 60)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.25)
    fill.position.set(-90, 60, -80)
    scene.add(fill)

    // Groups: surface (ground + road + parcels + buildings), soil, infra.
    const surface = new THREE.Group(); surface.name = 'surface'; scene.add(surface)
    const soil = new THREE.Group(); soil.name = 'soil'; scene.add(soil)
    const infraGroup = new THREE.Group(); infraGroup.name = 'infra'; scene.add(infraGroup)

    const grid = new THREE.GridHelper(1200, 60, COLORS.gridCenter, COLORS.grid)
    surface.add(grid)

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
      const hits = raycaster.intersectObjects(infraGroup.children, true)
      const hit = hits.find((h) => h.object?.userData?.pickable && h.object.visible)
      if (hit) cbRef.current.onSelect?.(hit.object.userData.id)
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

    stateRef.current = {
      scene, camera, renderer, controls, surface, soil, infraGroup,
      meshById: new Map(), framed: false, extent: 400,
    }

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      controls.dispose()
      disposeTree(scene)
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [])

  // ---- rebuild surface (ground / road / parcels / buildings) ----
  useEffect(() => {
    const st = stateRef.current
    if (!st || !origin) return
    const { surface } = st

    // keep the grid (child 0), drop the rest
    for (let i = surface.children.length - 1; i >= 1; i -= 1) {
      const c = surface.children[i]; surface.remove(c); disposeTree(c)
    }

    // Determine a working extent from the infra + buildings so the cut plane
    // and camera framing are sensible.
    let maxR = 120
    const bump = (coord) => {
      const [e, n] = toLocalMeters(coord, origin)
      maxR = Math.max(maxR, Math.abs(e), Math.abs(n))
    }
    infra.forEach((r) => {
      const g = r.geometry
      if (!g) return
      if (g.type === 'LineString') g.coordinates.forEach(bump)
      else if (g.type === 'Point') bump(g.coordinates)
      else if (g.type === 'Polygon') (g.coordinates[0] || []).forEach(bump)
    })
    const extent = Math.ceil((maxR + 60) / 20) * 20
    st.extent = extent

    // Ground surface — translucent so the cutaway reads through it.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(extent * 2, extent * 2),
      new THREE.MeshStandardMaterial({
        color: COLORS.ground, roughness: 1, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = 0
    ground.name = 'ground-surface'
    surface.add(ground)

    // A simple road strip across the section (context only, not authoritative).
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(extent * 2, 12),
      new THREE.MeshStandardMaterial({ color: COLORS.road, roughness: 1, transparent: true, opacity: 0.6 }),
    )
    road.rotation.x = -Math.PI / 2
    road.position.y = 0.05
    surface.add(road)

    // Parcel boundaries.
    parcels.forEach((f) => {
      const ring = f?.geometry?.coordinates?.[0]
      if (!Array.isArray(ring) || ring.length < 3) return
      const pts = ring.map((c) => {
        const [e, n] = toLocalMeters(c, origin)
        return v3(e, n, 0.1)
      })
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: COLORS.parcel, transparent: true, opacity: 0.7 }),
      )
      line.userData.parcelBoundary = true
      surface.add(line)
    })

    // Simplified building massing above ground.
    buildings.forEach((f) => {
      const ring = f?.geometry?.coordinates?.[0]
      if (!Array.isArray(ring) || ring.length < 3) return
      let minE = Infinity; let maxE = -Infinity; let minN = Infinity; let maxN = -Infinity
      ring.forEach((c) => {
        const [e, n] = toLocalMeters(c, origin)
        minE = Math.min(minE, e); maxE = Math.max(maxE, e)
        minN = Math.min(minN, n); maxN = Math.max(maxN, n)
      })
      const w = Math.max(maxE - minE, 3)
      const d = Math.max(maxN - minN, 3)
      const p = f.properties || {}
      const h = Number.isFinite(Number(p.heightM))
        ? Number(p.heightM)
        : Number.isFinite(Number(p.totalFloors)) ? Number(p.totalFloors) * 3 : 18
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({
          color: COLORS.building, roughness: 0.9, transparent: true, opacity: 0.5, depthWrite: false,
        }),
      )
      mesh.position.set((minE + maxE) / 2, h / 2, -(minN + maxN) / 2)
      mesh.userData.building = true
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: COLORS.buildingEdge, transparent: true, opacity: 0.35 }),
      )
      mesh.add(edges)
      surface.add(mesh)
    })

    // ---- soil volume ----
    for (let i = st.soil.children.length - 1; i >= 0; i -= 1) {
      const c = st.soil.children[i]; st.soil.remove(c); disposeTree(c)
    }
    const soilBox = new THREE.Mesh(
      new THREE.BoxGeometry(extent * 2, SOIL_DEPTH, extent * 2),
      new THREE.MeshStandardMaterial({
        color: COLORS.soilHex, roughness: 1, transparent: true, opacity: 0.12, depthWrite: false,
      }),
    )
    soilBox.position.y = -SOIL_DEPTH / 2
    soilBox.userData.soil = true
    st.soil.add(soilBox)
    const soilEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(soilBox.geometry),
      new THREE.LineBasicMaterial({ color: COLORS.buildingEdge, transparent: true, opacity: 0.25 }),
    )
    soilBox.add(soilEdges)

    st.framed = false
  }, [origin, buildings, parcels, infra])

  // ---- rebuild infra network ----
  useEffect(() => {
    const st = stateRef.current
    if (!st || !origin) return
    const { infraGroup } = st

    for (let i = infraGroup.children.length - 1; i >= 0; i -= 1) {
      const c = infraGroup.children[i]; infraGroup.remove(c); disposeTree(c)
    }
    st.meshById = new Map()

    let unknownIdx = 0
    infra.forEach((rec) => {
      const layer = layerForType(rec.type)
      const color = hexToInt(layer.color)
      const { value: depthVal, known } = drawDepth(rec)
      const thickness = drawThickness(rec)
      const width = drawWidth(rec)
      // Unknown depth: render in a shallow, clearly-separated tray just under the
      // surface cut. It is a placeholder — the info panel says "Unavailable" and
      // depth-aware views hide it. Never presented as a real depth.
      const up = known ? -depthVal : -0.6 - (unknownIdx++ % 4) * 0.35

      const holder = new THREE.Group()
      holder.userData = {
        pickable: false, id: rec.infrastructureId, layerKey: layer.key,
        depth: known ? depthVal : null, depthKnown: known, baseColor: color,
      }

      const mat = new THREE.MeshStandardMaterial({
        color, roughness: 0.7, metalness: 0.05, transparent: true, opacity: 0.95,
      })

      const g = rec.geometry
      const parts = []
      if (g?.type === 'LineString' && g.coordinates.length >= 2) {
        const pts = g.coordinates.map((c) => {
          const [e, n] = toLocalMeters(c, origin)
          return v3(e, n, up)
        })
        if (layer.shape === 'pipe') {
          const curve = new THREE.CatmullRomCurve3(pts)
          const tube = new THREE.Mesh(
            new THREE.TubeGeometry(curve, Math.max(8, pts.length * 6), Math.max(thickness / 2, 0.12), 10, false),
            mat,
          )
          parts.push(tube)
        } else if (layer.shape === 'ductbank') {
          // duct bank = a flat box + a few thin conduits inside it
          for (let i = 1; i < pts.length; i += 1) {
            const box = segmentBox(pts[i - 1], pts[i], Math.max(width, 0.6), Math.max(thickness, 0.4), mat)
            if (box) parts.push(box)
          }
        } else {
          // tunnel / channel / box — swept rectangular section
          const w = layer.shape === 'tunnel' ? Math.max(width, 3) : Math.max(width, 0.6)
          const h = layer.shape === 'tunnel' ? Math.max(thickness, 3) : Math.max(thickness, 0.5)
          for (let i = 1; i < pts.length; i += 1) {
            const box = segmentBox(pts[i - 1], pts[i], w, h, mat)
            if (box) parts.push(box)
          }
        }
      } else if (g?.type === 'Point') {
        const [e, n] = toLocalMeters(g.coordinates, origin)
        const drop = known ? Math.max(depthVal, 0.5) : 1
        const cyl = new THREE.Mesh(
          new THREE.CylinderGeometry(Math.max(width / 2, 0.5), Math.max(width / 2, 0.5), drop, 16),
          mat,
        )
        cyl.position.set(e, -drop / 2, -n)
        parts.push(cyl)
      } else if (g?.type === 'Polygon') {
        const c = geometryCentroid(g)
        if (c) {
          const ring = g.coordinates[0] || []
          let minE = Infinity; let maxE = -Infinity; let minN = Infinity; let maxN = -Infinity
          ring.forEach((pt) => {
            const [e, n] = toLocalMeters(pt, origin)
            minE = Math.min(minE, e); maxE = Math.max(maxE, e)
            minN = Math.min(minN, n); maxN = Math.max(maxN, n)
          })
          const bw = Math.max(maxE - minE, 1)
          const bd = Math.max(maxN - minN, 1)
          const bh = Math.max(thickness, 1)
          const box = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat)
          box.position.set((minE + maxE) / 2, up - bh / 2, -(minN + maxN) / 2)
          parts.push(box)
        }
      }

      if (!parts.length) return
      parts.forEach((p) => {
        p.userData = { pickable: true, id: rec.infrastructureId }
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(p.geometry),
          new THREE.LineBasicMaterial({ color: COLORS.buildingEdge, transparent: true, opacity: 0.25 }),
        )
        edges.userData.outline = true
        p.add(edges)
        holder.add(p)
      })
      holder.userData.pickable = true
      infraGroup.add(holder)
      st.meshById.set(rec.infrastructureId, holder)
    })

    st.framed = false
  }, [origin, infra])

  // ---- apply layer visibility / depth slider / view mode / selection ----
  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    const vis = visibleLayers instanceof Set ? visibleLayers : new Set(UNDERGROUND_LAYERS.map((l) => l.key))
    const { sliceDepth, mode } = depthState || {}

    // surface + soil dimming per view mode
    const surfaceOpacity = viewMode === 'UNDERGROUND' ? 0 : viewMode === 'SURFACE' ? 0.95 : 0.4
    st.surface.traverse((o) => {
      if (o.userData?.building) {
        o.material.opacity = viewMode === 'UNDERGROUND' ? 0.06 : viewMode === 'SURFACE' ? 0.85 : 0.4
        o.visible = viewMode !== 'UNDERGROUND'
      } else if (o.name === 'ground-surface') {
        o.material.opacity = surfaceOpacity
        o.visible = viewMode !== 'UNDERGROUND'
      }
    })
    st.soil.children.forEach((o) => {
      o.visible = viewMode !== 'UNDERGROUND'
      if (o.material) o.material.opacity = viewMode === 'SURFACE' ? 0.2 : 0.1
    })

    st.infraGroup.children.forEach((holder) => {
      const u = holder.userData
      const layerOn = vis.has(u.layerKey)
      const dv = depthVisibility({ depth: u.depth, sliceDepth, mode })
      const show = layerOn && dv.visible
      holder.visible = show
      const selected = u.id === selectedId
      holder.traverse((o) => {
        if (o.isMesh) {
          o.material.opacity = selected ? 1 : dv.dim ? 0.18 : 0.95
          o.material.color.setHex(selected ? COLORS.selection : u.baseColor)
          o.material.emissive?.setHex(selected ? COLORS.selection : 0x000000)
          if (o.material.emissive) o.material.emissiveIntensity = selected ? 0.35 : 0
        }
        if (o.userData?.outline) o.material.opacity = selected ? 0.9 : dv.highlight ? 0.5 : 0.2
      })
    })

    // frame once after a rebuild
    if (!st.framed) {
      st.framed = true
      const span = st.extent
      st.controls.target.set(0, -6, 0)
      st.camera.position.set(span * 0.9, span * 0.7, span * 1.1)
      st.camera.far = span * 60
      st.camera.updateProjectionMatrix()
      st.controls.update()
    }
  }, [visibleLayers, depthState, viewMode, selectedId, infra, buildings])

  // ---- imperative camera commands (only act on a fresh nonce) ----
  const lastCmd = useRef(0)
  useEffect(() => {
    const st = stateRef.current
    if (!st || !command || command.n === lastCmd.current) return
    lastCmd.current = command.n
    const span = st.extent || 400
    const { kind } = command
    const c = st.controls
    const cam = st.camera
    if (kind === 'reset') {
      c.target.set(0, -6, 0)
      cam.position.set(span * 0.9, span * 0.7, span * 1.1)
    } else if (kind === 'top') {
      c.target.set(0, 0, 0)
      cam.position.set(0.01, span * 1.6, 0.01)
    } else if (kind === 'underground') {
      c.target.set(0, -10, 0)
      cam.position.set(span * 0.7, -2, span * 0.7)
    } else if (kind === 'fit' && selectedId && st.meshById.has(selectedId)) {
      const holder = st.meshById.get(selectedId)
      const box = new THREE.Box3().setFromObject(holder)
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3()).length() || 20
        c.target.copy(center)
        cam.position.set(center.x + size * 1.4, center.y + size * 1.1, center.z + size * 1.6)
      }
    }
    cam.updateProjectionMatrix()
    c.update()
  }, [command, selectedId])

  return <div ref={mountRef} className="h-full w-full" data-testid="underground-scene" />
}
