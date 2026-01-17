# Abraham API - Setup and Usage Guide

A Hono-based API for managing NFT-based blessings (votes) for the Abraham AI art curation platform.

## Overview

This API enables FirstWorks NFT holders to participate in the Abraham art curation system:

- **Seeds**: Artwork proposals submitted for community voting
- **Blessings**: Votes cast by FirstWorks NFT holders
- **Creations**: Winning seeds that become ERC1155 NFTs
- **Commandments**: Messages/comments on seeds

### Blessing Logic

- If you own **N** FirstWorks NFTs, you can perform **N** blessings per 24-hour period (configurable)
- Blessings are verified via Merkle proofs of L1 NFT ownership
- Quadratic (sqrt) scoring prevents whale domination
- The 24-hour period is tied to the voting round

## Contract Architecture

```
L1 (Ethereum Mainnet)          L2 (Base)
┌──────────────────┐           ┌───────────────────┐
│  FirstWorks NFT  │──snapshot─▶│   MerkleGating   │
│  (ERC721)        │           │   (Proof Verify)  │
└──────────────────┘           └─────────┬─────────┘
                                         │
                               ┌─────────▼─────────┐
                               │   AbrahamSeeds    │
                               │   (ERC1155)       │
                               │   - Seeds         │
                               │   - Blessings     │
                               │   - Creations     │
                               └───────────────────┘
```

## Prerequisites

- Node.js 18+ installed
- A Privy account with App ID and App Secret
- Ethereum RPC endpoints (Alchemy, Infura, etc.)
- Base Sepolia ETH for gas fees

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
   cp .env.example .env.local
   ```

   Edit `.env.local` and fill in your values (see [Environment Variables](#environment-variables) section).

## Initial Setup

### 1. Compile Smart Contracts

```bash
npm run compile
```

This compiles:
- `contracts/src/agents/abraham/AbrahamSeeds.sol`
- `contracts/src/modules/gating/MerkleGating.sol`
- `contracts/src/core/EdenAgent.sol`

And extracts ABIs to `lib/abi/`.

### 2. Generate NFT Snapshot

Before starting the API, generate an initial snapshot of FirstWorks NFT holders:

```bash
npm run snapshot:generate
```

This will:
- Fetch all NFT ownership data from the FirstWorks contract on Ethereum mainnet
- Save it to `lib/snapshots/firstWorks_snapshot.json`

### 3. Generate Merkle Tree

Generate the Merkle tree from the snapshot:

```bash
npm run merkle:generate
```

This creates `lib/snapshots/firstWorks_merkle.json` with:
- Merkle root hash
- Proofs for each NFT holder

### 4. Deploy Contracts (if not already deployed)

```bash
# Deploy to Base Sepolia testnet
npm run deploy:abraham-seeds:base-sepolia

# Or deploy to Base mainnet
npm run deploy:abraham-seeds:base
```

The deployment script will:
1. Deploy MerkleGating module
2. Deploy AbrahamSeeds contract
3. Grant CREATOR_ROLE and OPERATOR_ROLE to relayer
4. Update MerkleGating with Merkle root
5. Create a test seed

### 5. Update Environment

After deployment, add the contract addresses to `.env.local`:

```env
L2_SEEDS_CONTRACT=0x0b95d25463b7a937b3df28368456f2c40e95c730
L2_GATING_CONTRACT=0x46657b69308d90a4756369094c5d78781f3f5979
L2_SEEDS_DEPLOYMENT_BLOCK=36452477
```

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

### Seed Endpoints

#### Get All Seeds

```http
GET /api/seeds?page=1&limit=20
```

#### Get Seed by ID

```http
GET /api/seeds/:seedId
```

#### Get Seed Count

```http
GET /api/seeds/count
```

#### Get Seed Stats

```http
GET /api/seeds/stats
```

#### Get Contract Config

```http
GET /api/seeds/config
```

### Blessing Endpoints

#### Check Eligibility

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
    "periodEnd": "2025-10-25T00:00:00.000Z"
  }
}
```

#### Perform a Blessing (Gasless)

```http
POST /api/blessings
Authorization: Bearer <token>
Content-Type: application/json

{
  "seedId": 0
}
```

**Success Response:**
```json
{
  "success": true,
  "data": {
    "seedId": 0,
    "txHash": "0x...",
    "blessingCount": 42,
    "message": "Blessing submitted successfully"
  }
}
```

#### Prepare Blessing Transaction (User-Signed)

```http
POST /api/blessings/prepare
Authorization: Bearer <token>
Content-Type: application/json

{
  "seedId": 0
}
```

Returns transaction data for client-side signing.

#### Check Delegation Status

```http
GET /api/blessings/delegation-status
Authorization: Bearer <token>
```

#### Prepare Delegation Transaction

```http
POST /api/blessings/prepare-delegate
Authorization: Bearer <token>
Content-Type: application/json

{
  "approved": true
}
```

### Admin Endpoints

#### Update Snapshot

```http
POST /api/admin/update-snapshot
Authorization: Bearer <ADMIN_KEY>
```

#### Select Winner

```http
POST /api/cron/select-winner
Authorization: Bearer <CRON_SECRET>
```

## Environment Variables

### Required

```env
# Privy Authentication
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret

# AbrahamSeeds Contract (L2 Base)
L2_SEEDS_CONTRACT=0x0b95d25463b7a937b3df28368456f2c40e95c730
L2_GATING_CONTRACT=0x46657b69308d90a4756369094c5d78781f3f5979
L2_SEEDS_DEPLOYMENT_BLOCK=36452477
NETWORK=baseSepolia

# RPC URLs
L2_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# FirstWorks NFT (L1)
FIRSTWORKS_CONTRACT_ADDRESS=0x9734c959A5FEC7BaD8b0b560AD94F9740B90Efd8
FIRSTWORKS_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# Backend Wallet (for gasless operations)
RELAYER_PRIVATE_KEY=0x...

# Admin Keys
ADMIN_KEY=your_admin_key
CRON_SECRET=your_cron_secret
```

### Optional

```env
# IPFS (for commandments)
PINATA_JWT=your_pinata_jwt
IPFS_GATEWAY=https://gateway.pinata.cloud/ipfs/

# Vercel Blob (for snapshot storage)
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token

# Contract Verification
BASESCAN_API_KEY=your_basescan_key
```

## Scheduling Tasks

### Update NFT Snapshot

Run daily to keep ownership data current:

```bash
# Using cron (Linux/Mac)
0 1 * * * cd /path/to/abraham-api && npm run update-snapshot

# Or use Vercel cron jobs (vercel.json)
{
  "crons": [
    {
      "path": "/api/cron/update-snapshot",
      "schedule": "0 1 * * *"
    }
  ]
}
```

### Select Daily Winner

Run daily after voting period ends:

```bash
# Using cron
0 0 * * * cd /path/to/abraham-api && npm run select-winner

# Or use Vercel cron jobs
{
  "crons": [
    {
      "path": "/api/cron/select-winner",
      "schedule": "0 0 * * *"
    }
  ]
}
```

## Client Integration

### React Example

```typescript
import { usePrivy } from "@privy-io/react-auth";

const { getAccessToken } = usePrivy();

async function blessSeed(seedId: number) {
  const token = await getAccessToken();

  const response = await fetch("https://your-api.com/api/blessings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ seedId }),
  });

  const result = await response.json();

  if (result.success) {
    console.log(`Blessing successful! TX: ${result.data.txHash}`);
  } else {
    console.error(`Blessing failed: ${result.error}`);
  }
}
```

### Eligibility Hook

```typescript
import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";

export function useBlessingEligibility() {
  const { getAccessToken, authenticated } = usePrivy();
  const [eligibility, setEligibility] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authenticated) return;

    async function check() {
      setLoading(true);
      const token = await getAccessToken();

      const response = await fetch(
        "https://your-api.com/api/blessings/eligibility",
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const result = await response.json();
      setEligibility(result.data);
      setLoading(false);
    }

    check();
  }, [authenticated]);

  return { eligibility, loading };
}
```

## Deployment

### Vercel (Recommended)

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

- Run `npm run snapshot:generate` to generate the snapshot
- Run `npm run merkle:generate` to generate the Merkle tree
- Check that RPC URLs are correct in `.env.local`

### "Invalid authentication token" error

- Verify Privy App ID and App Secret are correct
- Ensure the client is sending a valid Privy JWT token

### "Backend not authorized" error

- User needs to approve delegation first
- Call `POST /blessings/prepare-delegate` and have user sign the transaction

### "Merkle proof verification failed" error

1. Regenerate the Merkle tree: `npm run merkle:generate`
2. Update the contract: `npm run update-root`

### "Transaction reverted" error

Check:
1. Relayer wallet has enough ETH for gas
2. Relayer wallet has OPERATOR_ROLE
3. Contract is not paused
4. Voting period hasn't ended

## Project Structure

```
abraham-api/
├── contracts/
│   └── src/
│       ├── agents/
│       │   └── abraham/
│       │       └── AbrahamSeeds.sol    # Main contract
│       ├── core/
│       │   └── EdenAgent.sol           # Base contract
│       ├── modules/
│       │   └── gating/
│       │       └── MerkleGating.sol    # NFT verification
│       └── interfaces/
│           └── IGatingModule.sol       # Gating interface
├── deploy/
│   └── deploy_abraham_seeds.ts         # Deployment script
├── lib/
│   ├── abi/
│   │   ├── AbrahamSeeds.json          # Contract ABI
│   │   └── MerkleGating.json          # Gating ABI
│   └── snapshots/
│       ├── firstWorks_snapshot.json   # NFT ownership
│       └── firstWorks_merkle.json     # Merkle tree
├── src/
│   ├── middleware/
│   │   └── auth.ts                    # Privy auth middleware
│   ├── routes/
│   │   ├── blessings.ts               # Blessing endpoints
│   │   ├── seeds.ts                   # Seed endpoints
│   │   └── commandments.ts            # Commandment endpoints
│   ├── services/
│   │   ├── contractService.ts         # Contract interactions
│   │   └── blessingService.ts         # Blessing logic
│   └── server.ts                      # Main entry point
├── docs/
│   ├── API_REFERENCE.md               # API documentation
│   ├── DEPLOYMENT_GUIDE.md            # Deployment guide
│   └── SEEDS_CONTRACT_REFERENCE.md    # Contract reference
├── .env.example                       # Environment template
├── package.json
├── hardhat.config.ts
├── tsconfig.json
├── QUICKSTART.md                      # Quick start guide
├── SMART_CONTRACT_SUMMARY.md          # Contract overview
└── SETUP.md                           # This file
```

## Documentation

- [QUICKSTART.md](./QUICKSTART.md) - Quick start guide
- [SMART_CONTRACT_SUMMARY.md](./SMART_CONTRACT_SUMMARY.md) - Contract architecture
- [docs/DEPLOYMENT_GUIDE.md](./docs/DEPLOYMENT_GUIDE.md) - Deployment instructions
- [docs/API_REFERENCE.md](./docs/API_REFERENCE.md) - API endpoints
- [docs/SEEDS_CONTRACT_REFERENCE.md](./docs/SEEDS_CONTRACT_REFERENCE.md) - Contract functions

## License

MIT

## Support

For issues or questions, please open an issue in the repository.
