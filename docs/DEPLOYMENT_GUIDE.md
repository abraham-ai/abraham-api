# TheSeeds Contract Deployment & Setup Guide

## Overview

This guide walks you through deploying TheSeeds contract and setting up all necessary roles for seed creation and blessing functionality.

## Understanding the Roles

TheSeeds contract uses OpenZeppelin's AccessControl with three roles:

### 1. ADMIN_ROLE (DEFAULT_ADMIN_ROLE)
**Powers:**
- Grant/revoke all other roles
- Update Merkle root for NFT ownership
- Pause/unpause contract
- Configure contract parameters

**Who gets it:**
- The deployer wallet (automatically on deployment)

### 2. CREATOR_ROLE
**Powers:**
- Create seeds (submit artwork proposals)
- That's it - just seed creation

**Who should have it:**
- Backend API wallet (for gasless seed creation)
- Authorized creator wallets (for direct seed creation)
- Curators or trusted community members

### 3. RELAYER_ROLE
**Powers:**
- Submit blessings on behalf of users (if user hasn't delegated)
- Batch blessing operations

**Who should have it:**
- Backend API wallet (for gasless blessings)

---

## Step-by-Step Deployment

### Step 1: Prepare Environment

Create `.env.local` with your deployment wallet:

```bash
# Deployment wallet (will become ADMIN)
PRIVATE_KEY=0x...  # Your deployer wallet private key

# Network RPCs
BASE_SEPOLIA_RPC=https://sepolia.base.org
BASE_MAINNET_RPC=https://mainnet.base.org
```

**⚠️ Important**: This wallet will be the initial ADMIN and control all roles.

### Step 2: Deploy Contract

```bash
# Compile first
npx hardhat compile

# Deploy to Base Sepolia (testnet)
npm run deployseeds:base-sepolia

# Or deploy to Base Mainnet (production)
npm run deployseeds:base
```

**What happens:**
1. Contract deploys with your wallet as ADMIN
2. You get the contract address (e.g., `0x878baad...`)
3. Your wallet automatically gets `ADMIN_ROLE`

**Output:**
```
=== Deployment Successful ===
The Seeds deployed at: 0x878baad70577cf114a3c60fd01b5a036fd0c4bc8
Owner: 0xYourDeployerAddress
Block number: 12345678
```

### Step 3: Configure Backend API

Add the deployed contract address to your API's `.env.local`:

```bash
# Contract Configuration
CONTRACT_ADDRESS=0x878baad70577cf114a3c60fd01b5a036fd0c4bc8
NETWORK=baseSepolia  # or "base" for mainnet

# Backend API wallet (needs CREATOR_ROLE + RELAYER_ROLE)
RELAYER_PRIVATE_KEY=0x...  # Different from deployer!

# Admin authentication
ADMIN_KEY=your-secret-admin-key-here

# RPC URLs
BASE_SEPOLIA_RPC=https://sepolia.base.org
BASE_MAINNET_RPC=https://mainnet.base.org

# Privy auth
PRIVY_APP_ID=your-privy-app-id
PRIVY_APP_SECRET=your-privy-app-secret
```

**⚠️ Security Best Practice:**
- Use a **different wallet** for `RELAYER_PRIVATE_KEY` (not the deployer)
- Keep deployer key secure and separate
- Never expose deployer key in API environment

---

## Step 4: Grant Roles to Backend API

Your backend needs two roles:
1. **CREATOR_ROLE** - to create seeds on behalf of users
2. **RELAYER_ROLE** - to submit blessings on behalf of users

### Option A: Using Hardhat Console

```bash
npx hardhat console --network baseSepolia
```

```javascript
// Get contract
const TheSeeds = await ethers.getContractAt(
  "TheSeeds",
  "0x878baad70577cf114a3c60fd01b5a036fd0c4bc8"
);

// Get your backend wallet address
const backendWallet = "0xYOUR_BACKEND_WALLET_ADDRESS";

// Grant CREATOR_ROLE
console.log("Granting CREATOR_ROLE to backend...");
let tx = await TheSeeds.addCreator(backendWallet);
await tx.wait();
console.log("✅ CREATOR_ROLE granted");

// Grant RELAYER_ROLE
console.log("Granting RELAYER_ROLE to backend...");
tx = await TheSeeds.addRelayer(backendWallet);
await tx.wait();
console.log("✅ RELAYER_ROLE granted");

// Verify roles
const CREATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("CREATOR_ROLE"));
const RELAYER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("RELAYER_ROLE"));

const hasCreator = await TheSeeds.hasRole(CREATOR_ROLE, backendWallet);
const hasRelayer = await TheSeeds.hasRole(RELAYER_ROLE, backendWallet);

console.log("Backend has CREATOR_ROLE:", hasCreator);
console.log("Backend has RELAYER_ROLE:", hasRelayer);
```

### Option B: Using Cast (Foundry)

```bash
# Your contract address
CONTRACT=0x878baad70577cf114a3c60fd01b5a036fd0c4bc8

# Backend wallet address (from RELAYER_PRIVATE_KEY)
BACKEND=0xYOUR_BACKEND_WALLET_ADDRESS

# Your deployer private key (has ADMIN_ROLE)
DEPLOYER_KEY=0x...

# Grant CREATOR_ROLE
cast send $CONTRACT \
  "addCreator(address)" \
  $BACKEND \
  --rpc-url https://sepolia.base.org \
  --private-key $DEPLOYER_KEY

# Grant RELAYER_ROLE
cast send $CONTRACT \
  "addRelayer(address)" \
  $BACKEND \
  --rpc-url https://sepolia.base.org \
  --private-key $DEPLOYER_KEY

# Verify roles
cast call $CONTRACT \
  "hasRole(bytes32,address)(bool)" \
  0x828634d95e775031b9ff576c159e20a8a57946bda7a10f5b0e5f3b5f0e0ad4e7 \
  $BACKEND \
  --rpc-url https://sepolia.base.org

cast call $CONTRACT \
  "hasRole(bytes32,address)(bool)" \
  0x5e17fc5225d4a099df75359ce1f405503ca79498a8dc46a7d583235a0ee45c16 \
  $BACKEND \
  --rpc-url https://sepolia.base.org
```

**Role Hashes:**
- `CREATOR_ROLE`: `0x828634d95e775031b9ff576c159e20a8a57946bda7a10f5b0e5f3b5f0e0ad4e7`
- `RELAYER_ROLE`: `0x5e17fc5225d4a099df75359ce1f405503ca79498a8dc46a7d583235a0ee45c16`

### Option C: Using Etherscan/Basescan

1. Go to your contract on Basescan
2. Navigate to "Contract" → "Write Contract"
3. Connect wallet (must be ADMIN)
4. Call `addCreator(address)` with backend wallet address
5. Call `addRelayer(address)` with backend wallet address

---

## Step 5: Grant CREATOR_ROLE to Individual Creators

For creators who want to sign their own transactions:

### Using Hardhat Console

```javascript
const TheSeeds = await ethers.getContractAt("TheSeeds", CONTRACT_ADDRESS);

// Add a creator
await TheSeeds.addCreator("0xCREATOR_WALLET_ADDRESS");

// Verify
const CREATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("CREATOR_ROLE"));
const hasRole = await TheSeeds.hasRole(CREATOR_ROLE, "0xCREATOR_WALLET_ADDRESS");
console.log("Has CREATOR_ROLE:", hasRole);
```

### Using API Endpoint

If your backend has ADMIN_ROLE, you could add an admin endpoint:

```typescript
// Future enhancement: Admin endpoint to grant roles
// POST /api/admin/creators
// Body: { address: "0x..." }
```

---

## Role Management Commands Cheat Sheet

### Check if Address Has Role

```bash
# Check CREATOR_ROLE
cast call CONTRACT \
  "hasRole(bytes32,address)(bool)" \
  0x828634d95e775031b9ff576c159e20a8a57946bda7a10f5b0e5f3b5f0e0ad4e7 \
  ADDRESS \
  --rpc-url RPC_URL

# Check RELAYER_ROLE
cast call CONTRACT \
  "hasRole(bytes32,address)(bool)" \
  0x5e17fc5225d4a099df75359ce1f405503ca79498a8dc46a7d583235a0ee45c16 \
  ADDRESS \
  --rpc-url RPC_URL

# Check ADMIN_ROLE
cast call CONTRACT \
  "hasRole(bytes32,address)(bool)" \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  ADDRESS \
  --rpc-url RPC_URL
```

### Grant Roles

```bash
# Grant CREATOR_ROLE
cast send CONTRACT "addCreator(address)" ADDRESS --rpc-url RPC --private-key ADMIN_KEY

# Grant RELAYER_ROLE
cast send CONTRACT "addRelayer(address)" ADDRESS --rpc-url RPC --private-key ADMIN_KEY

# Grant ADMIN_ROLE
cast send CONTRACT "grantRole(bytes32,address)" 0x00...00 ADDRESS --rpc-url RPC --private-key ADMIN_KEY
```

### Revoke Roles

```bash
# Revoke CREATOR_ROLE
cast send CONTRACT "removeCreator(address)" ADDRESS --rpc-url RPC --private-key ADMIN_KEY

# Revoke RELAYER_ROLE
cast send CONTRACT "removeRelayer(address)" ADDRESS --rpc-url RPC --private-key ADMIN_KEY

# Revoke ADMIN_ROLE (careful!)
cast send CONTRACT "revokeRole(bytes32,address)" 0x00...00 ADDRESS --rpc-url RPC --private-key ADMIN_KEY
```

---

## Testing Your Setup

### 1. Test Backend Has Correct Roles

```bash
curl http://localhost:3000/api/seeds/creator/YOUR_BACKEND_ADDRESS/check
```

Expected response:
```json
{
  "success": true,
  "data": {
    "address": "0xYourBackendAddress",
    "hasCreatorRole": true
  }
}
```

### 2. Test Backend Can Create Seeds

```bash
curl -X POST http://localhost:3000/api/seeds \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "X-Admin-Key: your-admin-key" \
  -d '{
    "ipfsHash": "QmTest123",
    "title": "Test Seed",
    "description": "Testing deployment"
  }'
```

Expected: Successful seed creation with transaction hash

### 3. Test Individual Creator

```bash
# Check if they have role
curl http://localhost:3000/api/seeds/creator/0xCREATOR_ADDRESS/check

# They can get transaction to sign
curl -X POST http://localhost:3000/api/seeds/prepare \
  -H "Authorization: Bearer CREATOR_TOKEN" \
  -d '{"ipfsHash": "QmX", "title": "Test"}'
```

---

## Recommended Wallet Setup

### Production Setup

```
Deployer Wallet (Cold Storage)
├── Has: ADMIN_ROLE
├── Purpose: Deploy contract, manage roles
└── Security: Hardware wallet, rarely used

Backend API Wallet (Hot Wallet)
├── Has: CREATOR_ROLE + RELAYER_ROLE
├── Purpose: Create seeds, submit blessings
└── Security: Encrypted in environment, limited funds

Creator Wallets (Individual)
├── Has: CREATOR_ROLE
├── Purpose: Create their own seeds
└── Security: User's personal wallet
```

### Development/Testing Setup

```
Single Wallet (Easier for Testing)
├── Has: ADMIN_ROLE + CREATOR_ROLE + RELAYER_ROLE
├── Purpose: Everything
└── Security: Test funds only
```

---

## Common Issues & Solutions

### ❌ "Relayer does not have CREATOR_ROLE"

**Solution:**
```bash
# Grant role to backend wallet
cast send CONTRACT "addCreator(address)" BACKEND_WALLET --rpc-url RPC --private-key ADMIN_KEY
```

### ❌ "AccessControl: account 0x... is missing role"

**Cause:** Transaction signer doesn't have required role

**Solution:**
1. Check which role is needed (CREATOR for seeds, RELAYER for blessings)
2. Grant the role using admin wallet

### ❌ "Backend blessing service not configured"

**Cause:** `RELAYER_PRIVATE_KEY` not set in `.env.local`

**Solution:**
1. Generate a new wallet or use existing
2. Add `RELAYER_PRIVATE_KEY=0x...` to `.env.local`
3. Grant CREATOR_ROLE and RELAYER_ROLE to that wallet

### ❌ Can't grant roles

**Cause:** You're not using the ADMIN wallet

**Solution:** Use the deployer wallet (the one with ADMIN_ROLE) to grant roles

---

## Security Checklist

- [ ] Deployer wallet private key stored securely (hardware wallet recommended)
- [ ] Backend wallet different from deployer wallet
- [ ] `ADMIN_KEY` is a strong, random secret
- [ ] Private keys never committed to git
- [ ] `.env.local` in `.gitignore`
- [ ] Deployer wallet only used for admin operations
- [ ] Backend wallet has minimal funds (just for gas)
- [ ] Role grants logged and audited
- [ ] Contract verified on Basescan

---

## Quick Reference

### Environment Variables

```bash
# Deployment
PRIVATE_KEY=0x...  # Deployer (becomes ADMIN)

# API Backend
RELAYER_PRIVATE_KEY=0x...  # Backend wallet
CONTRACT_ADDRESS=0x...
NETWORK=baseSepolia
ADMIN_KEY=secret-key

# RPCs
BASE_SEPOLIA_RPC=https://sepolia.base.org
BASE_MAINNET_RPC=https://mainnet.base.org
```

### Deployment Commands

```bash
npm run deployseeds:base-sepolia  # Testnet
npm run deployseeds:base          # Mainnet
```

### Role Hashes

```
ADMIN_ROLE:   0x0000000000000000000000000000000000000000000000000000000000000000
CREATOR_ROLE: 0x828634d95e775031b9ff576c159e20a8a57946bda7a10f5b0e5f3b5f0e0ad4e7
RELAYER_ROLE: 0x5e17fc5225d4a099df75359ce1f405503ca79498a8dc46a7d583235a0ee45c16
```

---

## Next Steps After Deployment

1. ✅ Deploy contract
2. ✅ Grant roles to backend wallet
3. ✅ Test seed creation
4. ✅ Grant roles to individual creators
5. ⏭️ Set up Merkle root for blessings (see FirstWorks snapshot guide)
6. ⏭️ Configure daily snapshot updates
7. ⏭️ Set up monitoring and alerting
8. ⏭️ Verify contract on Basescan

---

## Support

If you encounter issues:
1. Check this guide's "Common Issues" section
2. Verify roles using the check commands
3. Review contract events on Basescan
4. Check API logs for detailed error messages
