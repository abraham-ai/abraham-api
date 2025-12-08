# TheSeeds Deployment Guide

Complete guide for deploying TheSeeds contract and API infrastructure.

## Table of Contents

- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Complete Automated Deployment](#complete-automated-deployment)
- [Manual Step-by-Step Deployment](#manual-step-by-step-deployment)
- [Post-Deployment Configuration](#post-deployment-configuration)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

**One-command deployment for Base Sepolia:**

```bash
npm run deploy:complete:base-sepolia
```

**One-command deployment for Base Mainnet:**

```bash
npm run deploy:complete:base
```

This single command will:
1. ✅ Generate FirstWorks NFT ownership snapshot
2. ✅ Generate Merkle tree for on-chain verification
3. ✅ Compile smart contracts
4. ✅ Deploy TheSeeds contract
5. ✅ Update `.env.local` with contract address
6. ✅ Update ABI files (`lib/abi/theSeeds.ts` and `lib/abi/TheSeeds.json`)
7. ✅ Update Merkle root on-chain
8. ✅ Grant CREATOR_ROLE to relayer
9. ✅ Create test seed with IPFS hash

---

## Prerequisites

### Required Environment Variables

Create a `.env` file with the following:

```bash
# ============================================================
# BLOCKCHAIN CONFIGURATION
# ============================================================

# Admin/Deployer Private Key (has ADMIN_ROLE after deployment)
PRIVATE_KEY=0x...

# Backend Relayer Private Key (for gasless blessings)
RELAYER_PRIVATE_KEY=0x...

# Network Configuration
NETWORK=baseSepolia  # or "base" for mainnet

# RPC URLs (optional, has defaults)
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_RPC_URL=https://mainnet.base.org

# ============================================================
# NFT SNAPSHOT CONFIGURATION
# ============================================================

# FirstWorks NFT Contract (Ethereum Mainnet)
FIRSTWORKS_CONTRACT_ADDRESS=0x...

# Alchemy API (for fast NFT snapshot generation)
ALCHEMY_API_KEY=your_alchemy_api_key_here

# ============================================================
# API CONFIGURATION
# ============================================================

# Admin API Key (for admin endpoints)
ADMIN_KEY=your_secure_random_string_here

# Privy Authentication
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret

# ============================================================
# CONTRACT ADDRESSES (Auto-filled by deployment script)
# ============================================================

# These will be automatically added by the deployment script:
# THESEEDS_CONTRACT_ADDRESS=0x...
# L2_SEEDS_CONTRACT=0x...
```

### Required Tools

- Node.js 18+
- npm or yarn
- Git

### Install Dependencies

```bash
npm install
```

---

## Complete Automated Deployment

The automated deployment script handles everything for you.

### For Base Sepolia (Testnet)

```bash
npm run deploy:complete:base-sepolia
```

### For Base Mainnet (Production)

```bash
npm run deploy:complete:base
```

### Expected Output

```
╔════════════════════════════════════════════════════════════╗
║     TheSeeds Complete Deployment Automation Script        ║
╚════════════════════════════════════════════════════════════╝

🌐 Network: Base Sepolia
🔗 Chain ID: 84532

🔍 Validating environment variables...
✅ Environment variables validated

📝 Generating FirstWorks snapshot...
✅ Generating FirstWorks snapshot completed

📝 Generating Merkle tree...
✅ Generating Merkle tree completed

📋 Merkle Root: 0x...

📝 Compiling contracts and extracting ABI...
✅ Compiling contracts and extracting ABI completed

📝 Deploying TheSeeds contract...
Deployer: 0x...
Transaction hash: 0x...
Waiting for confirmation...
✅ Contract deployed at: 0x...
   Block: 12345678
   Explorer: https://sepolia.basescan.org/address/0x...

📝 Updating .env file...
✅ Updated .env with contract address: 0x...

📝 Updating lib/abi/theSeeds.ts...
✅ Updated lib/abi/theSeeds.ts

📝 Updating Merkle root on contract...
Transaction hash: 0x...
✅ Merkle root updated on contract
   Verified root: 0x...

📝 Granting CREATOR_ROLE to relayer...
Relayer address: 0x...
Transaction hash: 0x...
✅ CREATOR_ROLE granted to relayer

📝 Creating test seed...
IPFS Hash: ipfs://QmTiAN3G6xvgnE6hEgUMbs8T2zCZzuwEm1zPvvn4iQgKNa
Transaction hash: 0x...
✅ Test seed created

╔════════════════════════════════════════════════════════════╗
║              🎉 DEPLOYMENT SUCCESSFUL 🎉                   ║
╚════════════════════════════════════════════════════════════╝

📋 Deployment Summary:

Network:          Base Sepolia
Chain ID:         84532
Contract Address: 0x...
Merkle Root:      0x...
Deployer:         0x...
Relayer:          0x...

📝 Test Seed Details:

Seed ID:          0
Creator:          0x...
IPFS Hash:        ipfs://QmTiAN3G6xvgnE6hEgUMbs8T2zCZzuwEm1zPvvn4iQgKNa
Created At:       2025-11-21T10:30:00.000Z

🔗 Transaction Links:

Deployment:       https://sepolia.basescan.org/tx/0x...
Merkle Update:    https://sepolia.basescan.org/tx/0x...
Creator Grant:    https://sepolia.basescan.org/tx/0x...
Test Seed:        https://sepolia.basescan.org/tx/0x...

📁 Updated Files:

✅ .env.local (added THESEEDS_CONTRACT_ADDRESS)
✅ lib/abi/TheSeeds.json (compiled ABI)
✅ lib/abi/theSeeds.ts (TypeScript ABI with address)

🚀 Next Steps:

1. Start the API:
   npm run dev

2. Test the seed endpoint:
   curl http://localhost:3000/api/seeds/0

3. Test blessing (requires Privy auth):
   POST /api/blessings
   { "seedId": 0 }

✨ Deployment configuration saved to deployment-result.json
```

### Deployment Result File

The script saves complete deployment information to `deployment-result.json`:

```json
{
  "network": "baseSepolia",
  "networkName": "Base Sepolia",
  "chainId": 84532,
  "contractAddress": "0x...",
  "merkleRoot": "0x...",
  "deployer": "0x...",
  "relayer": "0x...",
  "testSeedId": 0,
  "txHashes": {
    "deployment": "0x...",
    "merkleUpdate": "0x...",
    "creatorGrant": "0x...",
    "testSeed": "0x..."
  },
  "timestamp": "2025-11-21T10:30:00.000Z",
  "explorer": "https://sepolia.basescan.org"
}
```

---

## Manual Step-by-Step Deployment

If you prefer to run each step manually or need to debug a specific step:

### Step 1: Generate FirstWorks Snapshot

```bash
npm run snapshot:generate
```

Creates `lib/snapshots/latest.json` with NFT ownership data.

### Step 2: Generate Merkle Tree

```bash
npm run merkle:generate
```

Creates `lib/snapshots/firstWorks_merkle.json` with Merkle proofs.

**⚠️ Save the Merkle root** - you'll need it later!

### Step 3: Compile Contracts

```bash
npm run compile
```

Compiles contracts and extracts ABI to `lib/abi/TheSeeds.json`.

### Step 4: Deploy Contract

**Base Sepolia:**
```bash
npm run deployseeds:base-sepolia
```

**Base Mainnet:**
```bash
npm run deployseeds:base
```

**⚠️ Save the contract address!**

### Step 5: Update Environment Variables

Add to your `.env.local`:

```bash
THESEEDS_CONTRACT_ADDRESS=0xYourContractAddress
L2_SEEDS_CONTRACT=0xYourContractAddress
```

### Step 6: Update ABI Files Manually

Update `lib/abi/theSeeds.ts`:

```typescript
export const SEEDS_ABI = [...] as const;
export const SEEDS_CONTRACT_ADDRESS = "0xYourContractAddress" as const;
```

### Step 7: Update Merkle Root

```bash
NETWORK=baseSepolia npm run update-root
```

### Step 8: Grant CREATOR_ROLE

```bash
npm run grant-creator:base-sepolia
```

### Step 9: Create Test Seed

```bash
npm run test-seed:base-sepolia
```

---

## Post-Deployment Configuration

### 1. Start the API

```bash
npm run dev
```

### 2. Test Endpoints

**Get all seeds:**
```bash
curl http://localhost:3000/api/seeds
```

**Get test seed:**
```bash
curl http://localhost:3000/api/seeds/0
```

**Submit new seed (requires CREATOR_ROLE):**
```bash
curl -X POST http://localhost:3000/api/seeds/submit-admin \
  -H "X-Admin-Key: your_admin_key" \
  -H "Content-Type: application/json" \
  -d '{"ipfsHash": "ipfs://QmYourHash..."}'
```

### 3. Grant RELAYER_ROLE (Optional - for gasless blessings)

```bash
cast send $THESEEDS_CONTRACT_ADDRESS \
  "addRelayer(address)" \
  $RELAYER_ADDRESS \
  --rpc-url https://sepolia.base.org \
  --private-key $PRIVATE_KEY
```

### 4. Configure Contract Parameters (Optional)

The Seeds contract includes configurable governance parameters that can be adjusted after deployment without redeployment:

#### Default Configuration

The contract deploys with these default values:
- **Voting Period**: 1 day (86,400 seconds)
- **Blessings Per NFT**: 1 blessing per NFT per day

#### Update Voting Period

Change the duration of each voting/blessing round:

```bash
# Update to 12 hours (43200 seconds)
cast send $THESEEDS_CONTRACT_ADDRESS \
  "updateVotingPeriod(uint256)" \
  43200 \
  --rpc-url https://sepolia.base.org \
  --private-key $ADMIN_PRIVATE_KEY

# Valid range: 3600 (1 hour) to 604800 (7 days)
```

**Via API (if admin endpoints are implemented):**
```bash
curl -X POST https://your-api.com/api/admin/config/voting-period \
  -H "X-Admin-Key: your_admin_key" \
  -H "Content-Type: application/json" \
  -d '{"votingPeriod": 43200}'
```

#### Update Blessings Per NFT

Change how many blessings each NFT holder can cast per day:

```bash
# Update to 3 blessings per NFT
cast send $THESEEDS_CONTRACT_ADDRESS \
  "updateBlessingsPerNFT(uint256)" \
  3 \
  --rpc-url https://sepolia.base.org \
  --private-key $ADMIN_PRIVATE_KEY

# Valid range: 1 to 100
```

**Via API (if admin endpoints are implemented):**
```bash
curl -X POST https://your-api.com/api/admin/config/blessings-per-nft \
  -H "X-Admin-Key: your_admin_key" \
  -H "Content-Type: application/json" \
  -d '{"blessingsPerNFT": 3}'
```

#### Monitor Configuration Changes

Listen for configuration update events:

```typescript
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

const client = createPublicClient({
  chain: baseSepolia,
  transport: http()
});

// Watch for voting period updates
client.watchEvent({
  address: contractAddress,
  event: parseAbiItem('event VotingPeriodUpdated(uint256 indexed previousPeriod, uint256 indexed newPeriod)'),
  onLogs: logs => {
    console.log('Voting period updated:', logs[0].args);
  }
});

// Watch for blessings per NFT updates
client.watchEvent({
  address: contractAddress,
  event: parseAbiItem('event BlessingsPerNFTUpdated(uint256 indexed previousAmount, uint256 indexed newAmount)'),
  onLogs: logs => {
    console.log('Blessings per NFT updated:', logs[0].args);
  }
});
```

#### Read Current Configuration

```bash
# Get current voting period
cast call $THESEEDS_CONTRACT_ADDRESS \
  "votingPeriod()" \
  --rpc-url https://sepolia.base.org

# Get current blessings per NFT
cast call $THESEEDS_CONTRACT_ADDRESS \
  "blessingsPerNFT()" \
  --rpc-url https://sepolia.base.org

# Get time until current period ends
cast call $THESEEDS_CONTRACT_ADDRESS \
  "getTimeUntilPeriodEnd()" \
  --rpc-url https://sepolia.base.org
```

**Important Notes:**
- Only accounts with `ADMIN_ROLE` can update these parameters
- Changes to `votingPeriod` do NOT affect the current round, only future rounds
- Changes to `blessingsPerNFT` take effect immediately for all users
- All configuration updates emit events for transparency

### 5. Set Up Daily Snapshot Updates

**Option A: Cron Job**

```bash
# Add to crontab (daily at midnight UTC)
0 0 * * * cd /path/to/abraham-api && npm run update-snapshot
```

**Option B: GitHub Actions**

Create `.github/workflows/update-snapshot.yml`:

```yaml
name: Update FirstWorks Snapshot
on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight UTC
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run update-snapshot
        env:
          ALCHEMY_API_KEY: ${{ secrets.ALCHEMY_API_KEY }}
          PRIVATE_KEY: ${{ secrets.PRIVATE_KEY }}
          THESEEDS_CONTRACT_ADDRESS: ${{ secrets.THESEEDS_CONTRACT_ADDRESS }}
```

**Option C: Admin API Endpoint**

```bash
curl -X POST https://your-api.com/api/admin/update-snapshot \
  -H "X-Admin-Key: your_admin_key"
```

---

## Troubleshooting

### "PRIVATE_KEY not set in environment"

**Solution:** Add your private key to `.env`:

```bash
PRIVATE_KEY=0x...
```

### "ALCHEMY_API_KEY not set in environment"

**Solution:** Get an API key from [Alchemy](https://alchemy.com) and add to `.env`:

```bash
ALCHEMY_API_KEY=your_key_here
```

### "Contract deployment failed - no address returned"

**Possible causes:**
1. Insufficient gas
2. Network connectivity issues
3. Invalid private key

**Solution:** Check your wallet balance and network connection.

### "does not have CREATOR_ROLE"

**Solution:** Grant CREATOR_ROLE:

```bash
CREATOR_ADDRESS=0xYourAddress npm run grant-creator:base-sepolia
```

### "Snapshot or Merkle tree not loaded"

**Solution:** Regenerate snapshot and Merkle tree:

```bash
npm run snapshot:generate
npm run merkle:generate
```

### TypeScript Errors After Deployment

**Solution:** Rebuild the project:

```bash
npm run build
```

---

## Development vs Production

### Base Sepolia (Testnet)

- Free to deploy and test
- Fast block times
- Use for development and testing
- Get testnet ETH from [Base Sepolia Faucet](https://www.coinbase.com/faucets/base-ethereum-goerli-faucet)

```bash
npm run deploy:complete:base-sepolia
```

### Base Mainnet (Production)

- Requires real ETH for gas
- Production environment
- Use after thorough testing on Sepolia

```bash
npm run deploy:complete:base
```

---

## Summary of Commands

```bash
# Complete automated deployment
npm run deploy:complete:base-sepolia  # Testnet
npm run deploy:complete:base          # Mainnet

# Manual step-by-step
npm run snapshot:generate             # Step 1
npm run merkle:generate               # Step 2
npm run compile                       # Step 3
npm run deployseeds:base-sepolia      # Step 4
npm run update-root                   # Step 7
npm run grant-creator:base-sepolia    # Step 8
npm run test-seed:base-sepolia        # Step 9

# Development
npm run dev                           # Start API server
npm run build                         # Build TypeScript
npm run typecheck                     # Type checking

# Maintenance
npm run update-snapshot               # Update snapshot + merkle + contract
```

---

## Technical Implementation Details

### How the Deployment Script Works

The automated deployment script ([scripts/deployComplete.ts](../scripts/deployComplete.ts)) implements several key patterns to ensure reliable deployment:

#### 1. **Contract Readiness Verification**

After deploying the contract, the script waits for it to be ready for read operations:

```typescript
async function waitForContract(
  publicClient: any,
  contractAddress: Address,
  abi: any,
  maxRetries: number = 10
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await publicClient.readContract({
        address: contractAddress,
        abi,
        functionName: "paused",
      });
      return; // Contract is ready
    } catch (error) {
      // Wait and retry
      await sleep(3000);
    }
  }
}
```

**Why:** Immediately after deployment, the contract may not be accessible for read operations. This retry logic ensures the contract is fully initialized before proceeding.

#### 2. **Reading Role Hashes from Contract**

Instead of hardcoding role hashes, the script reads them directly from the deployed contract:

```typescript
const roleAbi = parseAbi(["function CREATOR_ROLE() view returns (bytes32)"]);
CREATOR_ROLE = await publicClient.readContract({
  address: contractAddress,
  abi: roleAbi,
  functionName: "CREATOR_ROLE",
});
```

**Why:** Role hashes are computed as `keccak256("ROLE_NAME")`. Reading them from the contract ensures we always use the correct hash, even if the contract implementation changes.

#### 3. **State Propagation Delays**

The script includes strategic delays after state-changing operations:

```typescript
// After granting role
await sleep(2000);

// Then verify
const hasRole = await publicClient.readContract({
  address: contractAddress,
  abi: theSeedsAbi,
  functionName: "hasRole",
  args: [CREATOR_ROLE, relayerAccount.address],
});
```

**Why:** Blockchain state changes (like role grants) take time to propagate. The 2-second delay ensures subsequent read operations see the updated state.

#### 4. **Obtaining Seed ID from Contract Return Value**

The script gets the created seed ID directly from the contract's return value:

```typescript
// Simulate to get the return value
const { result: simulateResult } = await publicClient.simulateContract({
  address: contractAddress,
  abi: theSeedsAbi,
  functionName: "submitSeed",
  args: [TEST_IPFS_HASH],
  account: relayerAccount,
});

// The submitSeed function returns the seed ID
createdSeedId = simulateResult as bigint;

// Execute the actual transaction
seedHash = await relayerClient.writeContract({
  address: contractAddress,
  abi: theSeedsAbi,
  functionName: "submitSeed",
  args: [TEST_IPFS_HASH],
});
```

**Why:** The `submitSeed` function in TheSeeds.sol returns the created seed ID:

```solidity
function submitSeed(string memory _ipfsHash)
    external
    returns (uint256)
{
    uint256 seedId = seedCount;
    seedCount++;
    // ... create seed ...
    return seedId;
}
```

By simulating the transaction first, we can capture this return value before executing the actual transaction. This is more reliable than trying to calculate the seed ID from `seedCount` after the transaction.

#### 5. **Using Full Compiled ABI**

The script uses the full compiled ABI instead of minimal function signatures:

```typescript
// Import full compiled ABI with error definitions
import TheSeeds from "../artifacts/contracts/TheSeeds.sol/TheSeeds.json";
const theSeedsAbi = TheSeeds.abi;

// NOT this (minimal ABI without errors):
// const abi = parseAbi([
//   "function submitSeed(string) returns (uint256)",
//   // ... missing custom error definitions
// ]);
```

**Why:** The full ABI includes custom error definitions. When a transaction reverts, viem can properly decode the error signature (e.g., `0xe2517d3f`) into a readable error name (e.g., `NotAuthorized()`). With a minimal ABI, you only get the error signature.

#### 6. **Handling viem Return Value Formats**

The script handles both array and object return formats from viem:

```typescript
const seed = await publicClient.readContract({
  address: contractAddress,
  abi: theSeedsAbi,
  functionName: "getSeed",
  args: [seedId],
});

// viem may return as array or object
if (Array.isArray(seed)) {
  [id, creator, ipfsHash, votes, blessings, createdAt, minted, mintedInRound] = seed;
} else {
  const s = seed as any;
  id = s.id;
  creator = s.creator;
  ipfsHash = s.ipfsHash;
  // ... etc
}
```

**Why:** Viem's return format can vary based on the Solidity struct definition and ABI version. This defensive programming ensures compatibility across different viem versions.

#### 7. **Environment File Updates**

The script updates `.env.local` (not `.env`) with the contract address:

```typescript
function updateEnvFile(contractAddress: string): void {
  const envPath = ".env.local";
  let envContent = "";

  if (existsSync(envPath)) {
    envContent = readFileSync(envPath, "utf-8");
  }

  // Update or add THESEEDS_CONTRACT_ADDRESS
  if (envContent.includes("THESEEDS_CONTRACT_ADDRESS=")) {
    envContent = envContent.replace(
      /THESEEDS_CONTRACT_ADDRESS=.*/,
      `THESEEDS_CONTRACT_ADDRESS=${contractAddress}`
    );
  } else {
    envContent += `\nTHESEEDS_CONTRACT_ADDRESS=${contractAddress}\n`;
  }

  // Also update L2_SEEDS_CONTRACT
  // ... similar logic

  writeFileSync(envPath, envContent);
}
```

**Why:** `.env.local` is the standard Next.js convention for local environment variables and is typically gitignored. This prevents accidentally committing sensitive contract addresses.

### Error Handling and Validation

The script includes comprehensive error handling:

```typescript
try {
  // Simulate first to catch errors before sending transaction
  await publicClient.simulateContract({
    address: contractAddress,
    abi: theSeedsAbi,
    functionName: "submitSeed",
    args: [TEST_IPFS_HASH],
    account: relayerAccount,
  });

  // If simulation succeeds, execute actual transaction
  const hash = await relayerClient.writeContract({
    address: contractAddress,
    abi: theSeedsAbi,
    functionName: "submitSeed",
    args: [TEST_IPFS_HASH],
  });
} catch (error: any) {
  console.error("Error details:", error.message);

  // Provide context-specific error messages
  if (error.message.includes("0xe2517d3f")) {
    console.error("This is likely an AccessControl issue.");
    console.error("Check that the relayer has CREATOR_ROLE.");
  }

  throw error;
}
```

**Benefits:**
1. **Simulation catches errors before gas is spent**
2. **Context-specific error messages help debugging**
3. **Error codes are decoded using the full ABI**

### Testing the Deployment

After running the automated deployment, verify everything works:

```bash
# 1. Check that contract address was added to .env.local
grep THESEEDS_CONTRACT_ADDRESS .env.local

# 2. Check that ABI files were updated
ls -la lib/abi/theSeeds.ts
ls -la lib/abi/TheSeeds.json

# 3. Check deployment result file
cat deployment-result.json | jq

# 4. Verify the test seed was created
curl http://localhost:3000/api/seeds/0
```

### Maintenance and Updates

**Daily Snapshot Updates:**

The `npm run update-snapshot` command runs:
1. `npm run snapshot:generate` - Generate new NFT ownership snapshot
2. `npm run merkle:generate` - Generate new Merkle tree
3. `npm run update-root` - Update Merkle root on-chain

**Why daily updates?** NFT ownership changes as tokens are bought/sold. The Merkle root must be updated to reflect current ownership for voting eligibility.

---

## Support

For issues or questions:
1. Check [BLESSING_SYSTEM.md](./BLESSING_SYSTEM.md) for blessing system details
2. Review contract code in [contracts/TheSeeds.sol](../contracts/TheSeeds.sol)
3. Check deployment logs in `deployment-result.json`
4. Review deployment script implementation in [scripts/deployComplete.ts](../scripts/deployComplete.ts)

---

**Happy Deploying! 🚀**
