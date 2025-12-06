# Abraham Contracts Deployment & Testing Guide

Complete guide for deploying AbrahamCovenant and AbrahamAuction contracts to Ethereum Sepolia and testing the full end-to-end flow from seed curation to daily auctions.

---

## 📋 Prerequisites

### 1. Environment Setup

Copy `.env.example` to `.env.local` and fill in the required values:

```bash
cp .env.example .env.local
```

### 2. Required Environment Variables

```bash
# Private key for deployment and operations (same key for testing)
PRIVATE_KEY=0x...

# Ethereum Sepolia RPC URL (get from Alchemy or Infura)
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# Etherscan API key (for contract verification)
ETHERSCAN_API_KEY=your_etherscan_api_key

# Admin authentication
ADMIN_KEY=your_secret_admin_key_here

# Optional: CRON_SECRET for automated daily winner selection
CRON_SECRET=your_cron_secret_here
```

### 3. Get Testnet ETH

You'll need Sepolia ETH for deployment and testing:
- **Alchemy Faucet**: https://sepoliafaucet.com/
- **Infura Faucet**: https://www.infura.io/faucet/sepolia
- **QuickNode Faucet**: https://faucet.quicknode.com/ethereum/sepolia

---

## 🚀 Step-by-Step Deployment

### Step 1: Compile Contracts

```bash
npm run compile
```

This compiles all Solidity contracts and generates artifacts.

### Step 2: Deploy Abraham Contracts to Sepolia

```bash
npm run deploy:abraham:sepolia
```

**What this does:**
1. Deploys `AbrahamCovenant` NFT contract
2. Deploys `AbrahamAuction` contract
3. Configures permissions (covenant approves auction)
4. Starts the covenant (begins 7-day grace period)
5. Saves ABIs to `lib/abi/` folder
6. Generates deployment info

**Expected output:**
```
=== Abraham Contracts Deployment to Sepolia ===

1️⃣  Deploying AbrahamCovenant...
   ✅ AbrahamCovenant deployed at: 0x...

2️⃣  Deploying AbrahamAuction...
   ✅ AbrahamAuction deployed at: 0x...

3️⃣  Setting up permissions...
   ✅ Sales mechanic set
   ✅ Operator approval granted

4️⃣  Starting the covenant...
   ✅ Covenant started

📝 Add these to your .env.local file:
ABRAHAM_COVENANT_ADDRESS=0x...
ABRAHAM_AUCTION_ADDRESS=0x...
```

### Step 3: Update Environment Variables

Add the deployed contract addresses to your `.env.local`:

```bash
ABRAHAM_COVENANT_ADDRESS=0x...  # From deployment output
ABRAHAM_AUCTION_ADDRESS=0x...   # From deployment output
```

### Step 4: Restart the Server

```bash
npm run dev
```

The server will automatically load the Abraham service with the new contract addresses.

---

## ✅ Verification (Optional but Recommended)

Verify contracts on Etherscan:

```bash
# Verify AbrahamCovenant
npx hardhat verify --network sepolia <COVENANT_ADDRESS> \
  "Abraham Covenant" "ABRAHAM" <DEPLOYER_ADDRESS> <DEPLOYER_ADDRESS> 4745 6

# Verify AbrahamAuction
npx hardhat verify --network sepolia <AUCTION_ADDRESS> \
  <COVENANT_ADDRESS> <DEPLOYER_ADDRESS> <DEPLOYER_ADDRESS>
```

---

## 🧪 Testing the Complete Flow

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    ABRAHAM ECOSYSTEM                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  BASE MAINNET (L2)               ETHEREUM SEPOLIA (L1)          │
│  ┌─────────────────┐             ┌────────────────────┐         │
│  │   TheSeeds      │             │  AbrahamCovenant   │         │
│  │   Contract      │             │     Contract       │         │
│  └────────┬────────┘             └─────────┬──────────┘         │
│           │                                 │                    │
│           │ 1. Seeds submitted              │ 3. Winner minted   │
│           │ 2. Users bless seeds            │    as NFT          │
│           │ 3. Winner selected              │                    │
│           │                                 │                    │
│           │                     ┌───────────▼──────────┐         │
│           │                     │  AbrahamAuction      │         │
│           │                     │     Contract         │         │
│           │                     └──────────────────────┘         │
│           │                              │                       │
│           │                              │ 4. Daily auction      │
│           │                              │    starts             │
│           │                              │                       │
└───────────┼──────────────────────────────┼───────────────────────┘
            │                              │
            │                              │
       ┌────▼──────────────────────────────▼────┐
       │      Backend API (abraham-api)         │
       │                                         │
       │  Endpoints:                             │
       │  • POST /api/admin/select-winner       │
       │  • POST /api/admin/elevate-seed        │
       └─────────────────────────────────────────┘
```

### Test Flow

#### 1. **Create and Bless Seeds** (on Base Sepolia)

> This part uses your existing TheSeeds contract deployment. Make sure you have:
> - Seeds created
> - Users blessing those seeds
> - At least 24 hours elapsed since voting period started

You can use your existing endpoints or scripts for this.

#### 2. **Select Daily Winner** (Base Sepolia)

After 24 hours, call the winner selection endpoint:

```bash
curl -X POST "http://localhost:3000/api/admin/select-winner" \
  -H "X-Admin-Key: your_admin_key_here"
```

**Expected response:**
```json
{
  "success": true,
  "data": {
    "winningSeedId": 0,
    "round": 1,
    "txHash": "0x...",
    "blockExplorer": "https://sepolia.basescan.org/tx/0x...",
    "seed": {
      "id": 0,
      "creator": "0x...",
      "ipfsHash": "Qm...",
      "blessings": 42,
      "isWinner": true,
      "winnerInRound": 1
    },
    "message": "Winner selected successfully. New blessing period started.",
    "nextStep": "To elevate to Abraham creation, call: POST /admin/elevate-seed?seedId=0"
  }
}
```

#### 3. **Elevate Winner to Abraham Creation** (Ethereum Sepolia)

Now mint the winning seed as an Abraham creation NFT and start a daily auction:

```bash
curl -X POST "http://localhost:3000/api/admin/elevate-seed?seedId=0" \
  -H "X-Admin-Key: your_admin_key_here"
```

**Expected response:**
```json
{
  "success": true,
  "data": {
    "seedId": 0,
    "seed": {
      "id": 0,
      "creator": "0x...",
      "ipfsHash": "Qm...",
      "blessings": 42,
      "isWinner": true,
      "winnerInRound": 1
    },
    "abraham": {
      "tokenId": 0,
      "auctionId": 13,
      "mintTxHash": "0x...",
      "auctionTxHash": "0x...",
      "mintExplorer": "https://sepolia.etherscan.io/tx/0x...",
      "auctionExplorer": "https://sepolia.etherscan.io/tx/0x..."
    },
    "message": "Seed elevated to Abraham creation successfully. Daily auction started."
  }
}
```

#### 4. **Verify on Etherscan**

Visit the block explorer links to see:
- **Mint Transaction**: Abraham creation NFT minted to covenant contract
- **Auction Transaction**: Daily auction created (24-hour duration, 0.01 ETH minimum bid)

View the contracts:
- **Covenant**: `https://sepolia.etherscan.io/address/<COVENANT_ADDRESS>`
- **Auction**: `https://sepolia.etherscan.io/address/<AUCTION_ADDRESS>`

#### 5. **Test Bidding** (Optional)

Use a different wallet to test bidding on the auction:

```javascript
import { createWalletClient, http, parseEther } from 'viem';
import { sepolia } from 'viem/chains';
import { ABRAHAM_AUCTION_ABI } from './lib/abi/abrahamAuction.js';

const auctionAddress = '0x...'; // Your auction contract address
const auctionId = 13; // From elevation response

// Place a bid
const tx = await walletClient.writeContract({
  address: auctionAddress,
  abi: ABRAHAM_AUCTION_ABI,
  functionName: 'bid',
  args: [BigInt(auctionId)],
  value: parseEther('0.02'), // Must be >= minimum bid
});
```

---

## 🔄 Daily Automation (Production)

### Cron Jobs (Vercel)

The `vercel.json` already configures daily cron jobs:

```json
{
  "crons": [
    {
      "path": "/api/admin/update-snapshot",
      "schedule": "0 0 * * *"  // Daily at midnight
    },
    {
      "path": "/api/admin/select-winner",
      "schedule": "0 0 * * *"  // Daily at midnight
    }
  ]
}
```

### Manual Trigger for Elevation

Since winner selection and elevation are separated, you have two options:

**Option A: Manual elevation after winner selection**
1. Cron calls `/api/admin/select-winner` daily
2. You manually call `/api/admin/elevate-seed?seedId=X` to mint and auction

**Option B: Automated elevation (recommended)**

Create a script that:
1. Calls `/api/admin/select-winner`
2. Parses the response to get `winningSeedId`
3. Immediately calls `/api/admin/elevate-seed?seedId=<winningSeedId>`

Example script:

```typescript
// scripts/dailyWinnerFlow.ts
async function runDailyWinnerFlow() {
  const adminKey = process.env.ADMIN_KEY;
  const apiUrl = process.env.API_URL || 'http://localhost:3000';

  // Step 1: Select winner
  const winnerResponse = await fetch(`${apiUrl}/api/admin/select-winner`, {
    method: 'POST',
    headers: { 'X-Admin-Key': adminKey },
  });

  const winnerData = await winnerResponse.json();

  if (!winnerData.success) {
    console.error('Winner selection failed:', winnerData.error);
    return;
  }

  const winningSeedId = winnerData.data.winningSeedId;
  console.log(`Winner selected: Seed ${winningSeedId}`);

  // Step 2: Elevate to Abraham creation
  const elevateResponse = await fetch(
    `${apiUrl}/api/admin/elevate-seed?seedId=${winningSeedId}`,
    {
      method: 'POST',
      headers: { 'X-Admin-Key': adminKey },
    }
  );

  const elevateData = await elevateResponse.json();

  if (!elevateData.success) {
    console.error('Elevation failed:', elevateData.error);
    return;
  }

  console.log('✅ Complete flow successful!');
  console.log(`   Abraham NFT: Token ${elevateData.data.abraham.tokenId}`);
  console.log(`   Auction: ID ${elevateData.data.abraham.auctionId}`);
}

runDailyWinnerFlow().catch(console.error);
```

Add to `package.json`:

```json
{
  "scripts": {
    "daily-flow": "tsx scripts/dailyWinnerFlow.ts"
  }
}
```

---

## 🎯 Testing Checklist

- [ ] Contracts deployed to Sepolia
- [ ] Environment variables updated
- [ ] Server restarted and loads Abraham service
- [ ] Winner selected on TheSeeds (Base)
- [ ] Winner elevated to Abraham creation (Sepolia)
- [ ] NFT minted to covenant contract
- [ ] Daily auction created (24 hours, 0.01 ETH min bid)
- [ ] Transactions visible on Etherscan
- [ ] Auction accepts bids (optional)
- [ ] Auction settles after 24 hours (optional)

---

## 🔧 Troubleshooting

### "Abraham service not configured"

**Problem**: API returns warning that Abraham service isn't configured.

**Solution**:
1. Check `.env.local` has `ABRAHAM_COVENANT_ADDRESS` and `ABRAHAM_AUCTION_ADDRESS`
2. Restart the server
3. Verify ABIs exist in `lib/abi/abrahamCovenant.ts` and `lib/abi/abrahamAuction.ts`

### "Already committed work today"

**Problem**: Can't mint multiple creations in the same day.

**Solution**: Abraham can only commit daily work once per day. Wait until the next day or use a future-dated test.

### "Approval missing"

**Problem**: Auction contract can't transfer NFTs.

**Solution**: The deployment script should handle this, but you can manually fix:

```bash
# Using cast (Foundry)
cast send <COVENANT_ADDRESS> \
  "setMechanicOperator(bool)" true \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY
```

### "Insufficient funds"

**Problem**: Not enough Sepolia ETH for gas.

**Solution**: Get more testnet ETH from faucets (see Prerequisites).

---

## 📊 Contract Addresses Reference

After deployment, keep track of your addresses:

| Contract | Network | Address |
|----------|---------|---------|
| TheSeeds | Base Sepolia | `0x...` |
| AbrahamCovenant | Ethereum Sepolia | `0x...` |
| AbrahamAuction | Ethereum Sepolia | `0x...` |

---

## 🎨 Next Steps

1. **Test the full flow** multiple times to ensure stability
2. **Monitor gas costs** for daily operations
3. **Set up monitoring** for failed transactions
4. **Configure automated elevation** script for production
5. **Deploy to mainnet** when ready (Base + Ethereum)

---

## 📚 Additional Resources

- [AbrahamCovenant Contract](./contracts/AbrahamCovenant.sol)
- [AbrahamAuction Contract](./contracts/AbrahamAuction.sol)
- [TheSeeds Contract](./contracts/TheSeeds.sol)
- [Sepolia Etherscan](https://sepolia.etherscan.io/)
- [Base Sepolia Explorer](https://sepolia.basescan.org/)

---

**Questions?** Check the code comments or create an issue in the repository.
