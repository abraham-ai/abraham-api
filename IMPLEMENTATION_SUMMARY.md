# Abraham Auto-Elevation Implementation Summary

Complete implementation summary for the conditional auto-elevation feature connecting TheSeeds (Base) with AbrahamCovenant (Ethereum).

---

## ✅ What's Been Implemented

### 1. **Conditional Auto-Elevation Endpoint**

**Location**: [src/routes/admin.ts:296-564](src/routes/admin.ts#L296-L564)

The `/api/admin/select-winner` endpoint now supports conditional auto-elevation via query parameter:

- **Default behavior** (`/api/admin/select-winner`): Selects winner only, returns `nextStep` instruction
- **Auto-elevation** (`/api/admin/select-winner?autoElevate=true`): Selects winner AND elevates to Abraham creation in one call

**Key Features:**
- Backward compatible - works without parameter
- Graceful degradation if Abraham service not configured
- Detailed error handling with retry instructions
- Complete transaction information in response

### 2. **Abraham Service**

**Location**: [src/services/abrahamService.ts](src/services/abrahamService.ts)

Service layer for interacting with AbrahamCovenant and AbrahamAuction contracts on Ethereum Sepolia.

**Key Methods:**
- `commitDailyWork(ipfsHash)` - Mints Abraham creation NFT
- `createDailyAuction(tokenId, duration, minBid)` - Creates auction
- `elevateSeedToCreation(winningSeed, round)` - Complete flow: mint + auction
- `isConfigured()` - Checks if service is ready

**Configuration Requirements:**
- `ABRAHAM_COVENANT_ADDRESS` - Covenant contract address
- `ABRAHAM_AUCTION_ADDRESS` - Auction contract address
- `PRIVATE_KEY` - Wallet with Sepolia ETH for gas
- `SEPOLIA_RPC_URL` - RPC endpoint (recommend Alchemy/Infura)

### 3. **Deployment Infrastructure**

**Location**: [deploy/deploy_abraham.ts](deploy/deploy_abraham.ts)

Automated deployment script that:
1. Deploys AbrahamCovenant to Sepolia
2. Deploys AbrahamAuction to Sepolia
3. Sets up permissions (covenant approves auction)
4. Starts the covenant
5. Saves ABIs to `lib/abi/` folder
6. Generates deployment info

**Usage:**
```bash
npm run deploy:abraham:sepolia
```

### 4. **Deployed Contracts (Sepolia)**

**Current Deployment** (2025-12-06T22:51:26.928Z):

| Contract | Address | Explorer |
|----------|---------|----------|
| AbrahamCovenant | [`0x5bd79b4bb138e39a42168e9d60e308c86f9dcf15`](https://sepolia.etherscan.io/address/0x5bd79b4bb138e39a42168e9d60e308c86f9dcf15) | Etherscan |
| AbrahamAuction | [`0xb0eb83b00f0f9673ebdfb0933d37646b3315b179`](https://sepolia.etherscan.io/address/0xb0eb83b00f0f9673ebdfb0933d37646b3315b179) | Etherscan |

**Configuration:**
- Max Supply: 4,745 NFTs (13 years × 365 days)
- Work Cycle: 6 days work, 1 day rest
- Auction Duration: 1 day (24 hours)
- Minimum Bid: 0.01 ETH

### 5. **Automated Cron Jobs**

**Location**: [vercel.json:18-27](vercel.json#L18-L27)

Vercel cron configuration:
```json
{
  "crons": [
    {
      "path": "/api/admin/update-snapshot",
      "schedule": "0 0 * * *"
    },
    {
      "path": "/api/admin/select-winner?autoElevate=true",
      "schedule": "0 0 * * *"
    }
  ]
}
```

**Daily Operations:**
- Midnight UTC: Update FirstWorks snapshot
- Midnight UTC: Select daily winner + auto-elevate to Abraham creation

### 6. **Documentation**

**Created Files:**
- [AUTO_ELEVATION_GUIDE.md](AUTO_ELEVATION_GUIDE.md) - Complete testing guide
- [DEPLOYMENT.md](DEPLOYMENT.md) - Deployment and architecture guide
- [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) - This file

**Updated Files:**
- [.env.example](.env.example) - Added Abraham contract addresses and PRIVATE_KEY
- [vercel.json](vercel.json) - Enabled auto-elevation in cron job

---

## 🏗️ Architecture

### Cross-Chain Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    ABRAHAM ECOSYSTEM                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  BASE MAINNET (L2)               ETHEREUM SEPOLIA (L1)          │
│  ┌─────────────────┐             ┌────────────────────┐         │
│  │   TheSeeds      │             │  AbrahamCovenant   │         │
│  │   Contract      │             │  0x5bd79b4b...     │         │
│  └────────┬────────┘             └─────────┬──────────┘         │
│           │                                 │                    │
│           │ 1. Seeds submitted              │ 3. Winner minted   │
│           │ 2. Users bless seeds            │    as NFT          │
│           │ 3. Winner selected (24h)        │                    │
│           │                                 │                    │
│           │                     ┌───────────▼──────────┐         │
│           │                     │  AbrahamAuction      │         │
│           │                     │  0xb0eb83b0...       │         │
│           │                     └──────────────────────┘         │
│           │                              │                       │
│           │                              │ 4. Daily auction      │
│           │                              │    (24 hours)         │
│           │                              │                       │
└───────────┼──────────────────────────────┼───────────────────────┘
            │                              │
            │                              │
       ┌────▼──────────────────────────────▼────┐
       │      Backend API (abraham-api)         │
       │                                         │
       │  POST /admin/select-winner             │
       │  ├─ Default: Manual elevation          │
       │  └─ ?autoElevate=true: Automated       │
       │                                         │
       │  POST /admin/elevate-seed              │
       │  └─ Manual elevation only              │
       └─────────────────────────────────────────┘
```

### Data Flow

1. **Seed Curation (Base)**
   - Users submit seeds with IPFS hash
   - Community blesses seeds over 24 hours
   - Blessings weighted by: `sqrt(blessings per user) × time_decay`

2. **Winner Selection (Base → Backend)**
   - Cron job calls `/api/admin/select-winner?autoElevate=true`
   - Backend calls `selectDailyWinner()` on TheSeeds contract
   - Winner determined by blessing algorithm
   - New 24-hour blessing period starts

3. **Elevation (Backend → Sepolia)**
   - If `autoElevate=true`, automatically proceeds
   - Backend calls `commitDailyWork(ipfsHash)` on AbrahamCovenant
   - NFT minted to covenant contract
   - Transaction confirmed on Sepolia

4. **Auction Creation (Sepolia)**
   - Backend calls `createAuction(tokenId)` on AbrahamAuction
   - 24-hour auction created with 0.01 ETH minimum bid
   - Auction starts immediately

---

## 🔧 Configuration Checklist

To enable the full auto-elevation flow:

### Required Environment Variables

Add to `.env.local`:

```bash
# Abraham Contracts (already deployed)
ABRAHAM_COVENANT_ADDRESS=0x5bd79b4bb138e39a42168e9d60e308c86f9dcf15
ABRAHAM_AUCTION_ADDRESS=0xb0eb83b00f0f9673ebdfb0933d37646b3315b179

# Private key (same as deployer, needs Sepolia ETH)
PRIVATE_KEY=0x...

# Sepolia RPC (use Alchemy/Infura for reliability)
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# Admin authentication
ADMIN_KEY=your_secret_admin_key

# Cron authentication (for Vercel)
CRON_SECRET=your_cron_secret
```

### Verification

**Check Abraham Service Initialization:**
```bash
npm run dev
```

**Expected Output:**
```
✅ Abraham service initialized
   Abraham: 0x641f5ffC5F6239A0873Bd00F9975091FB035aAFC
   Covenant: 0x5bd79b4bb138e39a42168e9d60e308c86f9dcf15
   Auction: 0xb0eb83b00f0f9673ebdfb0933d37646b3315b179
🌐 Network: Sepolia
```

**If not showing, check:**
1. Are contract addresses in `.env.local`?
2. Is `PRIVATE_KEY` in `.env.local`?
3. Are ABIs in `lib/abi/` folder?

---

## 🧪 Testing

### Manual Testing (Recommended First)

**Test 1: Manual Flow**
```bash
# Step 1: Select winner only
curl -X POST "http://localhost:3000/api/admin/select-winner" \
  -H "X-Admin-Key: your_admin_key"

# Step 2: Review winner, then elevate
curl -X POST "http://localhost:3000/api/admin/elevate-seed?seedId=0" \
  -H "X-Admin-Key: your_admin_key"
```

**Test 2: Auto-Elevation**
```bash
# Single call - winner selection + elevation
curl -X POST "http://localhost:3000/api/admin/select-winner?autoElevate=true" \
  -H "X-Admin-Key: your_admin_key"
```

### Automated Testing (Production)

Vercel cron job automatically runs daily at midnight UTC:
- Selects winner on TheSeeds (Base)
- Elevates to Abraham creation (Sepolia)
- Creates 24-hour auction

**Monitor:**
- Vercel deployment logs
- Sepolia Etherscan for transactions
- Error notifications (if enabled)

---

## 📊 API Endpoints

### POST /api/admin/select-winner

**Query Parameters:**
- `autoElevate` (optional): Set to `true` for auto-elevation

**Headers:**
- `X-Admin-Key`: Admin authentication key

**Response (without autoElevate):**
```json
{
  "success": true,
  "data": {
    "winningSeedId": 0,
    "round": 1,
    "seed": {...},
    "nextStep": "To elevate to Abraham creation, call: POST /admin/elevate-seed?seedId=0"
  }
}
```

**Response (with autoElevate=true):**
```json
{
  "success": true,
  "data": {
    "winningSeedId": 0,
    "round": 1,
    "seed": {...},
    "abraham": {
      "tokenId": 0,
      "auctionId": 13,
      "mintTxHash": "0x...",
      "auctionTxHash": "0x...",
      "mintExplorer": "https://sepolia.etherscan.io/tx/0x...",
      "auctionExplorer": "https://sepolia.etherscan.io/tx/0x..."
    },
    "message": "Winner selected and auto-elevated to Abraham creation. Daily auction started."
  }
}
```

### POST /api/admin/elevate-seed

**Query Parameters:**
- `seedId` (required): ID of winning seed to elevate

**Headers:**
- `X-Admin-Key`: Admin authentication key

**Response:**
```json
{
  "success": true,
  "data": {
    "seedId": 0,
    "seed": {...},
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

---

## 🚨 Common Issues

### Issue 1: "Abraham service not configured"

**Cause**: Missing environment variables or ABIs

**Fix:**
1. Add contract addresses to `.env.local`
2. Add `PRIVATE_KEY` to `.env.local`
3. Ensure ABIs exist in `lib/abi/` folder
4. Restart server

### Issue 2: "Already committed work today"

**Cause**: Abraham can only mint one creation per day

**Fix:** Wait until next day (UTC) to mint again

### Issue 3: "Blessing period not ended"

**Cause**: Trying to select winner before 24 hours

**Fix:** Wait for blessing period to end (24 hours from last winner)

### Issue 4: Transaction timeout

**Cause**: Public RPC endpoint too slow

**Fix:** Use Alchemy or Infura RPC:
```bash
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY
```

---

## 📈 Next Steps

### For Testing
1. ✅ Contracts deployed to Sepolia
2. ✅ Auto-elevation implemented
3. ✅ Cron jobs configured
4. ⏳ Add environment variables to `.env.local`
5. ⏳ Test manual flow
6. ⏳ Test auto-elevation flow
7. ⏳ Deploy to Vercel

### For Production
1. Deploy contracts to Ethereum mainnet
2. Deploy TheSeeds to Base mainnet
3. Update environment variables
4. Enable Vercel cron jobs
5. Monitor daily operations
6. Set up error notifications

---

## 🔗 Resources

- **Contracts**: [lib/abi/deployment-info.json](lib/abi/deployment-info.json)
- **Testing Guide**: [AUTO_ELEVATION_GUIDE.md](AUTO_ELEVATION_GUIDE.md)
- **Deployment Guide**: [DEPLOYMENT.md](DEPLOYMENT.md)
- **Sepolia Etherscan**: https://sepolia.etherscan.io/
- **Base Sepolia**: https://sepolia.basescan.org/
- **Alchemy**: https://www.alchemy.com/
- **Infura**: https://www.infura.io/

---

**Last Updated**: 2025-12-07

**Implementation Status**: ✅ Complete and ready for testing
