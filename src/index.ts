import { Hono } from 'hono'
import { cors } from 'hono/cors'
import blessings from './routes/blessings.js'
import seeds from './routes/seeds.js'

const app = new Hono()

// Enable CORS for all routes
app.use('*', cors({
  origin: '*', // In production, specify your allowed origins
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key'],
}))

// Health check route
app.get('/', (c) => {
  return c.json({
    name: 'Abraham API',
    version: '1.0.0',
    status: 'healthy',
    endpoints: {
      // Seed Creation
      createSeed: 'POST /api/seeds (requires X-Admin-Key)',
      prepareSeedCreation: 'POST /api/seeds/prepare',
      getSeed: 'GET /api/seeds/:seedId',
      getSeedCount: 'GET /api/seeds/count',
      checkCreatorRole: 'GET /api/seeds/creator/:address/check',

      // Blessing Actions
      performBlessing: 'POST /api/blessings',
      checkEligibility: 'GET /api/blessings/eligibility',
      getStats: 'GET /api/blessings/stats',

      // Retrieve Blessings
      getAllBlessings: 'GET /api/blessings/all',
      getBlessingsByTarget: 'GET /api/blessings/target/:targetId',
      getBlessingsByWallet: 'GET /api/blessings/wallet/:walletAddress',

      // FirstWorks NFT Snapshots
      getFirstWorksSnapshot: 'GET /api/blessings/firstworks/snapshot',
      reloadFirstWorksSnapshot: 'POST /api/blessings/firstworks/reload-snapshot',
    }
  })
})

// Mount routes
app.route('/api/seeds', seeds)
app.route('/api/blessings', blessings)

export default app
