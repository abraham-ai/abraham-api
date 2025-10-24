// Load environment variables from .env.local or .env
import dotenv from 'dotenv';

// Load .env.local first, fall back to .env
dotenv.config({ path: '.env.local' });
dotenv.config(); // This won't override existing variables

import { serve } from '@hono/node-server'
import app from './index.js'

const port = parseInt(process.env.PORT || '3000')

console.log(`🚀 Abraham API starting on port ${port}`)

serve({
  fetch: app.fetch,
  port
})

console.log(`✅ Server running at http://localhost:${port}`)
