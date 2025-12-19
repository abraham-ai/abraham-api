# How to Verify the Fix Works

## Quick Verification Checklist

### ✅ 1. Code Review
The fix changes `getCurrentLeader()` to call `getCurrentLeaders()`:
- **Old**: Called non-existent `getCurrentLeader` function
- **New**: Calls `getCurrentLeaders` and returns first leader

### ✅ 2. Verify ABI is Correct
```bash
# Check that getCurrentLeaders exists in the ABI
grep -A 10 "getCurrentLeaders" lib/abi/TheSeeds.json
```

Expected output should show:
```json
"name": "getCurrentLeaders",
"outputs": [
  {
    "internalType": "uint256[]",
    "name": "leadingSeedIds",
    "type": "uint256[]"
  },
  {
    "internalType": "uint256",
    "name": "score",
    "type": "uint256"
  }
]
```

### ✅ 3. Check Contract Has the Function
```bash
# Verify the contract source has getCurrentLeaders
grep -n "function getCurrentLeaders" contracts/TheSeeds.sol
```

Expected: Line 584 or similar showing the function exists

### ✅ 4. Build and Deploy

```bash
# TypeScript compilation
npm run build

# Deploy to Vercel
git add .
git commit -m "fix: update select-winner API for new Seeds contract"
git push origin main

# Or manual deploy
vercel --prod
```

### ✅ 5. Test the Deployed API

#### Test 1: Check Diagnostics (No Transaction)
```bash
curl -X GET "https://your-api.vercel.app/api/admin/winner-diagnostics" \
  -H "X-Admin-Key: YOUR_ADMIN_KEY" \
  | jq .
```

**Expected Response:**
```json
{
  "success": true,
  "ready": false,
  "diagnostics": {
    "currentRound": 1,
    "seedsInRound": 5,
    "timeRemaining": 3600,
    "currentLeader": {
      "seedId": 123,
      "score": "1414213",
      "blessings": "2"
    }
  }
}
```

If this works, `getCurrentLeader()` is working!

#### Test 2: Select Winner (Creates Transaction)
⚠️ **Only run this when ready to select a winner!**

```bash
curl -X POST "https://your-api.vercel.app/api/admin/select-winner" \
  -H "X-Admin-Key: YOUR_ADMIN_KEY" \
  | jq .
```

**Expected Success Response:**
```json
{
  "success": true,
  "data": {
    "winningSeedId": 123,
    "round": 1,
    "txHash": "0x...",
    "blockExplorer": "https://basescan.org/tx/0x...",
    "seed": {
      "id": 123,
      "creator": "0x...",
      "ipfsHash": "Qm...",
      "blessings": 5,
      "isWinner": true,
      "winnerInRound": 1
    },
    "nft": {
      "tokenId": 1,
      "tokenURI": "ipfs://Qm...",
      "openseaUrl": "https://opensea.io/assets/base/0x.../1",
      "contractAddress": "0x..."
    },
    "message": "Winner selected successfully. New blessing period started."
  }
}
```

#### Test 3: Check Vercel Logs
```bash
vercel logs --prod
```

Look for:
- ✅ No errors about "getCurrentLeader not found"
- ✅ Successful winner selection
- ✅ NFT data logged to console

### ✅ 6. Verify NFT Was Minted

Check on blockchain explorer:
```bash
# Get the contract address from response
CONTRACT_ADDRESS="0xaea1cfd09da8f226a2ff2590d6b748563cf517f0"

# View on BaseScan
open "https://basescan.org/address/${CONTRACT_ADDRESS}#readContract"

# Or Base Sepolia
open "https://sepolia.basescan.org/address/${CONTRACT_ADDRESS}#readContract"
```

Call `getTokenIdBySeedId(winningSeedId)` to verify NFT was minted.

### ✅ 7. Check OpenSea

The API response includes an `openseaUrl`. Visit it to see the minted NFT:
```bash
# From the response
open "https://opensea.io/assets/base/CONTRACT_ADDRESS/TOKEN_ID"
```

## Troubleshooting

### Error: "Function getCurrentLeader not found"
- ❌ Fix not deployed yet
- ❌ Using old cached version
- ✅ Clear browser cache / hard refresh
- ✅ Check you're hitting the prod deployment

### Error: "Voting period not ended"
- ✅ This is expected! Wait for the voting period to end
- ✅ Or check `winner-diagnostics` to see time remaining

### Error: "No valid winner"
- ✅ This means no seeds have blessings with score > 0
- ✅ Check `winner-diagnostics` to see current leader

### NFT Data is Null
- Check if the contract actually minted the NFT
- Call `getTokenIdBySeedId()` directly on the contract
- Verify the seed `isWinner = true`

## Success Indicators

When everything works correctly, you should see:

1. ✅ `/api/admin/winner-diagnostics` returns valid leader info
2. ✅ `/api/admin/select-winner` successfully completes
3. ✅ Response includes `nft` object with tokenId, tokenURI, and OpenSea link
4. ✅ Transaction appears on block explorer
5. ✅ NFT appears in contract on BaseScan
6. ✅ NFT eventually appears on OpenSea (may take a few minutes)
7. ✅ Daily cron job succeeds without errors

## Quick Test Command

Run this one-liner to test if the fix is deployed:

```bash
# Test diagnostics endpoint
curl -s "https://your-api.vercel.app/api/admin/winner-diagnostics" \
  -H "X-Admin-Key: YOUR_KEY" \
  | jq -r '.diagnostics.currentLeader.seedId' && echo "✅ Fix is working!"
```

If you get a seed ID number, the fix is working!
If you get an error, check the logs.
