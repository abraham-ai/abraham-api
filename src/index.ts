import { Hono } from 'hono'
import { cors } from 'hono/cors'
import blessings from './routes/blessings.js'

const app = new Hono()

// Enable CORS for all routes
app.use('*', cors({
  origin: '*', // In production, specify your allowed origins
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Health check route
app.get('/', (c) => {
  return c.json({
    name: 'Abraham API',
    version: '1.0.0',
    status: 'healthy',
    endpoints: {
      blessings: '/api/blessings',
      eligibility: '/api/blessings/eligibility',
      stats: '/api/blessings/stats',
    }
  })
})

// Mount blessing routes
app.route('/api/blessings', blessings)

export default app
