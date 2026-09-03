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
  seedOnBoot: bool(process.env.SEED_ON_BOOT, true),
  nodeEnv: process.env.NODE_ENV || 'development',
}

export const isProd = env.nodeEnv === 'production'
