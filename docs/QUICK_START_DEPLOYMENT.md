# Quick Start: Deploy & Setup TheSeeds

## TL;DR - Complete Setup in 5 Steps

### Step 1️⃣: Deploy Contract

```bash
# In .env.local, add deployer wallet
PRIVATE_KEY=0xYourDeployerWalletPrivateKey

# Deploy to Base Sepolia
npm run deployseeds:base-sepolia
```

**Result:** You get contract address like `0x878baad...`
**You now have:** ADMIN_ROLE on the contract ✅

---

### Step 2️⃣: Configure API Backend

```bash
# In .env.local, add these:
CONTRACT_ADDRESS=0x878baad...              # From step 1
NETWORK=baseSepolia
RELAYER_PRIVATE_KEY=0xDifferentWallet...  # NEW wallet, not deployer!
ADMIN_KEY=supersecretkey123                # Random secret
BASE_SEPOLIA_RPC=https://sepolia.base.org
PRIVY_APP_ID=your-privy-id
PRIVY_APP_SECRET=your-privy-secret
FIRSTWORKS_RPC_URL=https://eth-mainnet...  # For NFT snapshots
```

---

### Step 3️⃣: Grant Roles to Backend

Your backend wallet needs permissions. Using Hardhat console:

```bash
npx hardhat console --network baseSepolia
```

```javascript
const TheSeeds = await ethers.getContractAt("TheSeeds", "0x878baad...");

// Backend wallet from RELAYER_PRIVATE_KEY
const backend = "0xYourBackendWalletAddress";

// Grant both roles
await TheSeeds.addCreator(backend);   // For creating seeds
await TheSeeds.addRelayer(backend);   // For submitting blessings

// Verify
const CREATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("CREATOR_ROLE"));
const RELAYER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("RELAYER_ROLE"));
console.log("Creator:", await TheSeeds.hasRole(CREATOR_ROLE, backend));
console.log("Relayer:", await TheSeeds.hasRole(RELAYER_ROLE, backend));
```

---

### Step 4️⃣: Generate NFT Snapshot

```bash
npm run snapshot:generate
```

This creates a snapshot of FirstWorks NFT owners for blessing eligibility.

---

### Step 5️⃣: Test Everything

```bash
# Start API
npm run dev

# Test backend has creator role
curl http://localhost:3000/api/seeds/creator/YOUR_BACKEND_ADDRESS/check

# Test seed creation
curl -X POST http://localhost:3000/api/seeds \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "X-Admin-Key: supersecretkey123" \
  -d '{
    "ipfsHash": "QmTest123",
    "title": "My First Seed",
    "description": "Testing!"
  }'
```

**Success!** You should get a transaction hash and seed ID.

---

## Visual Flow

```
┌─────────────────────────────────────────────────┐
│  Step 1: Deploy Contract                        │
│  Your wallet → Deploys → TheSeeds Contract      │
│  Result: You = ADMIN                            │
└─────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│  Step 2: Setup Backend Wallet                   │
│  Create new wallet for API backend              │
│  Add RELAYER_PRIVATE_KEY to .env.local          │
└─────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│  Step 3: Grant Roles (Using ADMIN wallet)       │
│  Backend wallet ← CREATOR_ROLE (create seeds)   │
│  Backend wallet ← RELAYER_ROLE (blessings)      │
└─────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│  Step 4: Generate Snapshot                      │
│  Run: npm run snapshot:generate                 │
│  Creates FirstWorks NFT ownership data          │
└─────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│  Step 5: Test API                               │
│  ✅ Backend creates seeds                        │
│  ✅ Users bless seeds                            │
│  ✅ All stored on blockchain                     │
└─────────────────────────────────────────────────┘
```

---

## Understanding the Wallets

### Wallet 1: Deployer (You)
```
Purpose: Deploy contract, manage admin functions
Has: ADMIN_ROLE
Security: 🔐 Cold storage, hardware wallet
Usage: Rarely - only for admin tasks
```

### Wallet 2: Backend API
```
Purpose: Create seeds, submit blessings for users
Has: CREATOR_ROLE + RELAYER_ROLE
Security: 🌐 Hot wallet, encrypted in .env.local
Usage: Constantly - API operations
```

### Wallet 3+: Individual Creators (Optional)
```
Purpose: Creators sign their own seed transactions
Has: CREATOR_ROLE
Security: 👤 User's personal wallet
Usage: When they want to create seeds directly
```

---

## Grant Individual Creators (Optional)

If you want specific wallets to create seeds directly:

```bash
npx hardhat console --network baseSepolia
```

```javascript
const TheSeeds = await ethers.getContractAt("TheSeeds", "0x878baad...");

// Grant creator role to individual
await TheSeeds.addCreator("0xCreatorWalletAddress");
```

They can now use `/api/seeds/prepare` to get transaction data and sign it with their wallet.

---

## Common Commands

### Check if Address Has Roles

```bash
# Using API
curl http://localhost:3000/api/seeds/creator/0xADDRESS/check

# Using cast
cast call CONTRACT \
  "hasRole(bytes32,address)(bool)" \
  0x828634d95e775031b9ff576c159e20a8a57946bda7a10f5b0e5f3b5f0e0ad4e7 \
  ADDRESS \
  --rpc-url https://sepolia.base.org
```

### Grant Roles

```bash
# CREATOR_ROLE
cast send CONTRACT "addCreator(address)" ADDRESS --rpc-url RPC --private-key ADMIN_KEY

# RELAYER_ROLE
cast send CONTRACT "addRelayer(address)" ADDRESS --rpc-url RPC --private-key ADMIN_KEY
```

### Revoke Roles

```bash
cast send CONTRACT "removeCreator(address)" ADDRESS --rpc-url RPC --private-key ADMIN_KEY
cast send CONTRACT "removeRelayer(address)" ADDRESS --rpc-url RPC --private-key ADMIN_KEY
```

---

## Environment Variables Summary

```bash
# Deployment (only for initial deploy)
PRIVATE_KEY=0x...                    # Deployer wallet

# API Backend (always needed)
RELAYER_PRIVATE_KEY=0x...            # Backend wallet
CONTRACT_ADDRESS=0x878baad...        # From deployment
NETWORK=baseSepolia                  # or "base"
ADMIN_KEY=secret123                  # Random secret
BASE_SEPOLIA_RPC=https://...         # Base RPC
FIRSTWORKS_RPC_URL=https://...       # Ethereum RPC
PRIVY_APP_ID=...                     # Privy config
PRIVY_APP_SECRET=...                 # Privy config
```

---

## Troubleshooting

### ❌ "Relayer does not have CREATOR_ROLE"
→ Run Step 3 again to grant roles

### ❌ "Backend blessing service not configured"
→ Add `RELAYER_PRIVATE_KEY` to `.env.local`

### ❌ "Unauthorized - Invalid admin key"
→ Check `X-Admin-Key` header matches `ADMIN_KEY` in env

### ❌ Can't grant roles
→ Use the deployer wallet (has ADMIN_ROLE)

---

## Security Checklist

- [ ] Deployer private key in cold storage (hardware wallet)
- [ ] Backend wallet different from deployer
- [ ] `ADMIN_KEY` is random and strong
- [ ] `.env.local` in `.gitignore`
- [ ] Never commit private keys
- [ ] Contract verified on Basescan
- [ ] Backend wallet has minimal funds (just for gas)

---

## What's Next?

1. ✅ Deploy & configure (done!)
2. 📝 Update Merkle root for NFT verification
3. 🔄 Set up daily snapshot cron job
4. 🎨 Grant CREATOR_ROLE to artists
5. 🚀 Launch!

---

## Full Documentation

- [Complete Deployment Guide](./DEPLOYMENT_GUIDE.md)
- [Seed Creation System](./SEED_CREATION_SYSTEM.md)
- [Blessing System](./BLESSING_SYSTEM.md)
- [API Reference](../README.md)

---

## Need Help?

1. Check the [Deployment Guide](./DEPLOYMENT_GUIDE.md) for detailed steps
2. Review contract events on Basescan
3. Check API logs for errors
4. Verify roles using the check commands above
