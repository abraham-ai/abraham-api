import { Hono } from 'hono'
import { cors } from 'hono/cors'
import blessings from './routes/blessings.js'
import seeds from './routes/seeds.js'
import admin from './routes/admin.js'
import leaderboard from './routes/leaderboard.js'
import commandments from './routes/commandments.js'

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

      // Leaderboard
      getLeaderboard: 'GET /api/leaderboard',
      getUserRank: 'GET /api/leaderboard/user/:address',

      // Commandments (Comments)
      submitCommandment: 'POST /api/commandments',
      getCommandmentsBySeed: 'GET /api/commandments/seed/:seedId',
      getCommandmentsByUser: 'GET /api/commandments/user/:address',
      getCommandmentStats: 'GET /api/commandments/stats',
      checkCommandmentEligibility: 'GET /api/commandments/eligibility',
      getAllCommandments: 'GET /api/commandments/all',

      // Admin Operations (requires X-Admin-Key)
      updateSnapshot: 'POST /api/admin/update-snapshot (requires X-Admin-Key)',
      reloadSnapshot: 'POST /api/admin/reload-snapshot (requires X-Admin-Key)',
      snapshotStatus: 'GET /api/admin/snapshot-status',
    }
  })
})

// Mount routes
app.route('/api/seeds', seeds)
app.route('/api/blessings', blessings)
app.route('/api/commandments', commandments)
app.route('/api/leaderboard', leaderboard)
app.route('/api/admin', admin)

export default app
