import { env } from './config/env.js'
import { createApp } from './app.js'
import { connectStore, disconnectStore, db } from './store/index.js'

async function main() {
  const status = await connectStore() // never throws — falls back to demo dataset
  const app = createApp()

  const server = app.listen(env.port, () => {
    console.log(`\n  LAND STACK API  ->  http://localhost:${env.port}`)
    console.log(`  Store           :  ${status.message}`)
    console.log(`  CORS origins    :  ${env.corsOrigin.join(', ')}\n`)
  })

  const shutdown = (sig) => {
    console.log(`\n${sig} received - shutting down`)
    server.close(async () => {
      await disconnectStore()
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 5000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})

export { db }
