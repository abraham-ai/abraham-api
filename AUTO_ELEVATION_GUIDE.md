# Auto-Elevation Testing Guide

Complete guide for testing the conditional auto-elevation feature connecting TheSeeds (Base) to AbrahamCovenant (Sepolia).

---

## 📋 Current Deployment

### Deployed Contracts (Sepolia)

- **AbrahamCovenant**: [`0x5bd79b4bb138e39a42168e9d60e308c86f9dcf15`](https://sepolia.etherscan.io/address/0x5bd79b4bb138e39a42168e9d60e308c86f9dcf15)
- **AbrahamAuction**: [`0xb0eb83b00f0f9673ebdfb0933d37646b3315b179`](https://sepolia.etherscan.io/address/0xb0eb83b00f0f9673ebdfb0933d37646b3315b179)
- **Deployed**: 2025-12-06T22:51:26.928Z
- **Network**: Ethereum Sepolia

### Environment Configuration

Ensure your `.env.local` contains:

```bash
# Abraham Contracts (Sepolia)
ABRAHAM_COVENANT_ADDRESS=0x5bd79b4bb138e39a42168e9d60e308c86f9dcf15
ABRAHAM_AUCTION_ADDRESS=0xb0eb83b00f0f9673ebdfb0933d37646b3315b179

# Sepolia RPC (use Alchemy/Infura for better performance)
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# Admin authentication
ADMIN_KEY=your_secret_admin_key_here

# Private key for Abraham operations
PRIVATE_KEY=0x...
```

---

## 🎯 Auto-Elevation Feature

The new conditional auto-elevation feature allows you to:

1. **Manual Flow**: Select winner, review, then manually elevate
2. **Automated Flow**: Select winner and auto-elevate in one call

### Option 1: Manual Flow (Default)

**Step 1: Select Winner**
```bash
curl -X POST "http://localhost:3000/api/admin/select-winner" \
  -H "X-Admin-Key: your_admin_key_here"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "winningSeedId": 0,
    "round": 1,
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

**Step 2: Review & Elevate**
```bash
curl -X POST "http://localhost:3000/api/admin/elevate-seed?seedId=0" \
  -H "X-Admin-Key: your_admin_key_here"
```

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

### Option 2: Automated Flow (Auto-Elevate)

**Single Call - Winner Selection + Elevation**
```bash
curl -X POST "http://localhost:3000/api/admin/select-winner?autoElevate=true" \
  -H "X-Admin-Key: your_admin_key_here"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "winningSeedId": 0,
    "round": 1,
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
    "message": "Winner selected and auto-elevated to Abraham creation. Daily auction started."
  }
}
```

---

## 🔄 Automation Setup

### Vercel Cron Jobs

Update your `vercel.json` to enable auto-elevation:

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

**Key Points:**
- Adding `?autoElevate=true` enables full automation
- Without the parameter, manual elevation is required
- Cron job authenticates via `CRON_SECRET` (set in Vercel environment)

### Manual Trigger (for testing)

```bash
# Test auto-elevation manually
curl -X POST "http://localhost:3000/api/admin/select-winner?autoElevate=true" \
  -H "X-Admin-Key: your_admin_key_here"
```

---

## 🧪 Complete Test Flow

### Prerequisites

1. **Seeds Created**: Have at least one seed submitted on TheSeeds (Base)
2. **Blessings**: Users have blessed seeds
3. **Time Elapsed**: At least 24 hours since blessing period started
4. **Sepolia ETH**: Abraham account has Sepolia ETH for gas

### Test Steps

**1. Check Current Round**
```bash
curl "http://localhost:3000/api/seeds/current-round"
```

**2. View Seeds**
```bash
curl "http://localhost:3000/api/seeds/seed/0"
```

**3. Select Winner (Manual)**
```bash
curl -X POST "http://localhost:3000/api/admin/select-winner" \
  -H "X-Admin-Key: your_admin_key_here"
```

**4. Elevate Winner**
```bash
curl -X POST "http://localhost:3000/api/admin/elevate-seed?seedId=0" \
  -H "X-Admin-Key: your_admin_key_here"
```

**OR**

**3. Select Winner + Auto-Elevate (Automated)**
```bash
curl -X POST "http://localhost:3000/api/admin/select-winner?autoElevate=true" \
  -H "X-Admin-Key: your_admin_key_here"
```

**5. Verify on Etherscan**
- Visit the `mintExplorer` URL to see the NFT mint transaction
- Visit the `auctionExplorer` URL to see the auction creation
- Check covenant contract: [0x5bd79b4bb138e39a42168e9d60e308c86f9dcf15](https://sepolia.etherscan.io/address/0x5bd79b4bb138e39a42168e9d60e308c86f9dcf15)
- Check auction contract: [0xb0eb83b00f0f9673ebdfb0933d37646b3315b179](https://sepolia.etherscan.io/address/0xb0eb83b00f0f9673ebdfb0933d37646b3315b179)

---

## 📊 Architecture Flow

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
│           │ 2. Users bless seeds            │    as NFT (daily)  │
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
       │  Endpoints:                             │
       │  • POST /admin/select-winner           │
       │    - Default: manual elevation         │
       │    - ?autoElevate=true: automated      │
       │                                         │
       │  • POST /admin/elevate-seed            │
       │    - Manual elevation only             │
       └─────────────────────────────────────────┘
```

---

## 🔧 Troubleshooting

### "Abraham service not configured"

**Problem**: API returns warning about Abraham service.

**Check:**
1. `.env.local` has `ABRAHAM_COVENANT_ADDRESS` and `ABRAHAM_AUCTION_ADDRESS`
2. `.env.local` has `PRIVATE_KEY` with Sepolia ETH
3. ABIs exist in `lib/abi/abrahamCovenant.ts` and `lib/abi/abrahamAuction.ts`
4. Restart server: `npm run dev`

### "Already committed work today"

**Problem**: Can't mint multiple creations in same day.

**Solution**: Abraham can only commit daily work once per day. Wait until next day (UTC).

### "Winner selected but elevation failed"

**Problem**: Auto-elevation failed after winner selection.

**Solution**:
1. Winner is still recorded on Base
2. Use manual elevation endpoint: `POST /admin/elevate-seed?seedId=X`
3. Check error message for specific issue (gas, approval, etc.)

### "Blessing period not ended"

**Problem**: Trying to select winner before 24 hours.

**Solution**: Wait for blessing period to end (24 hours from last winner selection).

---

## 📝 Daily Operations Checklist

- [ ] Seeds submitted throughout the day
- [ ] Users blessing seeds
- [ ] 24 hours elapsed since last winner
- [ ] Cron job runs (or manual trigger)
- [ ] Winner selected on Base
- [ ] Abraham creation minted on Sepolia (if auto-elevate enabled)
- [ ] Daily auction started (24 hours, 0.01 ETH min bid)
- [ ] Verify transactions on Etherscan
- [ ] Monitor auction bids (optional)
- [ ] Auction settles after 24 hours (automatic)

---

## 🎨 Benefits of Conditional Auto-Elevation

### Manual Mode (default)
- **Review before minting**: Check winner validity
- **Gas control**: Mint only when needed
- **Error recovery**: Retry elevation separately if it fails

### Auto Mode (`?autoElevate=true`)
- **Full automation**: No manual intervention needed
- **Daily consistency**: Guaranteed daily creation if winner exists
- **Cron-friendly**: Single endpoint for complete flow
- **Graceful degradation**: If elevation fails, winner is still recorded

---

## 🔗 Useful Links

- **Sepolia Etherscan**: https://sepolia.etherscan.io/
- **Base Sepolia Explorer**: https://sepolia.basescan.org/
- **Covenant Contract**: https://sepolia.etherscan.io/address/0x5bd79b4bb138e39a42168e9d60e308c86f9dcf15
- **Auction Contract**: https://sepolia.etherscan.io/address/0xb0eb83b00f0f9673ebdfb0933d37646b3315b179
- **DEPLOYMENT.md**: Full deployment guide
- **Sepolia Faucet**: https://sepoliafaucet.com/

---

**Last Updated**: 2025-12-07
