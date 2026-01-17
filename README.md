# Abraham API

A Hono-based API for managing onchain Seeds (artwork proposals) and NFT-based blessings for the Abraham AI art curation ecosystem.

## Overview

This API provides:
1. **Seed Creation** - Onchain artwork proposals with authorized creator control
2. **Round-Based Winner Selection** - Daily competition with anti-whale mechanics
3. **Blessings System** - NFT-gated voting with quadratic scoring
4. **ERC1155 Editions** - Winning seeds become collectible NFTs

The system uses:
- **AbrahamSeeds Contract** (Base L2) - ERC1155-based seed and blessing management
- **MerkleGating Module** (Base L2) - Cross-chain NFT verification via Merkle proofs
- **FirstWorks NFT** (Ethereum L1) - NFT ownership for blessing eligibility
- **Privy** - Authentication
- **Viem** - Blockchain interactions
- **Hono** - Lightweight web framework

## Architecture

```
L1 (Ethereum Mainnet)              L2 (Base)
┌──────────────────┐               ┌───────────────────┐
│  FirstWorks NFT  │───snapshot───▶│   MerkleGating    │
│  (ERC721)        │               │   (Proof Verify)  │
└──────────────────┘               └─────────┬─────────┘
                                             │
                                   ┌─────────▼─────────┐
                                   │   AbrahamSeeds    │
                                   │   (ERC1155)       │
                                   │   ├─ Seeds        │
                                   │   ├─ Blessings    │
                                   │   ├─ Creations    │
                                   │   └─ Editions     │
                                   └───────────────────┘
```

### Key Features

#### Seed Creation
- **Onchain Storage**: All seeds stored on AbrahamSeeds contract (Base L2)
- **Authorized Creators**: Only wallets with CREATOR_ROLE can create seeds
- **Two Creation Modes**:
  - **Backend-Signed (Gasless)**: API creates seed on behalf of creator
  - **Client-Signed**: Creator signs transaction with their wallet
- **Access Control**: Role-based permissions (ADMIN, CREATOR, OPERATOR)

#### Blessing System
- **NFT-Gated**: Only FirstWorks NFT holders can bless
- **Cross-Chain Verification**: L1 ownership verified via Merkle proofs on L2
- **Daily Limits**: N blessings per day where N = NFTs owned (configurable)
- **Quadratic Scoring**: Score = √(blessings) prevents whale dominance
- **Delegation Support**: Users can approve backend for gasless blessings

#### Winner Selection
- **Round-Based**: Each 24-hour period is an independent competition
- **Anti-Whale**: Square root scoring prevents large holders from dominating
- **Daily Winners**: Highest scoring seed wins each round
- **ERC1155 Minting**: Winners receive edition NFTs (creator, curator, public)

#### Edition System
- **Creator Editions**: Minted directly to seed creator
- **Curator Editions**: Distributed to top blessers (priests)
- **Public Editions**: Available for purchase (50/50 split: creator/treasury)

## Deployed Contracts

| Network | Contract | Address |
|---------|----------|---------|
| Base Sepolia | AbrahamSeeds | `0x0b95d25463b7a937b3df28368456f2c40e95c730` |
| Base Sepolia | MerkleGating | `0x46657b69308d90a4756369094c5d78781f3f5979` |
| Ethereum Mainnet | FirstWorks NFT | `0x9734c959A5FEC7BaD8b0b560AD94F9740B90Efd8` |

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env.local
# Edit .env.local with your configuration
```

**Required variables:**
```env
# Privy Authentication
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret

# AbrahamSeeds Contract (L2)
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

### 3. Generate NFT snapshot and Merkle tree

```bash
# Generate FirstWorks NFT ownership snapshot
npm run snapshot:generate

# Generate Merkle tree from snapshot
npm run merkle:generate
```

### 4. Start the development server

```bash
npm run dev
```

The API will be running at `http://localhost:3000`

## API Endpoints

### Seeds

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/seeds` | GET | Get all seeds (paginated) |
| `/api/seeds/count` | GET | Get total seed count |
| `/api/seeds/stats` | GET | Get seed statistics |
| `/api/seeds/config` | GET | Get contract configuration |
| `/api/seeds/:seedId` | GET | Get seed by ID |
| `/api/seeds` | POST | Create seed (backend-signed) |
| `/api/seeds/prepare` | POST | Prepare seed creation transaction |

### Blessings

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/blessings` | POST | Submit blessing (gasless) |
| `/api/blessings/prepare` | POST | Prepare blessing transaction |
| `/api/blessings/eligibility` | GET | Check user eligibility |
| `/api/blessings/stats` | GET | Get user blessing stats |
| `/api/blessings/delegation-status` | GET | Check delegation status |
| `/api/blessings/prepare-delegate` | POST | Prepare delegation transaction |
| `/api/blessings/seed/:seedId` | GET | Get blessings for seed |
| `/api/blessings/user/:address` | GET | Get blessings by user |

### Admin

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/update-snapshot` | POST | Update NFT snapshot + Merkle tree |
| `/api/admin/snapshot-status` | GET | Get snapshot status |
| `/api/cron/select-winner` | POST | Select daily winner |

## Snapshot & Merkle Tree Updates

The system uses NFT ownership snapshots to verify blessing eligibility. Update periodically:

### Via CLI

```bash
# Full update: snapshot + merkle + contract
npm run update-snapshot

# Skip contract update
SKIP_CONTRACT_UPDATE=true npm run update-snapshot
```

### Via API

```bash
curl -X POST http://localhost:3000/api/admin/update-snapshot \
  -H "X-Admin-Key: your-admin-key"
```

### Automated (Vercel Cron)

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/update-snapshot",
      "schedule": "0 1 * * *"
    },
    {
      "path": "/api/cron/select-winner",
      "schedule": "0 0 * * *"
    }
  ]
}
```

## Role System

AbrahamSeeds uses OpenZeppelin's AccessControl:

| Role | Powers |
|------|--------|
| `DEFAULT_ADMIN_ROLE` | Grant/revoke roles, update config, pause contract |
| `CREATOR_ROLE` | Submit seeds |
| `OPERATOR_ROLE` | Select winners, distribute curator editions, relayer operations |

### Granting Roles

```bash
# Grant CREATOR_ROLE
npm run grant-creator:base-sepolia -- --address 0xNewCreator

# Or via Hardhat console
npx hardhat console --network baseSepolia
> const contract = await ethers.getContractAt("AbrahamSeeds", "0x0b95d25463b7a937b3df28368456f2c40e95c730")
> await contract.addCreator("0xNewCreator")
```

## Scoring System

### Quadratic (Square Root) Scoring

Prevents whale dominance:

```
Score = √(user_blessings)

Examples:
- 1 blessing = score 1
- 4 blessings = score 2
- 100 blessings = score 10
- 10000 blessings = score 100
```

### Total Seed Score

```
Total Score = Σ √(blessings_from_user_i) for all users

Example:
- User A: 100 blessings → √100 = 10
- User B: 25 blessings → √25 = 5
- User C: 4 blessings → √4 = 2
- Total Score: 10 + 5 + 2 = 17
```

## Client Integration

### React + Privy Example

```typescript
import { usePrivy } from "@privy-io/react-auth";

const { getAccessToken } = usePrivy();

// Check eligibility
async function checkEligibility() {
  const token = await getAccessToken();
  const response = await fetch("/api/blessings/eligibility", {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.json();
}

// Submit blessing (gasless)
async function blessSeed(seedId: number) {
  const token = await getAccessToken();
  const response = await fetch("/api/blessings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ seedId })
  });
  return response.json();
}
```

### Delegation Flow

For gasless blessings, users must approve the backend as delegate:

```typescript
// 1. Check delegation status
const status = await fetch("/api/blessings/delegation-status", {
  headers: { Authorization: `Bearer ${token}` }
}).then(r => r.json());

// 2. If not approved, get delegation transaction
if (!status.data.isDelegateApproved) {
  const delegateTx = await fetch("/api/blessings/prepare-delegate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ approved: true })
  }).then(r => r.json());

  // 3. User signs delegation transaction
  await walletClient.sendTransaction({
    to: delegateTx.data.transaction.to,
    data: delegateTx.data.transaction.data
  });
}

// 4. Now gasless blessings work
await blessSeed(seedId);
```

## Contract Deployment

### Deploy to Base Sepolia

```bash
npm run deploy:abraham-seeds:base-sepolia
```

### Deploy to Base Mainnet

```bash
npm run deploy:abraham-seeds:base
```

The deployment script:
1. Deploys MerkleGating module
2. Deploys AbrahamSeeds contract
3. Grants CREATOR_ROLE and OPERATOR_ROLE to relayer
4. Updates MerkleGating with Merkle root
5. Creates a test seed
6. Saves ABIs and deployment info

## Project Structure

```
abraham-api/
├── contracts/
│   └── src/
│       ├── agents/abraham/
│       │   └── AbrahamSeeds.sol      # Main contract
│       ├── core/
│       │   └── EdenAgent.sol         # Base contract
│       ├── modules/gating/
│       │   └── MerkleGating.sol      # NFT verification
│       └── interfaces/
│           └── IGatingModule.sol     # Gating interface
├── deploy/
│   └── deploy_abraham_seeds.ts       # Deployment script
├── lib/
│   ├── abi/                          # Contract ABIs
│   └── snapshots/                    # NFT snapshots & Merkle trees
├── src/
│   ├── middleware/
│   │   └── auth.ts                   # Privy auth
│   ├── routes/
│   │   ├── blessings.ts              # Blessing endpoints
│   │   ├── seeds.ts                  # Seed endpoints
│   │   └── commandments.ts           # Commandment endpoints
│   ├── services/
│   │   ├── contractService.ts        # Contract interactions
│   │   └── blessingService.ts        # Blessing logic
│   └── server.ts                     # Main entry
├── docs/
│   ├── API_REFERENCE.md              # API documentation
│   ├── DEPLOYMENT_GUIDE.md           # Deployment guide
│   └── SEEDS_CONTRACT_REFERENCE.md   # Contract reference
├── .env.example                      # Environment template
├── hardhat.config.ts
├── package.json
├── QUICKSTART.md                     # Quick start guide
├── SETUP.md                          # Detailed setup guide
└── SMART_CONTRACT_SUMMARY.md         # Contract architecture
```

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm start` | Start production server |
| `npm run compile` | Compile Solidity contracts |
| `npm run snapshot:generate` | Generate NFT ownership snapshot |
| `npm run merkle:generate` | Generate Merkle tree |
| `npm run update-snapshot` | Full snapshot + merkle + contract update |
| `npm run deploy:abraham-seeds:base-sepolia` | Deploy to testnet |
| `npm run deploy:abraham-seeds:base` | Deploy to mainnet |
| `npm run grant-creator:base-sepolia` | Grant CREATOR_ROLE |
| `npm run select-winner` | Manually select winner |
| `npm run test:contracts` | Run contract tests |

## Documentation

- [QUICKSTART.md](./QUICKSTART.md) - Quick start guide
- [SETUP.md](./SETUP.md) - Detailed setup instructions
- [SMART_CONTRACT_SUMMARY.md](./SMART_CONTRACT_SUMMARY.md) - Contract architecture
- [docs/DEPLOYMENT_GUIDE.md](./docs/DEPLOYMENT_GUIDE.md) - Deployment guide
- [docs/API_REFERENCE.md](./docs/API_REFERENCE.md) - API endpoints reference
- [docs/SEEDS_CONTRACT_REFERENCE.md](./docs/SEEDS_CONTRACT_REFERENCE.md) - Contract functions

## Troubleshooting

### "No snapshot found" error
```bash
npm run snapshot:generate
npm run merkle:generate
```

### "Merkle proof verification failed"
```bash
npm run merkle:generate
npm run update-root
```

### "Backend not authorized"
User needs to approve delegation:
```bash
POST /api/blessings/prepare-delegate
# User signs the returned transaction
```

### "Relayer does not have CREATOR_ROLE"
```bash
npm run grant-creator:base-sepolia -- --address 0xRelayerAddress
```

### Contract verification
```bash
npm run verify:seeds:base-sepolia
```

## Security

- Private keys stored in environment variables only
- `.env.local` in `.gitignore`
- Relayer wallet separate from deployer
- Admin key required for sensitive endpoints
- Role-based access control on contract

## License

MIT

## Support

For issues or questions, please open an issue in the repository.
