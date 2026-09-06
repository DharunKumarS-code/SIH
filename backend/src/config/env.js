import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const bool = (v, def = false) =>
  v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())

export const env = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  mongoUri: process.env.MONGODB_URI || '',
  jwtSecret: process.env.JWT_SECRET || 'landstack-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  aiServiceUrl: process.env.AI_SERVICE_URL || '',
  // Future plug-in point for a real Government/Tamil Nadu ULPIN parcel service.
  // Unset ⇒ GovernmentDataProvider reports UNAVAILABLE and only DemoDataProvider
  // serves parcels. It must point at an officially sanctioned endpoint — never a
  // scraper or a service that requires bypassing auth / CAPTCHA / OTP.
  govLandApiUrl: process.env.GOV_LAND_API_URL || '',
  // Phase 3 — AI building-footprint extraction (optional/additive). If the
  // Python ai-service is unreachable the endpoint returns INFERENCE_UNAVAILABLE
  // and the rest of the app is unaffected.
  aiMaxUploadMb: Number(process.env.AI_MAX_UPLOAD_MB) || 12,
  aiInferTimeoutMs: Number(process.env.AI_INFER_TIMEOUT_MS) || 30000,
  // Phase 5 — elevation / LiDAR / DEM / DSM (optional/additive). Point clouds
  // are larger than the imagery uploads above, so they get their own cap and a
  // longer ai-service timeout; graceful INFERENCE_UNAVAILABLE if unreachable.
  aiMaxElevationUploadMb: Number(process.env.AI_MAX_ELEVATION_UPLOAD_MB) || 60,
  aiElevationTimeoutMs: Number(process.env.AI_ELEVATION_TIMEOUT_MS) || 60000,
  // Phase 6 — GNSS/CORS control points (optional/additive). CSV/JSON/GeoJSON
  // uploads are small text files, not rasters/point clouds, so the cap is
  // conservative; CRS transformation degrades to TRANSFORMATION_UNAVAILABLE
  // (never a guessed CRS) if the ai-service is unreachable.
  gnssMaxUploadMb: Number(process.env.GNSS_MAX_UPLOAD_MB) || 5,
  gnssMaxPoints: Number(process.env.GNSS_MAX_POINTS) || 5000,
  gnssTransformTimeoutMs: Number(process.env.GNSS_TRANSFORM_TIMEOUT_MS) || 15000,
  // Phase 7 — intelligent 2D/3D topology validation (optional/additive).
  // Exact polygon validity/overlap degrades to GEOMETRY_ENGINE_UNAVAILABLE
  // (never a guessed result) if the ai-service is unreachable.
  topologyGeometryTimeoutMs: Number(process.env.TOPOLOGY_GEOMETRY_TIMEOUT_MS) || 15000,
  // Phase 8 — underground 3D infrastructure mapping (optional/additive).
  // GeoJSON/CSV/JSON uploads are small text files. CRS transformation for a
  // projected CRS reuses the Phase 6 ai-service pyproj endpoint and degrades to
  // TRANSFORMATION_FAILED (never a guessed CRS) if the ai-service is unreachable.
  infraMaxUploadMb: Number(process.env.INFRA_MAX_UPLOAD_MB) || 6,
  seedOnBoot: bool(process.env.SEED_ON_BOOT, true),
  nodeEnv: process.env.NODE_ENV || 'development',
}

export const isProd = env.nodeEnv === 'production'
