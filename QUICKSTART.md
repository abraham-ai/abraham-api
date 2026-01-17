# Abraham API - Quick Start Guide

## What We've Built

A complete NFT-based blessing and governance system with:

### Core Services

1. **Privy Authentication Middleware** ([src/middleware/auth.ts](src/middleware/auth.ts))
   - Verifies Privy JWT tokens
   - Extracts wallet addresses from authenticated users

2. **NFT Snapshot Generator** ([lib/snapshots/firstWorksSnapshot.ts](lib/snapshots/firstWorksSnapshot.ts))
   - Fetches all FirstWorks NFT ownership data from L1 Ethereum
   - Saves to `lib/snapshots/latest.json`
   - Should be run daily via cron

3. **Merkle Tree Generator** ([lib/snapshots/merkleTreeGenerator.ts](lib/snapshots/merkleTreeGenerator.ts))
   - Creates cryptographic proofs for each NFT holder
   - Enables cross-chain ownership verification on L2

4. **Contract Service** ([src/services/contractService.ts](src/services/contractService.ts))
   - Interacts with AbrahamSeeds contract on Base
   - Handles seed submission, blessings, and winner selection

### Smart Contracts

1. **AbrahamSeeds** (L2 Base) - Main governance contract
   - Seed submission and curation
   - Blessing (voting) system with Merkle proof verification
   - Daily winner selection
   - ERC1155 NFT minting for winners

2. **MerkleGating** (L2 Base) - Cross-chain verification module
   - Verifies L1 NFT ownership via Merkle proofs
   - Enables gasless blessings with proof verification

### API Routes

- **Seeds**: `GET/POST /api/seeds/*` - Seed management and queries
- **Blessings**: `GET/POST /api/blessings/*` - Blessing eligibility and submission
- **Commandments**: `GET/POST /api/commandments/*` - Comments on seeds
- **Leaderboard**: `GET /api/leaderboard/*` - User rankings
- **Admin**: `GET/POST /api/admin/*` - Admin operations and cron jobs

## Quick Start

### 1. Set Up Environment Variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# Privy Authentication
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret

# FirstWorks NFT Contract (L1 Ethereum)
FIRSTWORKS_CONTRACT_ADDRESS=0x9734c959A5FEC7BaD8b0b560AD94F9740B90Efd8
FIRSTWORKS_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# AbrahamSeeds Contract (L2 Base Sepolia)
L2_SEEDS_CONTRACT=0x0b95d25463b7a937b3df28368456f2c40e95c730
L2_GATING_CONTRACT=0x46657b69308d90a4756369094c5d78781f3f5979
L2_SEEDS_DEPLOYMENT_BLOCK=36452477
NETWORK=baseSepolia

# RPC URLs
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# Private Keys (for backend relayer)
RELAYER_PRIVATE_KEY=your_relayer_private_key

# Admin & API Keys
ADMIN_KEY=your_admin_key
CRON_SECRET=your_cron_secret
ALCHEMY_API_KEY=your_alchemy_key
```

### 2. Generate Initial Snapshot & Merkle Tree

```bash
# Fetch NFT ownership from L1
npm run snapshot:generate

# Generate Merkle tree for proofs
npm run merkle:generate
```

### 3. Start the Server

```bash
# Development mode with hot reload
npm run dev

# OR production mode
npm start
```

### 4. Test the API

```bash
# Health check
curl http://localhost:3000

# Get seed count
curl http://localhost:3000/api/seeds/count

# Get current voting stats
curl http://localhost:3000/api/seeds/stats

# Get contract config
curl http://localhost:3000/api/seeds/config

# Get seed by ID
curl http://localhost:3000/api/seeds/0

# Get leaderboard
curl http://localhost:3000/api/leaderboard

# Get snapshot status
curl http://localhost:3000/api/admin/snapshot-status
```

## Smart Contract Development

### Compile Contracts

```bash
npm run compile
```

### Deploy to Base Sepolia (Testnet)

```bash
npm run deploy:abraham-seeds:base-sepolia
```

This deploys:
1. MerkleGating module
2. AbrahamSeeds contract
3. Grants CREATOR_ROLE and OPERATOR_ROLE
4. Updates Merkle root
5. Creates a test seed

### Deploy to Base Mainnet

```bash
npm run deploy:abraham-seeds:base
```

### Update Merkle Root

After generating a new snapshot, update the on-chain Merkle root:

```bash
npm run update-root
```

### Run Contract Tests

```bash
npm run test:contracts
```

## Architecture Overview

```
+-------------------------------------------------------------+
|                    Ethereum L1 (Mainnet)                     |
+-------------------------------------------------------------+
|                                                              |
|  Abraham's First Works (Already Deployed)                   |
|  Address: 0x9734c959A5FEC7BaD8b0b560AD94F9740B90Efd8        |
|  - 2,044 NFTs - ownership = blessing power on L2            |
|                                                              |
+-------------------------------------------------------------+
                            |
                            | Daily Snapshot -> Merkle Tree
                            v
+-------------------------------------------------------------+
|                       Base L2                                |
+-------------------------------------------------------------+
|                                                              |
|  MerkleGating Module                                        |
|  Address: 0x46657b69308d90a4756369094c5d78781f3f5979        |
|  - Stores Merkle root for ownership verification            |
|                                                              |
|  AbrahamSeeds Contract                                       |
|  Address: 0x0b95d25463b7a937b3df28368456f2c40e95c730        |
|  - Seed submission (IPFS hash)                              |
|  - Blessing/voting (with Merkle proof verification)         |
|  - Commandments (comments on seeds)                          |
|  - Daily winner selection                                    |
|  - ERC1155 NFT minting for winners                          |
|                                                              |
+-------------------------------------------------------------+
```

## NPM Scripts Reference

### API
| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm start` | Start production server |
| `npm run snapshot:generate` | Generate FirstWorks NFT snapshot |
| `npm run merkle:generate` | Generate Merkle tree from snapshot |
| `npm run update-snapshot` | Full update: snapshot + merkle + contract |

### Smart Contracts
| Script | Description |
|--------|-------------|
| `npm run compile` | Compile Solidity contracts |
| `npm run deploy:abraham-seeds:base-sepolia` | Deploy to Base testnet |
| `npm run deploy:abraham-seeds:base` | Deploy to Base mainnet |
| `npm run update-root` | Update Merkle root on contract |
| `npm run test:contracts` | Run contract tests |
| `npm run grant-creator:base-sepolia` | Grant CREATOR_ROLE |

## File Structure

```
abraham-api/
+-- contracts/
|   +-- src/
|       +-- agents/abraham/AbrahamSeeds.sol   # Main governance contract
|       +-- modules/gating/MerkleGating.sol   # Cross-chain gating module
|       +-- core/EdenAgent.sol                # Base agent contract
+-- lib/
|   +-- abi/
|   |   +-- AbrahamSeeds.json                 # Contract ABI
|   |   +-- MerkleGating.json                 # Gating module ABI
|   |   +-- firstWorks.ts                     # FirstWorks NFT ABI
|   +-- snapshots/
|       +-- firstWorksSnapshot.ts             # Snapshot generator
|       +-- merkleTreeGenerator.ts            # Merkle tree generator
|       +-- latest.json                       # Generated snapshot
|       +-- firstWorks_merkle.json            # Merkle tree & proofs
+-- src/
|   +-- middleware/
|   |   +-- auth.ts                           # Privy authentication
|   +-- routes/
|   |   +-- seeds.ts                          # Seed endpoints
|   |   +-- blessings.ts                      # Blessing endpoints
|   |   +-- commandments.ts                   # Comment endpoints
|   |   +-- leaderboard.ts                    # Leaderboard endpoints
|   |   +-- admin.ts                          # Admin endpoints
|   +-- services/
|   |   +-- contractService.ts                # Contract interactions
|   |   +-- blessingService.ts                # Blessing logic
|   |   +-- commandmentService.ts             # Commandment logic
|   |   +-- leaderboardService.ts             # Leaderboard logic
|   +-- index.ts                              # Hono app
|   +-- server.ts                             # Server entry
+-- deploy/
|   +-- deploy_abraham_seeds.ts               # Deployment script
+-- scripts/
|   +-- updateMerkleRoot.ts                   # Update Merkle root
|   +-- updateSnapshot.ts                     # Full snapshot update
+-- .env.local                                # Environment variables
+-- hardhat.config.ts                         # Hardhat configuration
+-- package.json
```

## Daily Operations (Cron Jobs)

Set up automated daily operations via Vercel cron:

```json
{
  "crons": [
    {
      "path": "/api/admin/update-snapshot",
      "schedule": "0 1 * * *"
    },
    {
      "path": "/api/admin/select-winner?autoElevate=true",
      "schedule": "0 0 * * *"
    }
  ]
}
```

## Troubleshooting

### "No snapshot found" Error
- Run `npm run snapshot:generate` first
- Verify RPC URL is correct in `.env.local`

### "Invalid authentication token" Error
- Check Privy credentials in `.env.local`
- Ensure client is sending valid Privy JWT

### "Contract not initialized" Error
- Verify L2_SEEDS_CONTRACT is set correctly
- Check BASE_SEPOLIA_RPC_URL is valid

### "Merkle proof verification failed" Error
- Regenerate Merkle tree: `npm run merkle:generate`
- Update contract root: `npm run update-root`

## Resources

- [Smart Contract Summary](./SMART_CONTRACT_SUMMARY.md) - Contract architecture
- [API Reference](./docs/API_REFERENCE.md) - Complete API documentation
- [Deployment Guide](./docs/DEPLOYMENT_GUIDE.md) - Deployment instructions
- [Blessing System](./docs/BLESSING_SYSTEM.md) - How blessings work

---

**Ready to go!** Run `npm run snapshot:generate && npm run merkle:generate` then `npm run dev` to start.
