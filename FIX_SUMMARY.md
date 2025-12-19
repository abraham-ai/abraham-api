# Select Winner API Fix Summary

## Problem
The `/api/admin/select-winner` endpoint was failing with the error:
```
AbiFunctionNotFoundError: Function "getCurrentLeader" not found on ABI
```

## Root Cause
The Seeds contract was updated to use `getCurrentLeaders()` (plural) which returns an array of leading seed IDs, but the `contractService.ts` was still trying to call `getCurrentLeader()` (singular) which doesn't exist on the contract.

## Changes Made

### 1. Fixed contractService.ts (Lines 262-277)
**File**: [src/services/contractService.ts](src/services/contractService.ts#L262-L277)

Updated `getCurrentLeader()` to call the correct contract function:

```typescript
async getCurrentLeader(): Promise<{ leadingSeedId: bigint; score: bigint }> {
  const result = await this.publicClient.readContract({
    address: this.contractAddress,
    abi: SEEDS_ABI,
    functionName: "getCurrentLeaders",  // Changed from "getCurrentLeader"
    args: [],
  });

  const [leadingSeedIds, score] = result as [bigint[], bigint];
  // Return the first leader, or 0 if no leaders
  const leadingSeedId = leadingSeedIds.length > 0 ? leadingSeedIds[0] : 0n;
  return { leadingSeedId, score };
}
```

### 2. Added NFT Information to Select Winner Response
**File**: [src/routes/admin.ts](src/routes/admin.ts#L391-L433)

The API now retrieves and returns NFT information for the winning seed:

```typescript
// Get NFT information for the winning seed
const tokenId = await contractService.getTokenIdBySeedId(winningSeedId);
const tokenURI = await contractService.tokenURI(Number(tokenId));
const openseaUrl = `https://opensea.io/assets/${chain}/${contractAddress}/${tokenId}`;

nftData = {
  tokenId: Number(tokenId),
  tokenURI,
  openseaUrl,
  contractAddress
};
```

### 3. Updated API Response Structure
All select-winner responses now include:
```json
{
  "success": true,
  "data": {
    "winningSeedId": 123,
    "round": 5,
    "txHash": "0x...",
    "blockExplorer": "https://...",
    "seed": { ... },
    "nft": {
      "tokenId": 42,
      "tokenURI": "ipfs://...",
      "openseaUrl": "https://opensea.io/assets/...",
      "contractAddress": "0x..."
    },
    "abraham": { ... }  // if autoElevate=true
  }
}
```

### 4. Fixed test-blessing-score.ts
**File**: [scripts/test-blessing-score.ts](scripts/test-blessing-score.ts#L232-L246)

Updated to use the correct contract function name.

## Contract Functions (for reference)

The Seeds contract has these functions:
- ✅ `getCurrentLeaders()` - Returns array of leading seed IDs and their score (EXISTS)
- ❌ `getCurrentLeader()` - Does not exist on the contract

## How to Verify the Fix

### Option 1: Call the API Endpoint Directly

```bash
# Make sure environment is set up
export ADMIN_KEY=your_admin_key

# Call the endpoint
curl -X POST "https://your-api.vercel.app/api/admin/select-winner" \
  -H "X-Admin-Key: $ADMIN_KEY"

# Or with auto-elevation
curl -X POST "https://your-api.vercel.app/api/admin/select-winner?autoElevate=true" \
  -H "X-Admin-Key: $ADMIN_KEY"
```

### Option 2: Check Diagnostics Endpoint

```bash
curl -X GET "https://your-api.vercel.app/api/admin/winner-diagnostics" \
  -H "X-Admin-Key: $ADMIN_KEY"
```

This endpoint also uses `getCurrentLeader()` internally and should now work correctly.

### Option 3: Let the Cron Job Run

The cron job configured in `vercel.json` will run daily:
```json
{
  "path": "/api/admin/select-winner?autoElevate=true",
  "schedule": "0 0 * * *"
}
```

Check the Vercel logs after the next scheduled run.

## Expected Behavior

### Before Fix
- ❌ API returns 500 error
- ❌ Error: `Function "getCurrentLeader" not found on ABI`
- ❌ Winner selection fails

### After Fix
- ✅ API successfully selects winner
- ✅ NFT is minted on The Seeds contract
- ✅ Response includes NFT data (tokenId, tokenURI, OpenSea link)
- ✅ If autoElevate=true, seed is elevated to Abraham creation
- ✅ New blessing period starts

## Files Modified

1. `/src/services/contractService.ts` - Fixed `getCurrentLeader()` to call correct contract function
2. `/src/routes/admin.ts` - Added NFT data retrieval and updated responses
3. `/scripts/test-blessing-score.ts` - Fixed contract function call
4. `/scripts/testGetCurrentLeader.ts` - Created test script (optional)

## Deployment

To deploy the fix:

```bash
# Commit changes
git add .
git commit -m "fix: update select-winner API to match new Seeds contract"

# Push to deploy (assuming Vercel auto-deploys)
git push origin main
```

Or deploy manually:
```bash
vercel --prod
```

## Notes

- The fix maintains backward compatibility - existing code calling `getCurrentLeader()` on the service will still work
- The contract's `getCurrentLeaders()` returns an array to handle tie scenarios, but we use the first leader for diagnostics
- NFT data is retrieved after winner selection and included in all response paths
