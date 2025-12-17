# Automated Seed Elevation System - Setup Summary

## ✅ System Status: FULLY CONFIGURED

The automated seed elevation system is **fully implemented and configured**. This document provides a complete overview of the system architecture, endpoints, and testing procedures.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTOMATED DAILY FLOW                         │
│                   Runs at 00:00 UTC Daily                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  VERCEL CRON JOB                                                │
│  POST /api/admin/select-winner?autoElevate=true                 │
│  Auth: Bearer <CRON_SECRET>                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│  STEP 1: Base Sepolia   │   │  STEP 2: Eth Sepolia    │
│                         │   │                         │
│  TheSeeds Contract      │   │  AbrahamCovenant        │
│  .selectDailyWinner()   │   │  .commitDailyWork()     │
│                         │   │                         │
│  - Calculate scores     │   │  AbrahamAuction         │
│  - Select winner        │   │  .createAuction()       │
│  - Mark as winner       │   │                         │
│  - Increment round      │   │  - Mint NFT             │
│  - Start new period     │   │  - Create 24h auction   │
└─────────────────────────┘   └─────────────────────────┘
```

---

## 📋 Configuration Files

### 1. Cron Job Configuration
**File:** [vercel.json](vercel.json)

```json
{
  "crons": [
    {
      "path": "/api/admin/select-winner?autoElevate=true",
      "schedule": "0 0 * * *"
    }
  ]
}
```

**Schedule:** Daily at 00:00 UTC (midnight)
**Authentication:** Uses `CRON_SECRET` environment variable

### 2. Environment Variables Required

```bash
# Base Sepolia (TheSeeds)
L2_SEEDS_CONTRACT=0x6b4086d8713477737294968fe397d308664a755a
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/...
NETWORK=baseSepolia

# Ethereum Sepolia (Abraham)
ABRAHAM_COVENANT_ADDRESS=0x5bd79b4bb138e39a42168e9d60e308c86f9dcf15
ABRAHAM_AUCTION_ADDRESS=0xb0eb83b00f0f9673ebdfb0933d37646b3315b179
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/...

# Private Keys
PRIVATE_KEY=<your-private-key>

# Authentication
ADMIN_KEY=father-abraham
CRON_SECRET=<your-cron-secret>
```

---

## 🔌 API Endpoints

### 1. Automated Winner Selection & Elevation
**Endpoint:** `POST /api/admin/select-winner?autoElevate=true`

**Description:** Complete automated flow - selects winner, mints creation, starts auction

**Authentication:**
- Cron: `Authorization: Bearer <CRON_SECRET>`
- Manual: `X-Admin-Key: <ADMIN_KEY>`

**Response:**
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
      "ipfsHash": "ipfs://Qm...",
      "blessings": 2
    },
    "abraham": {
      "tokenId": 0,
      "auctionId": 13,
      "mintTxHash": "0x...",
      "auctionTxHash": "0x...",
      "mintExplorer": "https://sepolia.etherscan.io/tx/0x...",
      "auctionExplorer": "https://sepolia.etherscan.io/tx/0x..."
    },
    "timestamp": "2025-12-09T13:29:24.000Z",
    "message": "Winner selected and auto-elevated to Abraham creation. Daily auction started."
  }
}
```

**Implementation:** [src/routes/admin.ts:339-589](src/routes/admin.ts#L339-L589)

---

### 2. Manual Winner Selection (No Elevation)
**Endpoint:** `POST /api/admin/select-winner`

**Description:** Only selects winner on Base, doesn't elevate to Abraham

**Authentication:** `X-Admin-Key: <ADMIN_KEY>`

**Response:**
```json
{
  "success": true,
  "data": {
    "winningSeedId": 0,
    "round": 1,
    "seed": {...},
    "message": "Winner selected successfully. New blessing period started.",
    "nextStep": "To elevate to Abraham creation, call: POST /admin/elevate-seed?seedId=0"
  }
}
```

---

### 3. Manual Seed Elevation
**Endpoint:** `POST /api/admin/elevate-seed?seedId={id}`

**Description:** Manually elevate a winning seed to Abraham creation

**Authentication:** `X-Admin-Key: <ADMIN_KEY>`

**Query Parameters:**
- `seedId`: The ID of the winning seed to elevate (required)

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
    "timestamp": "2025-12-09T13:29:24.000Z",
    "message": "Seed elevated to Abraham creation successfully. Daily auction started."
  }
}
```

**Implementation:** [src/routes/admin.ts:777-927](src/routes/admin.ts#L777-L927)

---

### 4. Winner Readiness Diagnostics
**Endpoint:** `GET /api/admin/winner-diagnostics`

**Description:** Check if system is ready for winner selection

**Authentication:** `X-Admin-Key: <ADMIN_KEY>`

**Response:**
```json
{
  "success": true,
  "ready": true,
  "diagnostics": {
    "currentRound": 1,
    "seedsInRound": 5,
    "timeRemaining": 0,
    "votingPeriodEnded": true,
    "currentLeader": {
      "seedId": 0,
      "score": "1414213562",
      "blessings": "2"
    },
    "eligibleSeeds": 3,
    "allSeedScores": [...]
  }
}
```

---

### 5. Create Auction (Fallback)
**Endpoint:** `POST /api/admin/create-auction?tokenId={id}`

**Description:** Create auction for already-minted token (recovery endpoint)

**Authentication:** `X-Admin-Key: <ADMIN_KEY>`

**Query Parameters:**
- `tokenId`: Token ID to auction (required)
- `durationInDays`: Auction duration in days (optional, default: 1)
- `minBidInEth`: Minimum bid in ETH (optional, default: 0.01)

**Use Case:** When token was minted but auction creation failed

---

## 🧪 Testing & Verification

### Test Scripts

#### 1. Test Complete Automated Flow (API)
```bash
npx tsx scripts/testElevationFlowApi.ts
```

**What it does:**
- Checks winner diagnostics
- Calls `/api/admin/select-winner?autoElevate=true`
- Verifies complete flow execution
- Displays all transaction details

**File:** [scripts/testElevationFlowApi.ts](scripts/testElevationFlowApi.ts)

---

#### 2. Test Elevation Flow (Direct Contract Calls)
```bash
npx tsx scripts/testElevationFlow.ts
```

**What it does:**
- Selects winner directly via contract
- Elevates winner via abrahamService
- Creates auction
- Verifies auction is active

**File:** [scripts/testElevationFlow.ts](scripts/testElevationFlow.ts)

---

### Diagnostic Scripts

#### Check Winner Readiness
```bash
curl -H "X-Admin-Key: father-abraham" \
  http://localhost:3000/api/admin/winner-diagnostics
```

#### Check Voting State
```bash
npx tsx scripts/checkVotingState.ts
```

#### Check Abraham Creations
```bash
npx tsx scripts/checkAbrahamCreations.ts
```

#### Check Auction Status
```bash
npx tsx scripts/checkAuction.ts <tokenId>
```

#### Find Winning Seeds
```bash
npx tsx scripts/findWinningSeeds.ts
```

---

## 🔄 Service Layer

### AbrahamService
**File:** [src/services/abrahamService.ts](src/services/abrahamService.ts)

**Key Methods:**

#### `elevateSeedToCreation(seed, round)`
**Lines:** [446-560](src/services/abrahamService.ts#L446-L560)

Combines minting + auction creation into single operation:
1. Calls `commitDailyWork(ipfsHash)` → mints NFT
2. Calls `createDailyAuction(tokenId)` → starts auction
3. Returns complete result with both transaction hashes

#### `commitDailyWork(ipfsHash)`
**Lines:** [210-335](src/services/abrahamService.ts#L210-L335)

Mints Abraham creation NFT on Sepolia covenant

#### `createDailyAuction(tokenId, duration, minBid)`
**Lines:** [343-437](src/services/abrahamService.ts#L343-L437)

Creates 24-hour auction for minted token

---

## 🚨 Error Handling & Recovery

### Common Issues & Solutions

#### 1. Voting Period Not Ended
**Error:** `"Voting period not ended (12345s remaining)"`
**Solution:** Wait until 24 hours have passed since last winner selection

#### 2. No Seeds in Round
**Error:** `"No valid winner - no seeds in round"`
**Solution:** Create seeds for current round before attempting selection

#### 3. Empty IPFS Hash
**Error:** `"Seed has no IPFS hash - cannot elevate"`
**Solution:** Ensure winning seed has valid IPFS hash before elevation

#### 4. Already Committed Today
**Error:** `"Already committed work today"`
**Solution:** Wait until next UTC day (resets at 00:00 UTC)

#### 5. Partial Success (Mint OK, Auction Failed)
**Error:** `"Minted successfully but failed to create auction"`
**Solution:** Use recovery endpoint:
```bash
curl -X POST -H "X-Admin-Key: father-abraham" \
  "http://localhost:3000/api/admin/create-auction?tokenId=<tokenId>"
```

---

## 📊 Daily Workflow

### Expected Daily Sequence (00:00 UTC)

```
1. Vercel cron triggers
   └─> POST /api/admin/select-winner?autoElevate=true

2. System checks:
   ✓ Voting period ended (24 hours)
   ✓ Seeds exist in current round
   ✓ At least one seed has blessings
   ✓ No previous winner in this round

3. Select winner on Base Sepolia:
   └─> TheSeeds.selectDailyWinner()
       - Calculate sqrt(blessings) × time_decay
       - Mark winner
       - Increment round
       - Start new 24h period

4. Elevate to Ethereum Sepolia:
   └─> AbrahamCovenant.commitDailyWork(ipfsHash)
       - Mint NFT to covenant
       - Store metadata
   └─> AbrahamAuction.createAuction(tokenId)
       - Create 24h auction
       - Set min bid 0.01 ETH
       - Start immediately

5. Success Response:
   └─> Return complete transaction details
       - Winner selection tx (Base)
       - Mint tx (Sepolia)
       - Auction tx (Sepolia)
```

---

## 🔒 Security & Constraints

### Authentication
- **Cron jobs:** `Authorization: Bearer <CRON_SECRET>`
- **Manual calls:** `X-Admin-Key: <ADMIN_KEY>`

### Daily Limit
- ⚠️ **Only 1 creation can be minted per UTC day**
- Enforced by `AbrahamCovenant.hasCommittedToday()`
- Resets at 00:00 UTC

### Validation
- ✅ IPFS hash must not be empty
- ✅ Seed must be marked as winner
- ✅ Voting period must have ended
- ✅ At least one eligible seed must exist

---

## 📦 Dependencies

### Contracts
- **TheSeeds:** `0x6b4086d8713477737294968fe397d308664a755a` (Base Sepolia)
- **AbrahamCovenant:** `0x5bd79b4bb138e39a42168e9d60e308c86f9dcf15` (Eth Sepolia)
- **AbrahamAuction:** `0xb0eb83b00f0f9673ebdfb0933d37646b3315b179` (Eth Sepolia)

### Services
- **contractService:** Handles Base Sepolia interactions
- **abrahamService:** Handles Eth Sepolia interactions

---

## 🎯 Testing Checklist

Before deploying to production, verify:

- [ ] Cron job configured in vercel.json
- [ ] All environment variables set in Vercel
- [ ] CRON_SECRET configured and secure
- [ ] Wallet has sufficient ETH on both networks
- [ ] Contracts deployed and addresses correct
- [ ] Test endpoint with manual trigger
- [ ] Verify auction creation works
- [ ] Check diagnostics endpoint responds
- [ ] Monitor first automated execution
- [ ] Verify Vercel logs capture output

---

## 📚 Additional Documentation

- **Automated Flow Guide:** [AUTOMATED_FLOW.md](AUTOMATED_FLOW.md)
- **Elevation Guide:** [ELEVATION_GUIDE.md](ELEVATION_GUIDE.md)
- **Deployment Guide:** [DEPLOYMENT.md](DEPLOYMENT.md)

---

## ✅ System Ready

The automated seed elevation system is **fully configured and operational**. The daily cron job will automatically:

1. ✅ Select winning seed from Base Sepolia
2. ✅ Mint Abraham creation on Ethereum Sepolia
3. ✅ Start 24-hour auction immediately
4. ✅ Log all transactions and results

**No manual intervention required!** 🤖
