// VISUAL-ONLY cinematic colour grading for the Cesium scene (spec section 5).
// Imagery colour filters + atmosphere/fog tint + one screen-space colour-grade
// post-process pass. Never touches camera / geometry / picking / lifecycle;
// fully guarded, and a scene.renderError listener strips the stage if the
// shader ever fails so rendering can't break.

const GRADE_FS = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_vignette;
uniform float u_gamma;
uniform float u_lift;
uniform vec3  u_balance;
uniform vec3  u_shadowTint;
uniform vec3  u_highTint;
void main() {
  vec4 src = texture(colorTexture, v_textureCoordinates);
  vec3 c = max(src.rgb, 0.0);
  c *= u_exposure;
  c *= u_balance;
  c = c + u_lift * (1.0 - c);
  c = pow(c, vec3(u_gamma));
  c = (c - 0.5) * u_contrast + 0.5;
  c = max(c, 0.0);
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(u_shadowTint, u_highTint, smoothstep(0.15, 0.85, luma));
  luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, u_saturation);
  c = c / (1.0 + max(vec3(0.0), c - 0.80) * 0.55);
  vec2 d = v_textureCoordinates - 0.5;
  float vig = smoothstep(1.05, 0.20, dot(d, d) * 2.0);
  c *= mix(1.0, vig, u_vignette);
  out_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}
`

export function applyGrading(viewer, Cesium) {
  if (!viewer || viewer.isDestroyed()) return () => {}
  const scene = viewer.scene
  const cleanups = []

  try {
    const layer = viewer.imageryLayers.get(0)
    if (layer) {
      layer.brightness = 0.97
      layer.contrast = 1.12
      layer.saturation = 1.2
      layer.gamma = 0.9
    }
  } catch { /* ignore */ }

  try {
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.saturationShift = 0.1
      scene.skyAtmosphere.brightnessShift = -0.05
    }
    if (scene.globe) {
      if ('atmosphereSaturationShift' in scene.globe) scene.globe.atmosphereSaturationShift = 0.08
      if ('atmosphereBrightnessShift' in scene.globe) scene.globe.atmosphereBrightnessShift = -0.03
    }
    if (scene.fog) {
      scene.fog.enabled = true
      scene.fog.density = 0.00022
    }
  } catch { /* ignore */ }

  try {
    const stage = new Cesium.PostProcessStage({
      name: 'landstack_colour_grade',
      fragmentShader: GRADE_FS,
      uniforms: {
        // Restrained "official basemap" grade — near-neutral, minimal vignette
        // (government portal, Phase 10). Kept subtle; never dark/cinematic.
        u_exposure: 1.02,
        u_gamma: 0.95,
        u_contrast: 1.05,
        u_saturation: 1.05,
        u_vignette: 0.08,
        u_lift: 0.015,
        u_balance: () => new Cesium.Cartesian3(1.025, 1.0, 0.965),
        u_shadowTint: () => new Cesium.Cartesian3(0.965, 0.99, 1.07),
        u_highTint: () => new Cesium.Cartesian3(1.055, 1.005, 0.93),
      },
    })
    scene.postProcessStages.add(stage)
    const removeStage = () => {
      try {
        if (!scene.isDestroyed()) scene.postProcessStages.remove(stage)
      } catch { /* already gone */ }
    }
    cleanups.push(removeStage)
    const onErr = () => {
      removeStage()
      try {
        scene.renderError.removeEventListener(onErr)
        if (!scene.isDestroyed()) scene.requestRender()
      } catch { /* ignore */ }
    }
    scene.renderError.addEventListener(onErr)
    cleanups.push(() => {
      try { scene.renderError.removeEventListener(onErr) } catch { /* ignore */ }
    })
  } catch { /* ignore */ }

  return () => cleanups.forEach((fn) => fn())
}
