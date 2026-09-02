import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import './App.css'
import BuildingInfoPanel from './components/BuildingInfoPanel';
import Building360Controls from './components/Building360Controls';
import { extractBuildingProperties } from './utils/cesiumBuildingUtils';

function App() {
  const cesiumContainerRef = useRef(null)
  const viewerRef = useRef(null)
  const buildingsRef = useRef(null)
  const worldTerrainRef = useRef(null)
  const flatTerrainRef = useRef(null)
  const baseLayerRef = useRef(null)
  const buildingsEnabledRef = useRef(true)
  const terrainEnabledRef = useRef(true)
  const satelliteEnabledRef = useRef(true)
  const [buildingsEnabled, setBuildingsEnabled] = useState(true)
  const [terrainEnabled, setTerrainEnabled] = useState(true)
  const [satelliteEnabled, setSatelliteEnabled] = useState(true)
  const [loading, setLoading] = useState(true);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [selectedProperties, setSelectedProperties] = useState({});
  const [showInfo, setShowInfo] = useState(false);
  const [is360Mode, setIs360Mode] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [highlightedFeature, setHighlightedFeature] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const flyToChennai = () => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(80.2707, 13.0827, 8_000),
    })
  }

  const toggleBuildings = () => {
    const nextValue = !buildingsEnabledRef.current
    buildingsEnabledRef.current = nextValue
    setBuildingsEnabled(nextValue)
    if (buildingsRef.current) buildingsRef.current.show = nextValue
  }

  const toggleTerrain = () => {
    const nextValue = !terrainEnabledRef.current
    terrainEnabledRef.current = nextValue
    setTerrainEnabled(nextValue)

    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    if (nextValue && worldTerrainRef.current) {
      viewer.terrainProvider = worldTerrainRef.current
    } else if (!nextValue) {
      flatTerrainRef.current ??= new Cesium.EllipsoidTerrainProvider()
      viewer.terrainProvider = flatTerrainRef.current
    }
  }

  const toggleSatellite = () => {
    const nextValue = !satelliteEnabledRef.current
    satelliteEnabledRef.current = nextValue
    setSatelliteEnabled(nextValue)
    if (baseLayerRef.current) baseLayerRef.current.show = nextValue
  }

  useEffect(() => {
    let cancelled = false
    let viewer

    const initializeViewer = async () => {
      Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
    if (!import.meta.env.VITE_CESIUM_ION_TOKEN) {
      setErrorMessage('Cesium ion token is missing');
      setLoading(false);
      return;
    }
      viewer = new Cesium.Viewer(cesiumContainerRef.current, {
        animation: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        timeline: false,
        navigationHelpButton: false,
      })
      viewerRef.current = viewer
      baseLayerRef.current = viewer.imageryLayers.get(0)

      const cameraController = viewer.scene.screenSpaceCameraController
      cameraController.enableInputs = true
      cameraController.enableZoom = true
      cameraController.enableRotate = true
      cameraController.enableTilt = true
      cameraController.enableLook = true
      cameraController.zoomEventTypes = [
        Cesium.CameraEventType.WHEEL,
        Cesium.CameraEventType.PINCH,
      ]
      cameraController.rotateEventTypes = Cesium.CameraEventType.LEFT_DRAG
      cameraController.tiltEventTypes = [
        Cesium.CameraEventType.MIDDLE_DRAG,
        Cesium.CameraEventType.RIGHT_DRAG,
        Cesium.CameraEventType.PINCH,
      ]
      cameraController.lookEventTypes = {
        eventType: Cesium.CameraEventType.LEFT_DRAG,
        modifier: Cesium.KeyboardEventModifier.SHIFT,
      }

      flyToChennai()

      try {
    const terrainProvider = await Cesium.createWorldTerrainAsync()
    if (cancelled || viewer.isDestroyed()) return
    worldTerrainRef.current = terrainProvider
    if (terrainEnabledRef.current) viewer.terrainProvider = terrainProvider
  } catch (e) {
    console.warn('World terrain failed, using default ellipsoid', e)
    const flat = new Cesium.EllipsoidTerrainProvider()
    flatTerrainRef.current = flat
    viewer.terrainProvider = flat
  }

      try {
    const buildings = await Cesium.createOsmBuildingsAsync()
    if (cancelled || viewer.isDestroyed()) return
    buildings.show = buildingsEnabledRef.current
    buildingsRef.current = buildings
    viewer.scene.primitives.add(buildings)
  } catch (e) {
    console.warn('OSM buildings failed', e)
  }
    }
  setLoading(false);
      initializeViewer().catch((error) => {
        if (!cancelled) console.error('Unable to initialize Cesium viewer:', error)
      })
      // Set up picking after viewer is ready
      if (viewer) {
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((click) => {
          const pick = viewer.scene.pick(click.position);
          if (Cesium.defined(pick) && pick instanceof Cesium.Cesium3DTileFeature) {
            const feature = pick; // tile feature
            // Highlight feature
            if (highlightedFeature && highlightedFeature !== feature) {
              highlightedFeature.color = Cesium.Color.WHITE;
            }
            feature.color = Cesium.Color.CYAN;
            setHighlightedFeature(feature);
            // Extract properties safely
            const props = extractBuildingProperties(feature);
            setSelectedProperties(props);
            setSelectedFeature(feature);
            setShowInfo(true);
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      }

    return () => {
      cancelled = true
      if (viewer && !viewer.isDestroyed()) viewer.destroy()
      viewerRef.current = null
      buildingsRef.current = null
      worldTerrainRef.current = null
      flatTerrainRef.current = null
      baseLayerRef.current = null
    }
  }, [])

  return (
    <main className="app-shell">
      <div ref={cesiumContainerRef} className="cesium-container" />
      {loading && <div className="loading-overlay">Loading Chennai 3D Map...</div>}
      {errorMessage && <div className="error-overlay">{errorMessage}</div>}
      <header className="app-header map-panel">
        <span className="app-title">3D ULPIN</span>
        <span className="app-subtitle">Chennai 3D Property Mapping</span>
      </header>
      {showInfo && selectedFeature && (
          <BuildingInfoPanel
            title="Building Details"
            properties={selectedProperties}
            onClose={() => {
              if (highlightedFeature) highlightedFeature.color = Cesium.Color.WHITE;
              setShowInfo(false);
              setSelectedFeature(null);
            }}
            onFocus={() => {
              const viewer = viewerRef.current;
              if (viewer && selectedFeature) {
                const carto = Cesium.Cartesian3.fromDegrees(
                  selectedFeature.position?.longitude || 0,
                  selectedFeature.position?.latitude || 0,
                  selectedFeature.position?.height || 100
                );
                viewer.camera.flyTo({ destination: carto, duration: 2 });
              }
            }}
            onEnter360={() => setIs360Mode(true)}
          />
        )}
        {is360Mode && (
          <Building360Controls
            paused={isPaused}
            onPause={() => setIsPaused(true)}
            onResume={() => setIsPaused(false)}
            onExit={() => setIs360Mode(false)}
          />
        )}

      <section className="map-controls map-panel" aria-label="Map controls">
        <button type="button" className="location-button" onClick={flyToChennai}>
          Chennai
        </button>
        <div className="control-divider" />
        <button
          type="button" className={`toggle-button ${buildingsEnabled ? 'is-active' : ''}`} aria-pressed={buildingsEnabled} onClick={toggleBuildings}>
            <span>3D Buildings</span>
            <span className="toggle-indicator" aria-hidden="true" />
          </button>
        <button
          type="button"
          className={`toggle-button ${terrainEnabled ? 'is-active' : ''}`}
          aria-pressed={terrainEnabled}
          onClick={toggleTerrain}
        >
          <span>Terrain</span>
          <span className="toggle-indicator" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`toggle-button ${satelliteEnabled ? 'is-active' : ''}`}
          aria-pressed={satelliteEnabled}
          onClick={toggleSatellite}
        >
          <span>Satellite</span>
          <span className="toggle-indicator" aria-hidden="true" />
        </button>
      </section>

      <aside className="data-status map-panel" aria-label="Data sources">
        <span className="status-label">Data Source</span>
        <span>Cesium World Terrain</span>
        <span>OpenStreetMap 3D Buildings</span>
      </aside>

      <p className="prototype-label map-panel">Prototype • SIH26011</p>
    </main>
  )
}
useEffect(() => {
  if (!is360Mode || isPaused || !selectedFeature) return;
  const viewer = viewerRef.current;
  if (!viewer) return;
  let animationId;
  const update = () => {
    const center = selectedFeature?.boundingSphere?.center;
    const radius = selectedFeature?.boundingSphere?.radius || 50;
    if (!center) return;
    const time = Date.now() / 1000;
    const angle = (time % 60) / 60 * Math.PI * 2;
    const offset = new Cesium.Cartesian3(
      radius * Math.cos(angle),
      radius * Math.sin(angle),
      radius * 0.3
    );
    const position = Cesium.Cartesian3.add(center, offset, new Cesium.Cartesian3());
    viewer.camera.setView({
      destination: position,
      orientation: {
        heading: Cesium.Math.atan2(-offset.x, -offset.y),
        pitch: Cesium.Math.toRadians(-30),
        roll: 0,
      },
    });
    animationId = viewer.scene.requestAnimationFrame(update);
  };
  animationId = viewer.scene.requestAnimationFrame(update);
  return () => {
    if (animationId) viewer.scene.cancelAnimationFrame(animationId);
  };
}, [is360Mode, isPaused, selectedFeature]);

export default App
