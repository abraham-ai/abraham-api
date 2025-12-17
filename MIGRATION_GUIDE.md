# TheSeeds Contract v1.1.0 - Migration Guide

## Overview

This guide details the migration from TheSeeds v1.0.0 to v1.1.0, which includes **critical security fixes** and important feature enhancements.

---

## 🚨 CRITICAL SECURITY FIXES

### 1. **Duplicate Token ID Attack Prevention**

**Issue:** Users could submit duplicate token IDs to multiply their voting power.

**Fix:** Added duplicate detection in `_verifyOwnership()` function.

**Impact:**
- ✅ **No API changes** - existing blessing functions work the same
- ✅ **No migration required** - fix is backward compatible
- ⚠️ **Behavior change:** Blessings with duplicate token IDs will now revert with `InvalidMerkleProof`

**Action Required:**
- **Frontend/Backend:** Ensure token ID arrays are deduplicated before submission
- **Testing:** Verify your Merkle proof generation doesn't include duplicates

---

### 2. **Score Calculation Precision Improvement**

**Issue:** Integer precision loss in sqrt calculation caused unfair scoring for small blessing counts.

**Fix:** Scale values BEFORE sqrt using `SCORE_SCALE_FACTOR = 1e6`

**Impact:**
- ✅ **No API changes**
- ⚠️ **Score values changed:** All scores are now ~1000x larger (due to scaling)
- ⚠️ **Historical comparison:** Old scores vs new scores are not directly comparable

**Action Required:**
- **Analytics/UI:** Update score display logic (scores are now in different magnitude)
- **Database:** Consider storing `version` field with each score for historical comparison
- **Recommendation:** Don't compare scores across contract versions

---

### 3. **Retracted Seeds Semantic Fix**

**Issue:** Retracted seeds were marked as `isWinner = true`, causing confusion.

**Fix:** Added separate `isRetracted` boolean field in Seed struct.

**Impact:**
- ⚠️ **Breaking Change:** Seed struct has new field
- ⚠️ **Storage layout changed:** Contract is NOT upgradeable without migration

**Migration Steps:**

```solidity
// OLD Seed struct
struct Seed {
    uint256 id;
    address creator;
    string ipfsHash;
    uint256 blessings;
    uint256 createdAt;
    bool isWinner;
    uint256 winnerInRound;
    uint256 submittedInRound;
}

// NEW Seed struct
struct Seed {
    uint256 id;
    address creator;
    string ipfsHash;
    uint256 blessings;
    uint256 createdAt;
    bool isWinner;
    bool isRetracted;        // NEW FIELD
    uint256 winnerInRound;
    uint256 submittedInRound;
}
```

**Action Required:**
- **Deployment:** Deploy as NEW contract (not upgrade)
- **Data Migration:** If preserving state, write migration script to:
  1. Read all seeds from old contract
  2. Identify seeds where `isWinner = true` but NOT actual winners
  3. Mark those as `isRetracted = true` in new contract
- **Frontend:** Update seed display logic to check both `isWinner` and `isRetracted`

---

## 📦 NEW FEATURES

### 4. **Array Growth Limits**

**New Constants:**
```solidity
uint256 public constant MAX_SEEDS_PER_ROUND = 1000;
uint256 public constant MAX_TOTAL_SEEDS = 100000;
```

**Impact:**
- ✅ **Gas safety:** Prevents unbounded array growth
- ⚠️ **Behavior change:** `submitSeed()` will revert after limits reached

**Action Required:**
- **Monitoring:** Track `seedCount` and `roundSeedIds[currentRound].length`
- **Planning:** Design for round rotation before hitting 1000 seeds/round
- **Frontend:** Display remaining capacity to users

**Error Handling:**
```typescript
try {
  await contract.submitSeed(ipfsHash);
} catch (error) {
  if (error.message.includes('MaxSeedsReached')) {
    // Handle total limit reached
  } else if (error.message.includes('RoundSeedLimitReached')) {
    // Handle per-round limit reached
  }
}
```

---

### 5. **IPFS Hash Validation**

**New Validation:**
- CIDv0: 46 characters, starts with 'Qm'
- CIDv1: 59 characters, starts with 'b'
- General: 10-100 characters (flexible)

**Impact:**
- ⚠️ **Behavior change:** Invalid IPFS hashes now revert

**Action Required:**
- **Frontend:** Validate IPFS hash before submission
- **Testing:** Update tests to use valid IPFS hashes

```typescript
// Frontend validation example
function validateIPFSHash(hash: string): boolean {
  if (hash.length === 46 && hash.startsWith('Qm')) return true;
  if (hash.length === 59 && hash.startsWith('b')) return true;
  if (hash.length >= 10 && hash.length <= 100) return true;
  return false;
}
```

---

### 6. **Deferred Configuration Updates**

**New Variables:**
```solidity
uint256 public nextVotingPeriod;
uint256 public nextBlessingsPerNFT;
```

**New Behavior:**
- `updateVotingPeriod()` - schedules update for next round
- `updateBlessingsPerNFT()` - schedules update for next round

**Impact:**
- ⚠️ **Behavior change:** Updates no longer take effect immediately
- ✅ **Safer:** Prevents mid-round rule changes

**Action Required:**
- **Admin UI:** Show both current and scheduled values
- **Communication:** Inform users of upcoming changes

```typescript
// Check for scheduled updates
const currentPeriod = await contract.votingPeriod();
const nextPeriod = await contract.nextVotingPeriod();

if (nextPeriod > 0) {
  console.log(`Voting period will change from ${currentPeriod} to ${nextPeriod} next round`);
}
```

---

### 7. **Score Reset Policy**

**New Variable:**
```solidity
bool public resetScoresOnRoundEnd;
```

**New Function:**
```solidity
function updateScoreResetPolicy(bool _enabled) external onlyRole(ADMIN_ROLE);
```

**Impact:**
- ✅ **Optional feature:** Default is `false` (backward compatible)
- ✅ **Configurable:** Can be enabled/disabled anytime

**Use Cases:**
- `resetScoresOnRoundEnd = false`: Scores accumulate across rounds (good for NON_ROUND_BASED mode)
- `resetScoresOnRoundEnd = true`: Fresh start each round (good for ROUND_BASED mode)

**Action Required:**
- **Strategy decision:** Choose appropriate policy for your use case
- **Communication:** Explain policy to users

---

### 8. **Enhanced Events**

**New Events:**
```solidity
event SeedScoreUpdated(uint256 indexed seedId, address indexed blesser, uint256 previousScore, uint256 newScore, uint256 decayFactor);
event BlessingFailed(uint256 indexed seedId, address indexed blesser, string reason);
event VotingPeriodScheduled(uint256 currentPeriod, uint256 scheduledPeriod);
event BlessingsPerNFTScheduled(uint256 currentAmount, uint256 scheduledAmount);
event ScoreResetPolicyUpdated(bool resetScores);
event ScoresReset(uint256 indexed round, uint256 seedsAffected);
```

**Impact:**
- ✅ **Better observability:** Track score changes in real-time
- ✅ **Debugging:** Identify failed blessings
- ✅ **Transparency:** Users see score updates

**Action Required:**
- **Indexer:** Update event listeners to handle new events
- **Analytics:** Use `SeedScoreUpdated` for detailed score tracking
- **Monitoring:** Alert on `BlessingFailed` events

```typescript
// Listen to score updates
contract.on('SeedScoreUpdated', (seedId, blesser, prevScore, newScore, decayFactor) => {
  console.log(`Seed ${seedId}: ${prevScore} → ${newScore} (decay: ${decayFactor})`);
});

// Listen to failed blessings
contract.on('BlessingFailed', (seedId, blesser, reason) => {
  console.error(`Blessing failed for seed ${seedId} by ${blesser}: ${reason}`);
});
```

---

### 9. **Pause with Reason**

**Updated Function:**
```solidity
function pause(string calldata reason) external onlyRole(ADMIN_ROLE);
```

**Impact:**
- ⚠️ **Breaking Change:** `pause()` now requires a `reason` parameter
- ✅ **Better transparency:** Users see why contract is paused

**Action Required:**
- **Admin UI:** Update pause function calls to include reason

```typescript
// OLD
await contract.pause();

// NEW
await contract.pause("Emergency maintenance - investigating score anomaly");
```

---

### 10. **Initial Creator in Constructor**

**Updated Constructor:**
```solidity
constructor(address _admin, address _initialCreator)
```

**Impact:**
- ⚠️ **Breaking Change:** Constructor signature changed
- ✅ **Better UX:** Contract is immediately usable

**Action Required:**
- **Deployment:** Pass initial creator address (can be `address(0)` if not needed)

```typescript
// OLD
const contract = await TheSeedsFactory.deploy(adminAddress);

// NEW
const contract = await TheSeedsFactory.deploy(adminAddress, creatorAddress);
```

---

## 🔧 DEPLOYMENT CHECKLIST

### Pre-Deployment

- [ ] Review all security fixes
- [ ] Update frontend to handle new error types
- [ ] Update event listeners for new events
- [ ] Test Merkle proof generation (ensure no duplicates)
- [ ] Validate IPFS hashes before submission
- [ ] Update constructor call with initial creator

### Deployment

- [ ] Deploy new contract (NOT upgrade)
- [ ] Grant ADMIN_ROLE to admin address
- [ ] Grant CREATOR_ROLE to authorized creators
- [ ] Grant RELAYER_ROLE to backend relayers
- [ ] Set initial Merkle root
- [ ] Configure round mode, tie-breaking, deadlock strategies
- [ ] Set score reset policy
- [ ] Verify contract on block explorer

### Post-Deployment

- [ ] Test all blessing flows (direct, delegated, batch)
- [ ] Test configuration updates (voting period, blessings per NFT)
- [ ] Test winner selection
- [ ] Monitor events for anomalies
- [ ] Update documentation with new contract address
- [ ] Communicate changes to users

---

## 📊 DATA MIGRATION (If Preserving State)

### Option 1: Fresh Start (Recommended)

Deploy new contract and start fresh. This is the **cleanest and safest** approach.

**Pros:**
- No migration complexity
- No risk of data corruption
- Clean slate for new features

**Cons:**
- Historical data lost on-chain (can be preserved off-chain)

### Option 2: State Migration (Advanced)

If you must preserve on-chain state, follow these steps:

1. **Export Old State:**
   ```typescript
   const oldSeeds = [];
   const seedCount = await oldContract.seedCount();

   for (let i = 0; i < seedCount; i++) {
     const seed = await oldContract.getSeed(i);
     oldSeeds.push(seed);
   }
   ```

2. **Identify Retracted Seeds:**
   ```typescript
   const retractedSeeds = oldSeeds.filter(seed => {
     // Logic to identify truly retracted vs real winners
     // This depends on your off-chain records
     return seed.isWinner && !isRealWinner(seed.id);
   });
   ```

3. **Deploy and Populate New Contract:**
   ```solidity
   // Create migration function in new contract
   function migrateSeeds(
     Seed[] calldata _seeds
   ) external onlyRole(ADMIN_ROLE) {
     // Batch insert seeds
   }
   ```

4. **Verify Migration:**
   ```typescript
   // Compare old vs new
   for (let i = 0; i < seedCount; i++) {
     const oldSeed = await oldContract.getSeed(i);
     const newSeed = await newContract.getSeed(i);

     // Verify data integrity
   }
   ```

---

## 🧪 TESTING STRATEGY

### Critical Tests

1. **Duplicate Token ID Prevention:**
   ```typescript
   it("should reject duplicate token IDs", async () => {
     await expect(
       contract.blessSeed(0, [1, 1, 2], proof)
     ).to.be.revertedWithCustomError(contract, "InvalidMerkleProof");
   });
   ```

2. **Score Precision:**
   ```typescript
   it("should calculate scores with precision", async () => {
     // Test 1, 2, 3, 4 blessings and verify scores increase properly
   });
   ```

3. **Retracted Seeds:**
   ```typescript
   it("should exclude retracted from selection", async () => {
     await contract.retractSeed(0);
     // Verify seed 0 cannot win
   });
   ```

4. **Array Limits:**
   ```typescript
   it("should enforce MAX_SEEDS_PER_ROUND", async () => {
     // Submit 1000 seeds
     await expect(contract.submitSeed(...)).to.be.revertedWithCustomError(
       contract,
       "RoundSeedLimitReached"
     );
   });
   ```

### Integration Tests

- Test full blessing flow with new contract
- Test winner selection with retracted seeds
- Test score reset policy
- Test deferred config updates
- Test all new events

---

## 📚 API COMPATIBILITY MATRIX

| Function | v1.0.0 | v1.1.0 | Breaking Change |
|----------|---------|---------|-----------------|
| `constructor` | ✅ | ⚠️ **NEW PARAM** | Yes - requires `_initialCreator` |
| `submitSeed` | ✅ | ✅ Enhanced | No - but validates IPFS hash |
| `retractSeed` | ✅ | ✅ Enhanced | No - but sets `isRetracted` |
| `blessSeed` | ✅ | ✅ Enhanced | No - but rejects duplicates |
| `blessSeedFor` | ✅ | ✅ | No |
| `batchBlessSeedsFor` | ✅ | ✅ Enhanced | No - but emits failures |
| `selectDailyWinner` | ✅ | ✅ Enhanced | No - but resets scores optionally |
| `pause` | ✅ | ⚠️ **NEW PARAM** | Yes - requires `reason` |
| `unpause` | ✅ | ✅ | No |
| `updateVotingPeriod` | ✅ | ⚠️ **DEFERRED** | No - but deferred to next round |
| `updateBlessingsPerNFT` | ✅ | ⚠️ **DEFERRED** | No - but deferred to next round |
| `getSeed` | ✅ | ⚠️ **NEW FIELD** | Yes - struct has `isRetracted` |
| `getCurrentLeader` | ✅ | ✅ Enhanced | No - but filters retracted |
| `getEligibleSeeds` | ✅ | ✅ Enhanced | No - but filters retracted |

---

## ❓ FAQ

### Q: Can I upgrade my existing contract to v1.1.0?
**A:** No. The storage layout changed (new `isRetracted` field). You must deploy a new contract.

### Q: Will old scores work with new contract?
**A:** No. The scale factor changed. Old scores are ~1000x smaller than new scores.

### Q: Do I need to change my frontend?
**A:** Yes, for:
- Constructor calls (new parameter)
- Pause function (requires reason)
- Error handling (new error types)
- Event listening (new events)
- IPFS hash validation

### Q: What happens to retracted seeds in old contract marked as `isWinner`?
**A:** They remain marked as winners in old contract. In new contract, they should be marked as `isRetracted = true`.

### Q: Can I still use round-based and non-round-based modes?
**A:** Yes! All configurability is preserved and enhanced.

### Q: Should I enable score reset?
**A:** Depends on your use case:
- **Round-based competition:** Enable reset for fair rounds
- **Cumulative competition:** Disable reset to accumulate support over time

---

## 🆘 SUPPORT

If you encounter issues during migration:

1. Check this guide first
2. Review test suite in `/test/TheSeedsFixed.test.ts`
3. Review contract code for detailed NatSpec comments
4. Open an issue on GitHub

---

## 📝 CHANGELOG

### v1.1.0 (Current)

**Security Fixes:**
- ✅ FIX: Duplicate token ID attack prevention
- ✅ FIX: Score precision improvement with scale factor
- ✅ FIX: Retracted seeds semantic clarity

**New Features:**
- ✅ NEW: Array growth limits (MAX_SEEDS_PER_ROUND, MAX_TOTAL_SEEDS)
- ✅ NEW: IPFS hash validation
- ✅ NEW: Deferred configuration updates
- ✅ NEW: Score reset policy (configurable)
- ✅ NEW: Enhanced events (SeedScoreUpdated, BlessingFailed, etc.)
- ✅ NEW: Pause with reason
- ✅ NEW: Initial creator in constructor
- ✅ NEW: Contract version tracking (VERSION constant)

**Improvements:**
- Filtered retracted seeds from all view functions
- Better gas efficiency with block scopes
- Improved documentation

### v1.0.0 (Previous)
- Initial release

---

**Last Updated:** 2025-12-17
**Contract Version:** 1.1.0
**Migration Status:** ⚠️ Non-Upgradeable - Deploy New Contract
