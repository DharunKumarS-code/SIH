import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'

import { env } from './config/env.js'
import { db } from './store/index.js'
import apiRoutes from './routes/index.js'
import { demoDocs } from './middleware/demoDocs.js'
import { notFound, errorHandler } from './middleware/error.js'

export function createApp() {
  const app = express()
  app.set('trust proxy', 1)

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(compression())
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || env.corsOrigin.includes(origin) || env.corsOrigin.includes('*')) return cb(null, true)
        return cb(null, false)
      },
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '1mb' }))
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'))

  // Rate-limit mutating auth endpoints a little; keep GETs generous for the demo.
  app.use(
    '/api/auth',
    rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false }),
  )
  app.use('/api', rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false }))

  app.get('/health', (_req, res) =>
    res.json({ ok: true, service: 'landstack-backend', store: db.status.mode, time: new Date().toISOString() }),
  )

  app.get('/api', (_req, res) =>
    res.json({
      ok: true,
      name: 'LAND STACK API',
      version: '1.0.0',
      store: db.status.mode,
      docs: '/docs/02-api-specification.md',
      disclaimer:
        'Prototype. Land Records / Registration / Property Tax integrations are DEMO / MOCK. All records are synthetic.',
    }),
  )

  app.use('/api', apiRoutes)
  app.get('/demo-docs/*', demoDocs)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
