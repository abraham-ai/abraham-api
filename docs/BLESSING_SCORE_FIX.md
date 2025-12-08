# Blessing Score Calculation Fix

## Issue

**Date Identified:** 2025-12-08
**Severity:** Critical
**Status:** Fixed

### Problem Description

The contract's blessing score calculation was truncating to 0 due to integer division, causing `NoValidWinner()` errors even when seeds had blessings.

### Root Cause

In the original implementation ([TheSeeds.sol:456](../contracts/TheSeeds.sol#L456)):

```solidity
uint256 previousScore = previousCount > 0 ? sqrt(previousCount) : 0;
uint256 newScore = sqrt(newCount);
uint256 scoreDelta = ((newScore - previousScore) * blessingDecayFactor) / 1000;
```

**The Math:**
- Single blessing: `sqrt(1) = 1`
- Minimum decay (final hour): `10` (1%)
- Score delta: `(1 × 10) / 1000 = 0` ❌

Due to Solidity's integer division, the result truncates to 0. A user needed **≥100 blessings per seed** (with minimum decay) to get a score > 0.

### Impact

- Seeds with blessings could have a score of 0
- Winner selection would fail with `NoValidWinner()` error
- Community voting was blocked despite active participation

### The Fix

Scale the sqrt values by 1000 before applying decay:

```solidity
uint256 previousScore = previousCount > 0 ? sqrt(previousCount) * 1000 : 0;
uint256 newScore = sqrt(newCount) * 1000;
uint256 scoreDelta = ((newScore - previousScore) * blessingDecayFactor) / 1000;
```

**New Math:**
- Single blessing: `sqrt(1) × 1000 = 1000`
- Minimum decay: `10` (1%)
- Score delta: `(1000 × 10) / 1000 = 10` ✅

### Score Scaling Examples

| Blessings per User | sqrt | Old Score (1% decay) | New Score (1% decay) |
|-------------------|------|---------------------|---------------------|
| 1 | 1 | 0 ❌ | 10 ✅ |
| 4 | 2 | 0 ❌ | 20 ✅ |
| 9 | 3 | 0 ❌ | 30 ✅ |
| 16 | 4 | 0 ❌ | 40 ✅ |
| 100 | 10 | 0 ❌ | 100 ✅ |
| 10,000 | 100 | 1 ✅ | 1,000 ✅ |

**With 100% decay (early blessings):**
- Old: `(1 × 1000) / 1000 = 1` ✅
- New: `(1000 × 1000) / 1000 = 1000` ✅ (1000x more precision)

### Changes Made

1. **Contract:** [TheSeeds.sol](../contracts/TheSeeds.sol#L453-L454)
   - Scale sqrt values by 1000
   - Updated comments to document the fix

2. **API Diagnostics:** Added helper functions to debug score issues
   - `getTimeUntilPeriodEnd()` - Check voting period status
   - `getCurrentLeader()` - Get leading seed and score
   - `getSeedBlessingScore(seedId)` - Get individual seed scores
   - `/admin/winner-diagnostics` - Full diagnostic endpoint

3. **Pre-flight Checks:** Added validation before winner selection
   - Check if seeds exist in current round
   - Verify voting period has ended
   - Confirm eligible seeds with scores > 0

### Migration Notes

⚠️ **Breaking Change:** Existing scores will be incompatible with new scoring scale.

**For existing deployments:**
1. Complete current voting round with old contract
2. Select winner and start new round
3. Deploy updated contract
4. Update contract address in API configuration

**For new deployments:**
- Use the updated contract directly
- No migration needed

### Testing

To verify the fix works:

```bash
# 1. Compile the contract
npm run compile

# 2. Run diagnostics on your deployment
curl -H "X-Admin-Key: YOUR_KEY" \
  https://your-api.vercel.app/admin/winner-diagnostics

# 3. Check blessing scores
# scores should now be > 0 even with single blessings
```

### Verification

Expected behavior after fix:
- ✅ Single blessing results in score of 10 (minimum decay)
- ✅ Winner selection succeeds when seeds have any blessings
- ✅ Score increases proportionally to sqrt(blessings) × 1000
- ✅ Time decay properly weights early blessings

### Related Files

- Contract: [`contracts/TheSeeds.sol`](../contracts/TheSeeds.sol)
- Service: [`src/services/contractService.ts`](../src/services/contractService.ts)
- Admin API: [`src/routes/admin.ts`](../src/routes/admin.ts)
- Tests: [`test/TheSeeds.test.ts`](../test/TheSeeds.test.ts)

### References

- Issue: Winner selection failing with `NoValidWinner()` despite blessings
- Contract function: `_blessSeed()` and `selectDailyWinner()`
- Error code: `NoValidWinner()` revert
