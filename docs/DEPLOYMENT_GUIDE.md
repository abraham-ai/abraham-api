# AbrahamSeeds Contract Deployment & Setup Guide

## Overview

This guide walks you through deploying the AbrahamSeeds contract and MerkleGating module, and setting up all necessary roles for seed creation and blessing functionality.

## Contract Architecture

The deployment creates two contracts:
1. **MerkleGating** - Handles cross-chain NFT ownership verification
2. **AbrahamSeeds** - Main governance contract for seeds, blessings, and winner selection

## Understanding the Roles

AbrahamSeeds uses OpenZeppelin's AccessControl with these roles:

### 1. DEFAULT_ADMIN_ROLE
**Powers:**
- Grant/revoke all other roles
- Full administrative control

**Who gets it:**
- The deployer wallet (automatically on deployment)

### 2. CREATOR_ROLE
**Powers:**
- Create seeds (submit artwork proposals)

**Who should have it:**
- Backend API wallet (for gasless seed creation)
- Authorized creator wallets
- Curators or trusted community members

### 3. OPERATOR_ROLE
**Powers:**
- Select daily winners
- Update contract settings
- Administrative operations

**Who should have it:**
- Backend API wallet (for automated operations)
- Admin wallets

---

## Step-by-Step Deployment

### Step 1: Prepare Environment

Create `.env.local` with required variables:

```bash
# Deployment wallet (will become ADMIN)
DEPLOYER_PRIVATE_KEY=0x...
RELAYER_PRIVATE_KEY=0x...

# Network Configuration
NETWORK=baseSepolia  # or "base" for mainnet

# RPC URLs
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
BASE_MAINNET_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY

# L1 FirstWorks NFT (for Merkle tree)
FIRSTWORKS_CONTRACT_ADDRESS=0x9734c959A5FEC7BaD8b0b560AD94F9740B90Efd8
FIRSTWORKS_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# API Keys
ALCHEMY_API_KEY=your_alchemy_key
BASESCAN_API_KEY=your_basescan_key
```

### Step 2: Generate Merkle Tree

Before deployment, generate the FirstWorks NFT ownership Merkle tree:

```bash
# Generate NFT ownership snapshot
npm run snapshot:generate

# Generate Merkle tree from snapshot
npm run merkle:generate
```

This creates `lib/snapshots/firstWorks_merkle.json` with:
- Merkle root hash
- Proofs for each NFT holder

### Step 3: Compile Contracts

```bash
npm run compile
```

This compiles:
- `contracts/src/agents/abraham/AbrahamSeeds.sol`
- `contracts/src/modules/gating/MerkleGating.sol`
- `contracts/src/core/EdenAgent.sol`

And extracts ABIs to `lib/abi/`.

### Step 4: Deploy Contracts

```bash
# Deploy to Base Sepolia (testnet)
npm run deploy:abraham-seeds:base-sepolia

# Or deploy to Base Mainnet (production)
npm run deploy:abraham-seeds:base
```

**What the deployment script does:**
1. Deploys MerkleGating module
2. Deploys AbrahamSeeds contract with MerkleGating address
3. Grants CREATOR_ROLE to relayer wallet
4. Grants OPERATOR_ROLE to relayer wallet
5. Updates MerkleGating with Merkle root
6. Creates a test seed (optional)
7. Saves contract addresses and ABIs

**Expected Output:**
```
=== Deploying AbrahamSeeds Contract ===
Network: baseSepolia
Deployer: 0xYourDeployerAddress

Step 1: Deploying MerkleGating...
MerkleGating deployed at: 0x46657b69308d90a4756369094c5d78781f3f5979

Step 2: Deploying AbrahamSeeds...
AbrahamSeeds deployed at: 0x0b95d25463b7a937b3df28368456f2c40e95c730

Step 3: Granting roles...
CREATOR_ROLE granted to: 0xRelayerAddress
OPERATOR_ROLE granted to: 0xRelayerAddress

Step 4: Setting Merkle root...
Merkle root set: 0xfd75a1bb...

Step 5: Creating test seed...
Test seed created with ID: 0

=== Deployment Complete ===
```

### Step 5: Update Environment

Add the deployed contract addresses to `.env.local`:

```bash
# AbrahamSeeds Contract (L2 Base)
L2_SEEDS_CONTRACT=0x0b95d25463b7a937b3df28368456f2c40e95c730
L2_GATING_CONTRACT=0x46657b69308d90a4756369094c5d78781f3f5979
L2_SEEDS_DEPLOYMENT_BLOCK=36452477
```

### Step 6: Verify Contracts (Optional)

```bash
# Verify on BaseScan
npm run verify:seeds:base-sepolia
```

---

## Granting Additional Roles

### Grant CREATOR_ROLE to New Creators

Using Hardhat script:
```bash
npm run grant-creator:base-sepolia -- --address 0xNewCreatorAddress
```

Or manually via Hardhat console:
```bash
npx hardhat console --network baseSepolia
```

```javascript
const { ethers } = require("hardhat");

const AbrahamSeeds = await ethers.getContractAt(
  "AbrahamSeeds",
  "0x0b95d25463b7a937b3df28368456f2c40e95c730"
);

// Get CREATOR_ROLE hash
const CREATOR_ROLE = await AbrahamSeeds.CREATOR_ROLE();

// Grant role
const tx = await AbrahamSeeds.grantRole(CREATOR_ROLE, "0xNewCreatorAddress");
await tx.wait();
console.log("CREATOR_ROLE granted");

// Verify
const hasRole = await AbrahamSeeds.hasRole(CREATOR_ROLE, "0xNewCreatorAddress");
console.log("Has CREATOR_ROLE:", hasRole);
```

### Grant OPERATOR_ROLE

```javascript
const OPERATOR_ROLE = await AbrahamSeeds.OPERATOR_ROLE();
await AbrahamSeeds.grantRole(OPERATOR_ROLE, "0xNewOperatorAddress");
```

---

## Updating Merkle Root

When NFT ownership changes on L1, update the Merkle root:

```bash
# Full pipeline: snapshot + merkle + contract update
npm run update-snapshot

# Or step by step:
npm run snapshot:generate
npm run merkle:generate
npm run update-root
```

The `update-root` script:
1. Reads the Merkle root from `lib/snapshots/firstWorks_merkle.json`
2. Calls `setMerkleRoot()` on MerkleGating contract
3. Verifies the update was successful

---

## Testing Your Deployment

### 1. Check Contract Configuration

```bash
curl http://localhost:3000/api/seeds/config
```

Expected response:
```json
{
  "success": true,
  "data": {
    "roundMode": { "value": 0, "name": "ROUND_BASED" },
    "tieBreakingStrategy": { "value": 0, "name": "LOWEST_SEED_ID" },
    "eligibleSeedsCount": 1
  }
}
```

### 2. Check Seed Count

```bash
curl http://localhost:3000/api/seeds/count
```

### 3. Check Backend Has Roles

```bash
curl http://localhost:3000/api/seeds/creator/0xYourRelayerAddress/check
```

Expected response:
```json
{
  "success": true,
  "data": {
    "address": "0xYourRelayerAddress",
    "hasCreatorRole": true
  }
}
```

### 4. Check Snapshot Status

```bash
curl http://localhost:3000/api/admin/snapshot-status
```

---

## Environment Variables Reference

```bash
# ============ L1 Configuration ============
# FirstWorks NFT Contract (Ethereum Mainnet)
FIRSTWORKS_CONTRACT_ADDRESS=0x9734c959A5FEC7BaD8b0b560AD94F9740B90Efd8
FIRSTWORKS_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# ============ L2 Configuration ============
# AbrahamSeeds Contract (Base)
L2_SEEDS_CONTRACT=0x0b95d25463b7a937b3df28368456f2c40e95c730
L2_GATING_CONTRACT=0x46657b69308d90a4756369094c5d78781f3f5979
L2_SEEDS_DEPLOYMENT_BLOCK=36452477
NETWORK=baseSepolia

# RPC URLs
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
BASE_MAINNET_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# ============ Private Keys ============
DEPLOYER_PRIVATE_KEY=0x...
RELAYER_PRIVATE_KEY=0x...

# ============ API Configuration ============
ADMIN_KEY=your-secret-admin-key
CRON_SECRET=your-cron-secret
ALCHEMY_API_KEY=your_alchemy_key
BASESCAN_API_KEY=your_basescan_key

# ============ Privy Auth ============
PRIVY_APP_ID=your-privy-app-id
PRIVY_APP_SECRET=your-privy-app-secret
```

---

## NPM Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run compile` | Compile Solidity contracts |
| `npm run deploy:abraham-seeds:base-sepolia` | Deploy to Base Sepolia testnet |
| `npm run deploy:abraham-seeds:base` | Deploy to Base mainnet |
| `npm run grant-creator:base-sepolia` | Grant CREATOR_ROLE on testnet |
| `npm run grant-creator:base` | Grant CREATOR_ROLE on mainnet |
| `npm run update-root` | Update Merkle root on contract |
| `npm run snapshot:generate` | Generate FirstWorks NFT snapshot |
| `npm run merkle:generate` | Generate Merkle tree from snapshot |
| `npm run verify:seeds:base-sepolia` | Verify contract on BaseScan |

---

## Troubleshooting

### "Relayer does not have CREATOR_ROLE"

Grant the role to your relayer wallet:
```bash
npm run grant-creator:base-sepolia -- --address 0xYourRelayerAddress
```

### "Contract not initialized"

Check that `L2_SEEDS_CONTRACT` is set correctly in `.env.local` and the RPC URL is valid.

### "Merkle proof verification failed"

1. Regenerate the Merkle tree: `npm run merkle:generate`
2. Update the contract: `npm run update-root`

### "Transaction reverted"

Check:
1. Relayer wallet has enough ETH for gas
2. Relayer wallet has required roles
3. Contract is not paused

---

## Security Checklist

- [ ] Deployer private key stored securely (hardware wallet recommended)
- [ ] Relayer wallet different from deployer wallet
- [ ] `ADMIN_KEY` is a strong, random secret
- [ ] Private keys never committed to git
- [ ] `.env.local` in `.gitignore`
- [ ] Relayer wallet has minimal funds (just for gas)
- [ ] Contract verified on BaseScan
- [ ] Multi-sig for admin operations (production)

---

## Production Deployment Checklist

1. [ ] Generate fresh Merkle tree from latest L1 snapshot
2. [ ] Deploy MerkleGating and AbrahamSeeds to mainnet
3. [ ] Grant roles to production relayer wallet
4. [ ] Update production `.env` with new contract addresses
5. [ ] Verify contracts on BaseScan
6. [ ] Test all API endpoints
7. [ ] Set up cron jobs for daily operations
8. [ ] Configure monitoring and alerting
9. [ ] Document all contract addresses
