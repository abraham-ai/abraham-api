# Abraham API

A Hono-based API for managing NFT-based blessings (likes) for the FirstWorks collection.

## Overview

This API allows users who own FirstWorks NFTs to perform "blessings" on content. The blessing system uses:
- **Privy** for authentication
- **Viem** for Ethereum blockchain interactions
- **Hono** as the lightweight web framework

### Key Features
- NFT-based blessing eligibility (if you own N NFTs, you get N blessings per day)
- 24-hour blessing period (resets at midnight UTC)
- Daily NFT ownership snapshots for fast lookups
- Secure Privy authentication

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your Privy credentials and RPC URL
   ```

3. **Generate initial NFT snapshot**
   ```bash
   npm run snapshot:generate
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

The API will be running at `http://localhost:3000`

## Documentation

For detailed setup instructions, API documentation, and deployment guides, see [SETUP.md](./SETUP.md).

## API Endpoints

- `GET /` - Health check
- `GET /api/blessings/eligibility` - Check if user can bless
- `GET /api/blessings/stats` - Get user's blessing statistics
- `POST /api/blessings` - Perform a blessing
- `POST /api/blessings/reload-snapshot` - Reload NFT snapshot

All blessing endpoints require Privy authentication.

## Project Structure

```
abraham-api/
├── lib/
│   ├── abi/                    # Contract ABIs
│   └── snapshots/              # NFT snapshot utilities
├── src/
│   ├── middleware/             # Auth middleware
│   ├── routes/                 # API routes
│   ├── services/               # Business logic
│   ├── index.ts               # Hono app
│   └── server.ts              # Server entry point
└── package.json
```

## Development

```bash
# Development mode with hot reload
npm run dev

# Production mode
npm start

# Generate NFT snapshot
npm run snapshot:generate

# Type checking
npm run typecheck
```

## Deployment

### Vercel

```bash
npm install -g vercel
vercel
```

Add your environment variables in the Vercel dashboard.

## License

MIT
