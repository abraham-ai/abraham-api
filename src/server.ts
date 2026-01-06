// CRITICAL: Load environment variables BEFORE any other imports
// This ensures contractService and other services can read env vars during initialization
if (process.env.NODE_ENV !== 'production') {
  const dotenv = await import('dotenv');
  // Load .env first (base config)
  dotenv.config();
  // Then .env.local (overrides for local development)
  dotenv.config({ path: '.env.local', override: true });
}

import { serve } from '@hono/node-server'
import app from './index.js'

const port = parseInt(process.env.PORT || '3000')

console.log(`🚀 Abraham API starting on port ${port}`)

serve({
  fetch: app.fetch,
  port
})

console.log(`✅ Server running at http://localhost:${port}`)
