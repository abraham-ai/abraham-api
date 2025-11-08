// Load environment variables from .env files in development
// In production (Vercel), environment variables are provided by the platform
if (process.env.NODE_ENV !== 'production') {
    const dotenv = await import('dotenv');
    // Load .env.local first (for local development), fall back to .env
    dotenv.config({ path: '.env.local' });
    dotenv.config();
}
import { serve } from '@hono/node-server';
import app from './index.js';
const port = parseInt(process.env.PORT || '3000');
console.log(`🚀 Abraham API starting on port ${port}`);
serve({
    fetch: app.fetch,
    port
});
console.log(`✅ Server running at http://localhost:${port}`);
