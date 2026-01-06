# Deadlock Fix Guide

## Current Situation
- **Round**: 5 (NON_ROUND_BASED mode)
- **Problem**: All 5 eligible seeds have 0 blessings
- **Voting Period**: Ended (can't cast new blessings)
- **Current Strategy**: REVERT (blocks winner selection)

## The Fix

Use the **SKIP_ROUND** strategy to skip round 5 and start a fresh round 6 with a new voting period.

---

## Step 1: Change Deadlock Strategy to SKIP_ROUND

### Option A: Using curl (if API is running)

```bash
curl -X POST "http://localhost:3000/admin/config/deadlock" \
  -H "X-Admin-Key: father-abraham" \
  -H "Content-Type: application/json" \
  -d '{"strategy": "SKIP_ROUND"}'
```

### Option B: Using Hardhat Console

```bash
npm run compile
npx hardhat console --network baseSepolia
```

Then in the console:
```javascript
const TheSeeds = await ethers.getContractFactory("TheSeeds");
const contract = TheSeeds.attach("0xaea1cfd09da8f226a2ff2590d6b748563cf517f0");

// Change to SKIP_ROUND (1)
const tx = await contract.updateDeadlockStrategy(1);
await tx.wait();
console.log("Strategy updated:", tx.hash);
```

### Option C: Using cast (Foundry)

```bash
cast send 0xaea1cfd09da8f226a2ff2590d6b748563cf517f0 \
  "updateDeadlockStrategy(uint8)" \
  1 \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY
```

---

## Step 2: Call selectDailyWinner() to Skip the Round

### Option A: Using curl (if API is running)

```bash
curl -X POST "http://localhost:3000/admin/select-winner" \
  -H "X-Admin-Key: father-abraham" \
  -H "Content-Type: application/json"
```

### Option B: Using Hardhat Console

```javascript
// In same console session as above
const tx2 = await contract.selectDailyWinner();
await tx2.wait();
console.log("Round skipped:", tx2.hash);

// Check new round
const round = await contract.currentRound();
console.log("New round:", round.toString());
```

### Option C: Using cast

```bash
cast send 0xaea1cfd09da8f226a2ff2590d6b748563cf517f0 \
  "selectDailyWinner()" \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY
```

---

## Step 3: Verify the Fix

```bash
# Check new round (should be 6)
cast call 0xaea1cfd09da8f226a2ff2590d6b748563cf517f0 \
  "currentRound()" \
  --rpc-url $BASE_SEPOLIA_RPC_URL

# Check voting period time remaining (should be ~86400 = 1 day)
cast call 0xaea1cfd09da8f226a2ff2590d6b748563cf517f0 \
  "getTimeUntilPeriodEnd()" \
  --rpc-url $BASE_SEPOLIA_RPC_URL
```

Or run the diagnostic script:
```bash
npx tsx scripts/breakDeadlock.ts
```

---

## What Happens Next?

After executing these steps:

1. ✅ **Round 5 is skipped** (no winner selected)
2. ✅ **Round 6 starts** with a fresh 24-hour voting period
3. ✅ **Blessings can be cast** on existing seeds (4, 5, 6, 7, 8)
4. ✅ **New seeds can be submitted** (still NON_ROUND_BASED mode)
5. ⏳ **Wait for voting period** to accumulate blessings
6. ✅ **Select winner normally** when period ends

---

## Optional: Change Back to REVERT

After you have a working system with blessings, you can optionally change back to REVERT strategy:

```bash
curl -X POST "http://localhost:3000/admin/config/deadlock" \
  -H "X-Admin-Key: father-abraham" \
  -H "Content-Type: application/json" \
  -d '{"strategy": "REVERT"}'
```

---

## Quick Start (Recommended)

If you have Hardhat set up, this is the fastest method:

```bash
# Start Hardhat console
npx hardhat console --network baseSepolia
```

Then paste this entire block:

```javascript
const TheSeeds = await ethers.getContractFactory("TheSeeds");
const contract = TheSeeds.attach("0xaea1cfd09da8f226a2ff2590d6b748563cf517f0");

// Step 1: Change to SKIP_ROUND
console.log("Changing deadlock strategy to SKIP_ROUND...");
let tx = await contract.updateDeadlockStrategy(1);
await tx.wait();
console.log("✅ Strategy updated:", tx.hash);

// Step 2: Skip the round
console.log("\nSkipping current round...");
tx = await contract.selectDailyWinner();
await tx.wait();
console.log("✅ Round skipped:", tx.hash);

// Step 3: Verify
const round = await contract.currentRound();
const timeRemaining = await contract.getTimeUntilPeriodEnd();
console.log("\n📊 New State:");
console.log("Current Round:", round.toString());
console.log("Time Remaining:", timeRemaining.toString(), "seconds");
console.log("Voting Period Active:", timeRemaining > 0n ? "YES ✅" : "NO ❌");
```

---

## Need Help?

- Run diagnostics: `npx tsx scripts/breakDeadlock.ts`
- Check contract on BaseScan: https://sepolia.basescan.org/address/0xaea1cfd09da8f226a2ff2590d6b748563cf517f0
