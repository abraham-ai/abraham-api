# Abraham API - Setup and Usage Guide

A Hono-based API for managing NFT-based blessings (likes) for the FirstWorks collection.

## Overview

This API allows users who own FirstWorks NFTs to perform "blessings" (think of them as likes). The blessing logic is:

- If you own **N** NFTs, you can perform **B×N** blessings per 24-hour period
- The 24-hour period resets at midnight UTC
- A snapshot of NFT ownership is taken daily to determine eligibility

## Prerequisites

- Node.js 18+ installed
- A Privy account with App ID and App Secret
- An Ethereum RPC endpoint (Alchemy, Infura, etc.)

## Installation

1. **Clone the repository** (if not already done)

   ```bash
   cd abraham-api
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**

   Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and fill in your values:

   ```env
   # Privy Authentication
   PRIVY_APP_ID=your_privy_app_id_here
   PRIVY_APP_SECRET=your_privy_app_secret_here

   # FirstWorks NFT Contract
   CONTRACT_ADDRESS=0x8F814c7C75C5E9e0EDe0336F535604B1915C1985
   MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
   ```

## Initial Setup: Generate NFT Snapshot

Before starting the API, you need to generate an initial snapshot of NFT holders:

```bash
npm run snapshot:generate
```

This will:

- Fetch all NFT ownership data from the FirstWorks contract
- Save it to `lib/snapshots/latest.json`
- Take a few minutes depending on the total supply

**Important:** Run this daily (via cron or scheduled task) to keep ownership data up-to-date.

## Running the Server

### Development mode (with hot reload)

```bash
npm run dev
```

### Production mode

```bash
npm start
```

The server will start on port 3000 (or your configured port).

## API Endpoints

### Base URL

```
http://localhost:3000
```

### Health Check

```http
GET /
```

Returns API status and available endpoints.

### Authentication

All blessing endpoints require a Privy JWT token in the Authorization header:

```http
Authorization: Bearer <your_privy_jwt_token>
```

### Blessing Endpoints

#### 1. Check Eligibility

Check if the authenticated user can perform blessings.

```http
GET /api/blessings/eligibility
Authorization: Bearer <token>
```

**Response:**

```json
{
  "success": true,
  "data": {
    "eligible": true,
    "nftCount": 5,
    "maxBlessings": 5,
    "usedBlessings": 2,
    "remainingBlessings": 3,
    "periodEnd": "2025-10-25T00:00:00.000Z",
    "reason": null
  }
}
```

#### 2. Get Blessing Stats

Get detailed blessing statistics for the authenticated user.

```http
GET /api/blessings/stats
Authorization: Bearer <token>
```

**Response:**

```json
{
  "success": true,
  "data": {
    "nftCount": 5,
    "maxBlessings": 5,
    "usedBlessings": 2,
    "remainingBlessings": 3,
    "periodStart": "2025-10-24T00:00:00.000Z",
    "periodEnd": "2025-10-25T00:00:00.000Z"
  }
}
```

#### 3. Perform a Blessing

Perform a blessing on a target item.

```http
POST /api/blessings
Authorization: Bearer <token>
Content-Type: application/json

{
  "targetId": "post_123"
}
```

**Success Response:**

```json
{
  "success": true,
  "data": {
    "targetId": "post_123",
    "remainingBlessings": 2,
    "message": "Blessing performed successfully"
  }
}
```

**Error Response (No blessings remaining):**

```json
{
  "success": false,
  "error": "All blessings used for this period",
  "remainingBlessings": 0
}
```

#### 4. Reload Snapshot (Admin)

Force reload the NFT snapshot without restarting the server.

```http
POST /api/blessings/reload-snapshot
```

**Note:** In production, you should add authentication to this endpoint.

## Configuration

### Blessings Per NFT

To change how many blessings each NFT owner gets, edit `src/services/blessingService.ts`:

```typescript
const BLESSINGS_PER_NFT = 1; // Change this value
```

### 24-Hour Period

The blessing period resets at midnight UTC. To change this logic, modify the `getCurrentPeriod()` method in [src/services/blessingService.ts:63-73](src/services/blessingService.ts#L63-L73).

### Storage

Currently, blessing data is stored in-memory. For production:

1. **Use Redis** for distributed caching
2. **Use a database** (PostgreSQL, MongoDB) for persistent storage

## Scheduling Snapshot Generation

### Using Cron (Linux/Mac)

```bash
crontab -e
```

Add this line to run daily at 1 AM:

```
0 1 * * * cd /path/to/abraham-api && npm run snapshot:generate
```

### Using GitHub Actions

Create `.github/workflows/snapshot.yml`:

```yaml
name: Generate NFT Snapshot

on:
  schedule:
    - cron: "0 1 * * *" # Daily at 1 AM UTC
  workflow_dispatch: # Allow manual trigger

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "18"
      - run: npm install
      - run: npm run snapshot:generate
        env:
          CONTRACT_ADDRESS: ${{ secrets.CONTRACT_ADDRESS }}
          MAINNET_RPC_URL: ${{ secrets.RPC_URL }}
```

## Client Integration

### JavaScript/TypeScript Example

```typescript
import { usePrivy } from "@privy-io/react-auth";

const { getAccessToken } = usePrivy();

async function performBlessing(targetId: string) {
  const token = await getAccessToken();

  const response = await fetch("https://your-api.com/api/blessings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ targetId }),
  });

  const result = await response.json();

  if (result.success) {
    console.log(
      `Blessing successful! ${result.data.remainingBlessings} remaining`
    );
  } else {
    console.error(`Blessing failed: ${result.error}`);
  }
}
```

### React Hook Example

```typescript
import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";

export function useBlessingEligibility() {
  const { getAccessToken, authenticated } = usePrivy();
  const [eligibility, setEligibility] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authenticated) return;

    async function checkEligibility() {
      setLoading(true);
      const token = await getAccessToken();

      const response = await fetch(
        "https://your-api.com/api/blessings/eligibility",
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const result = await response.json();
      setEligibility(result.data);
      setLoading(false);
    }

    checkEligibility();
  }, [authenticated, getAccessToken]);

  return { eligibility, loading };
}
```

## Deployment

### Vercel (Recommended for Hono)

1. Install Vercel CLI:

   ```bash
   npm i -g vercel
   ```

2. Deploy:

   ```bash
   vercel
   ```

3. Add environment variables in Vercel dashboard

### Docker

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

Build and run:

```bash
docker build -t abraham-api .
docker run -p 3000:3000 --env-file .env abraham-api
```

## Troubleshooting

### "No snapshot found" error

- Run `npm run snapshot:generate` first
- Check that `.env` has correct RPC URL and contract address

### "Invalid authentication token" error

- Verify Privy App ID and App Secret are correct
- Ensure the client is sending a valid Privy JWT token

### "Wallet address not found" error

- User must have a connected wallet in Privy
- Verify the user has completed wallet connection

## Project Structure

```
abraham-api/
├── lib/
│   ├── abi/
│   │   └── firstWorks.ts          # NFT contract ABI
│   └── snapshots/
│       ├── firstWorksSnapshot.ts  # Snapshot generator
│       └── latest.json            # Current snapshot (generated)
├── src/
│   ├── middleware/
│   │   └── auth.ts                # Privy authentication middleware
│   ├── routes/
│   │   └── blessings.ts           # Blessing API routes
│   ├── services/
│   │   └── blessingService.ts     # Blessing logic & tracking
│   └── index.ts                   # Main app entry point
├── .env.example                   # Environment template
├── package.json
├── tsconfig.json
└── SETUP.md                       # This file
```

## License

MIT

## Support

For issues or questions, please open an issue in the repository.
