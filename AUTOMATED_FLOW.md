# Automated Daily Winner Selection & Elevation

## 🤖 Overview

The system automatically selects a daily winner from TheSeeds (Base Sepolia), elevates it to an Abraham Creation (Ethereum Sepolia), and starts a 24-hour auction — all without manual intervention.

---

## ⏰ Cron Job Configuration

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

**Authentication:** Uses `CRON_SECRET` environment variable (Bearer token)

---

## 🔄 Complete Automated Flow

```
╔════════════════════════════════════════════════════════════════╗
║  DAILY AUTOMATED EXECUTION (00:00 UTC)                         ║
╚════════════════════════════════════════════════════════════════╝
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 1. VERCEL CRON JOB TRIGGERS                                  │
│    POST /api/admin/select-winner?autoElevate=true           │
│    Auth: Bearer <CRON_SECRET>                               │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. PRE-FLIGHT CHECKS                                         │
│    ✓ Voting period ended? (24 hours passed)                │
│    ✓ Seeds exist in current round?                         │
│    ✓ At least one seed has blessings?                      │
│    ✓ No previous winner in this round?                     │
└──────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │  All checks pass? │
                    └─────────┬─────────┘
                              │
              ┌───────────────┴───────────────┐
              │ NO                            │ YES
              ▼                               ▼
       ┌─────────────┐              ┌─────────────────┐
       │ Return 400  │              │ Proceed to      │
       │ with error  │              │ winner selection│
       └─────────────┘              └─────────┬───────┘
                                              │
                                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. SELECT WINNER (Base Sepolia)                             │
│    Contract: TheSeeds.selectDailyWinner()                   │
│    - Calculates sqrt(per-user blessings) × time_decay      │
│    - Selects seed with highest score                       │
│    - Marks seed.isWinner = true                           │
│    - Sets seed.winnerInRound = currentRound               │
│    - Increments round number                              │
│    - Emits WinnerSelected event                           │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. FETCH WINNER DATA                                         │
│    - Get seed details from TheSeeds contract               │
│    - Extract: id, ipfsHash, creator, blessings            │
│    - Validate: ipfsHash is not empty ⚠️ CRITICAL          │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 5. ELEVATE TO ABRAHAM CREATION (Ethereum Sepolia)           │
│                                                              │
│    STEP 1/2: MINT CREATION                                  │
│    Contract: AbrahamCovenant.commitDailyWork(ipfsHash)     │
│    - Validates ipfsHash not empty                          │
│    - Checks not already committed today                    │
│    - Stores: _tokenURIs[tokenId] = ipfsHash               │
│    - Mints: _safeMint(covenantAddress, tokenId)          │
│    - Emits: NFTMinted(tokenId, covenant)                  │
│                                                              │
│    STEP 2/2: CREATE AUCTION                                 │
│    Contract: AbrahamAuction.createAuction()                │
│    - Token: newly minted tokenId                           │
│    - Duration: 86400 seconds (24 hours)                    │
│    - Start: block.timestamp (immediate)                    │
│    - Min Bid: 0.01 ETH                                     │
│    - Emits: AuctionCreated(auctionId, tokenId)            │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 6. RESPONSE & LOGGING                                        │
│    ✅ Winner ID, Round, IPFS Hash                          │
│    ✅ Token ID, Auction ID                                 │
│    ✅ Transaction hashes (Base + Sepolia)                  │
│    ✅ Etherscan explorer links                             │
│    📊 All logged to Vercel logs for monitoring             │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
╔════════════════════════════════════════════════════════════════╗
║  AUCTION NOW LIVE - 24 HOURS                                   ║
║  Users can bid on Sepolia via AbrahamAuction contract         ║
╚════════════════════════════════════════════════════════════════╝
```

---

## 📝 Detailed Step-by-Step Execution

### **Step 1: Cron Trigger**

```http
POST /api/admin/select-winner?autoElevate=true
Authorization: Bearer <CRON_SECRET>
```

**Endpoint:** [admin.ts:339-577](src/routes/admin.ts#L339-L577)

**Authentication:**
- Vercel sends `Authorization: Bearer <CRON_SECRET>`
- Middleware checks `CRON_SECRET` environment variable
- Falls back to `X-Admin-Key` for manual triggers

### **Step 2: Winner Selection (Base Sepolia)**

**Contract:** TheSeeds @ `0x6b4086d8713477737294968fe397d308664a755a`

**Function:** `selectDailyWinner()`

**Algorithm:**
1. Check voting period ended (24 hours)
2. Find all seeds in current round
3. Calculate blessing score for each:
   ```
   score = Σ sqrt(blessings_per_user) × time_decay_factor
   ```
4. Select seed with highest score
5. Mark as winner, increment round

**Service:** [contractService.ts:672-832](src/services/contractService.ts#L672-L832)

**Diagnostics:** Available at `/api/admin/winner-diagnostics`

### **Step 3: Data Validation**

**Critical Checks:**
```typescript
// 1. Seed exists
const seed = await contractService.getSeed(winningSeedId);

// 2. Has IPFS hash (CRITICAL!)
if (!seed.ipfsHash || seed.ipfsHash.trim() === "") {
  throw new Error("No IPFS hash - cannot elevate");
}

// 3. Abraham service configured
if (!abrahamService.isConfigured()) {
  throw new Error("Abraham service not configured");
}
```

**Validation:** [admin.ts:452-470](src/routes/admin.ts#L452-L470)

### **Step 4: Mint Abraham Creation (Ethereum Sepolia)**

**Contract:** AbrahamCovenant @ `0x5bd79b4bb138e39a42168e9d60e308c86f9dcf15`

**Function:** `commitDailyWork(string ipfsHash)`

**Process:**
1. Verify not already committed today
2. Calculate current day number
3. Store metadata: `_tokenURIs[tokenId] = ipfsHash`
4. Mint to covenant: `_safeMint(address(this), tokenId)`
5. Update daily work tracking
6. Emit `NFTMinted(tokenId, covenantAddress)`

**Service:** [abrahamService.ts:209-303](src/services/abrahamService.ts#L209-L303)

**Logging:**
```
📍 STEP 1/2: Minting Abraham creation on Sepolia...
   IPFS Hash being committed: "ipfs://Qm..."
✅ MINTING SUCCESS
   Token ID: 0
   Tx Hash: 0x...
   Explorer: https://sepolia.etherscan.io/tx/0x...
```

### **Step 5: Create Auction (Ethereum Sepolia)**

**Contract:** AbrahamAuction @ `0xb0eb83b00f0f9673ebdfb0933d37646b3315b179`

**Function:** `createAuction(tokenId, startTime, duration, minBid)`

**Parameters:**
- `tokenId`: from Step 4
- `startTime`: 0 (immediate)
- `duration`: 86400 (24 hours)
- `minBid`: 10000000000000000 (0.01 ETH)

**Process:**
1. Verify covenant owns token
2. Verify covenant approved auction contract
3. Create auction struct
4. Link tokenId → auctionId
5. Emit `AuctionCreated(auctionId, tokenId, ...)`

**Service:** [abrahamService.ts:306-392](src/services/abrahamService.ts#L306-L392)

**Logging:**
```
📍 STEP 2/2: Creating daily auction...
   Token ID: 0
   Duration: 1 day
   Min Bid: 0.01 ETH
✅ AUCTION CREATION SUCCESS
   Auction ID: 13
   Tx Hash: 0x...
   Explorer: https://sepolia.etherscan.io/tx/0x...
```

### **Step 6: Success Response**

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
      "creator": "0x641f...",
      "ipfsHash": "ipfs://QmTiAN3G6xvgnE6hEgUMbs8T2zCZzuwEm1zPvvn4iQgKNa",
      "blessings": 2,
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
    "timestamp": "2025-12-09T13:29:24.000Z",
    "message": "Winner selected and auto-elevated to Abraham creation. Daily auction started."
  }
}
```

---

## 🚨 Error Handling

### **No Seeds in Round**
```json
{
  "success": false,
  "error": "No valid winner - no seeds in round or all have blessing score of 0",
  "diagnostics": { ... }
}
```
**Status:** 400

### **Voting Period Not Ended**
```json
{
  "success": false,
  "error": "Voting period not ended (12345s remaining)"
}
```
**Status:** 400

### **Empty IPFS Hash**
```json
{
  "success": false,
  "error": "Seed 0 has no IPFS hash - cannot elevate to Abraham creation"
}
```
**Status:** 400

### **Already Committed Today**
```json
{
  "success": false,
  "error": "Winner selected but elevation failed: Already committed work today",
  "step": "elevation",
  "nextStep": "Retry elevation with: POST /admin/elevate-seed?seedId=0"
}
```
**Status:** 500

### **Partial Success (Mint OK, Auction Failed)**
```json
{
  "success": false,
  "error": "Minted successfully but failed to create auction: ...",
  "data": {
    "tokenId": 0,
    "mintTxHash": "0x...",
    "nextStep": "Use POST /api/admin/create-auction?tokenId=0"
  }
}
```
**Status:** 500

**Recovery:** Use `/api/admin/create-auction?tokenId=0`

---

## 🔒 Security & Constraints

### **Authentication**
- Cron jobs: `Authorization: Bearer <CRON_SECRET>`
- Manual calls: `X-Admin-Key: <ADMIN_KEY>`

### **Daily Limit**
- ⚠️ **Only 1 creation can be minted per UTC day**
- Enforced by `AbrahamCovenant.hasCommittedToday()`
- Resets at 00:00 UTC

### **Validation**
- ✅ IPFS hash must not be empty
- ✅ Seed must be marked as winner
- ✅ Voting period must have ended
- ✅ At least one eligible seed must exist

### **Gas Management**
- Uses `PRIVATE_KEY` wallet for transactions
- Ensure sufficient ETH on both:
  - Base Sepolia (winner selection)
  - Ethereum Sepolia (minting + auction)

---

## 📊 Monitoring

### **Vercel Logs**
View automated execution logs at:
`https://vercel.com/[your-project]/deployments`

**Search for:**
```
🌟 ELEVATION STARTED
✅ MINTING SUCCESS
✅ AUCTION CREATION SUCCESS
🎉 ELEVATION COMPLETE
```

### **Manual Test**
```bash
curl -X POST -H "X-Admin-Key: father-abraham" \
  "http://localhost:3000/api/admin/select-winner?autoElevate=true"
```

### **Check Current State**
```bash
# Winner readiness
curl -H "X-Admin-Key: father-abraham" \
  http://localhost:3000/api/admin/winner-diagnostics

# Abraham status
npx tsx scripts/checkAbrahamCreations.ts

# Find winning seeds
npx tsx scripts/findWinningSeeds.ts
```

---

## 🛠️ Troubleshooting

### **Cron doesn't trigger**
1. Check Vercel cron configuration
2. Verify `CRON_SECRET` is set in Vercel env vars
3. Check deployment logs for errors

### **Winner selection fails**
1. Run diagnostics: `GET /api/admin/winner-diagnostics`
2. Verify seeds exist in current round
3. Check voting period has ended
4. Ensure at least one seed has blessings

### **Minting fails**
1. Check already committed today: `npx tsx scripts/checkAbrahamCreations.ts`
2. Verify IPFS hash is not empty
3. Check wallet has enough ETH on Sepolia
4. Review contract owner/permissions

### **Auction creation fails**
1. Verify token was minted successfully
2. Check covenant approved auction contract
3. Manually create auction: `POST /api/admin/create-auction?tokenId=X`

---

## ✅ Success Indicators

### **In Logs**
```
======================================================================
🌟 ELEVATION STARTED - 2025-12-10T00:00:15.000Z
======================================================================
   Seed ID: 5
   Round: 3
   IPFS Hash: ipfs://QmXYZ...
   Creator: 0xABC...
   Blessings: 42

📍 STEP 1/2: Minting Abraham creation on Sepolia...
   IPFS Hash being committed: "ipfs://QmXYZ..."
✅ MINTING SUCCESS
   Token ID: 2
   Tx Hash: 0xDEF...

📍 STEP 2/2: Creating daily auction...
   Token ID: 2
   Duration: 1 day
   Min Bid: 0.01 ETH
✅ AUCTION CREATION SUCCESS
   Auction ID: 15
   Tx Hash: 0xGHI...

======================================================================
🎉 ELEVATION COMPLETE - 2025-12-10T00:00:45.000Z
======================================================================
   ✅ Winner Selected: Seed ID 5 (Round 3)
   ✅ Creation Minted: Token ID 2
   ✅ Auction Created: Auction ID 15
======================================================================
```

### **On-Chain**
1. **TheSeeds (Base Sepolia):**
   - Seed marked `isWinner = true`
   - Round incremented
   - New 24-hour period started

2. **AbrahamCovenant (Sepolia):**
   - New token minted
   - Metadata stored in `_tokenURIs`
   - Owner: Covenant contract

3. **AbrahamAuction (Sepolia):**
   - New auction created
   - Status: Active
   - Duration: 24 hours

---

## 🎯 Expected Daily Outcome

**Every day at 00:00 UTC:**
1. ✅ Winner selected from previous day's seeds
2. ✅ Creation minted on Ethereum Sepolia
3. ✅ 24-hour auction starts immediately
4. ✅ Users can bid throughout the day
5. ✅ Next day: New winner selected, new auction starts

**The system runs automatically without manual intervention!** 🤖
