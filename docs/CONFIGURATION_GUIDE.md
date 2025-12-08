# TheSeeds Configuration Guide

Complete guide for configuring TheSeeds contract parameters after deployment.

## Overview

TheSeeds follows the same configurable design pattern as AbrahamCovenant and AbrahamAuction contracts, allowing key governance parameters to be adjusted after deployment without requiring contract redeployment.

### Configurable Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| **Voting Period** | 1 day (86,400s) | 1 hour - 7 days | Duration of each voting/blessing round |
| **Blessings Per NFT** | 1 | 1 - 100 | Number of blessings each NFT grants per day |

---

## Default Configuration

When the contract is deployed, the following defaults are set in the constructor:

```solidity
constructor(address _admin) {
    // ...
    votingPeriod = 1 days;      // 86,400 seconds
    blessingsPerNFT = 1;        // 1 blessing per NFT
    // ...
}
```

These values are **NOT** set by the deployment script - they are hardcoded in the contract constructor for security and auditability.

---

## Updating Configuration

### Requirements

- Must have `ADMIN_ROLE` on the contract
- Must have ETH for gas fees on Base (or Base Sepolia)

### Method 1: Using Cast (Foundry)

#### Update Voting Period

```bash
# Example: Change to 12 hours
cast send $THESEEDS_CONTRACT_ADDRESS \
  "updateVotingPeriod(uint256)" \
  43200 \
  --rpc-url $BASE_RPC_URL \
  --private-key $ADMIN_PRIVATE_KEY

# Valid range: 3600 (1 hour) to 604800 (7 days)
```

**Common Voting Periods:**
- 6 hours: `21600`
- 12 hours: `43200`
- 1 day: `86400` (default)
- 2 days: `172800`
- 3 days: `259200`
- 1 week: `604800`

#### Update Blessings Per NFT

```bash
# Example: Change to 3 blessings per NFT
cast send $THESEEDS_CONTRACT_ADDRESS \
  "updateBlessingsPerNFT(uint256)" \
  3 \
  --rpc-url $BASE_RPC_URL \
  --private-key $ADMIN_PRIVATE_KEY

# Valid range: 1 to 100
```

### Method 2: Using ethers.js

```typescript
import { ethers } from 'ethers';
import SEEDS_ABI from './lib/abi/TheSeeds.json';

const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
const wallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
const contract = new ethers.Contract(
  process.env.THESEEDS_CONTRACT_ADDRESS,
  SEEDS_ABI,
  wallet
);

// Update voting period to 12 hours
const tx1 = await contract.updateVotingPeriod(43200);
await tx1.wait();
console.log('Voting period updated!');

// Update blessings per NFT to 3
const tx2 = await contract.updateBlessingsPerNFT(3);
await tx2.wait();
console.log('Blessings per NFT updated!');
```

### Method 3: Using viem

```typescript
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import SEEDS_ABI from './lib/abi/TheSeeds.json';

const account = privateKeyToAccount(process.env.ADMIN_PRIVATE_KEY as `0x${string}`);

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http()
});

const publicClient = createPublicClient({
  chain: base,
  transport: http()
});

// Update voting period
const hash1 = await walletClient.writeContract({
  address: process.env.THESEEDS_CONTRACT_ADDRESS as `0x${string}`,
  abi: SEEDS_ABI,
  functionName: 'updateVotingPeriod',
  args: [43200n] // 12 hours
});

await publicClient.waitForTransactionReceipt({ hash: hash1 });
console.log('Voting period updated!', hash1);

// Update blessings per NFT
const hash2 = await walletClient.writeContract({
  address: process.env.THESEEDS_CONTRACT_ADDRESS as `0x${string}`,
  abi: SEEDS_ABI,
  functionName: 'updateBlessingsPerNFT',
  args: [3n]
});

await publicClient.waitForTransactionReceipt({ hash: hash2 });
console.log('Blessings per NFT updated!', hash2);
```

---

## Reading Current Configuration

### Using Cast

```bash
# Get voting period
cast call $THESEEDS_CONTRACT_ADDRESS \
  "votingPeriod()" \
  --rpc-url $BASE_RPC_URL

# Get blessings per NFT
cast call $THESEEDS_CONTRACT_ADDRESS \
  "blessingsPerNFT()" \
  --rpc-url $BASE_RPC_URL

# Get time until current period ends
cast call $THESEEDS_CONTRACT_ADDRESS \
  "getTimeUntilPeriodEnd()" \
  --rpc-url $BASE_RPC_URL

# Get current round
cast call $THESEEDS_CONTRACT_ADDRESS \
  "currentRound()" \
  --rpc-url $BASE_RPC_URL
```

### Using TypeScript (ethers.js)

```typescript
const votingPeriod = await contract.votingPeriod();
console.log(`Voting period: ${votingPeriod} seconds`);
console.log(`  = ${Number(votingPeriod) / 3600} hours`);
console.log(`  = ${Number(votingPeriod) / 86400} days`);

const blessingsPerNFT = await contract.blessingsPerNFT();
console.log(`Blessings per NFT: ${blessingsPerNFT}`);

const timeRemaining = await contract.getTimeUntilPeriodEnd();
console.log(`Time until period ends: ${timeRemaining}s`);

const currentRound = await contract.currentRound();
console.log(`Current round: ${currentRound}`);
```

---

## Configuration Events

The contract emits events whenever configuration changes. Monitor these to keep your application in sync:

### VotingPeriodUpdated

```solidity
event VotingPeriodUpdated(uint256 previousPeriod, uint256 newPeriod);
```

**Example (ethers.js):**
```typescript
contract.on('VotingPeriodUpdated', (previousPeriod, newPeriod) => {
  console.log('Voting period changed!');
  console.log(`  Previous: ${previousPeriod}s (${Number(previousPeriod) / 86400} days)`);
  console.log(`  New: ${newPeriod}s (${Number(newPeriod) / 86400} days)`);

  // Update UI, notify users, etc.
});
```

**Example (viem):**
```typescript
const unwatch = publicClient.watchContractEvent({
  address: contractAddress,
  abi: SEEDS_ABI,
  eventName: 'VotingPeriodUpdated',
  onLogs: logs => {
    logs.forEach(log => {
      console.log('Voting period updated:', log.args);
    });
  }
});
```

### BlessingsPerNFTUpdated

```solidity
event BlessingsPerNFTUpdated(uint256 previousAmount, uint256 newAmount);
```

**Example (ethers.js):**
```typescript
contract.on('BlessingsPerNFTUpdated', (previousAmount, newAmount) => {
  console.log('Blessings per NFT changed!');
  console.log(`  Previous: ${previousAmount}`);
  console.log(`  New: ${newAmount}`);

  // Recalculate user's available blessings
  // Update blessing UI limits
});
```

---

## Validation & Constraints

### Voting Period Validation

```solidity
function updateVotingPeriod(uint256 _newVotingPeriod) external onlyRole(ADMIN_ROLE) {
    if (_newVotingPeriod < 1 hours || _newVotingPeriod > 7 days) {
        revert InvalidVotingPeriod();
    }
    // ...
}
```

**Valid Range:** 3,600 to 604,800 seconds

**Error:** `InvalidVotingPeriod()` if outside range

### Blessings Per NFT Validation

```solidity
function updateBlessingsPerNFT(uint256 _newBlessingsPerNFT) external onlyRole(ADMIN_ROLE) {
    if (_newBlessingsPerNFT == 0 || _newBlessingsPerNFT > 100) {
        revert InvalidBlessingsPerNFT();
    }
    // ...
}
```

**Valid Range:** 1 to 100

**Error:** `InvalidBlessingsPerNFT()` if outside range

---

## Impact of Configuration Changes

### Voting Period Changes

**Does NOT affect:**
- Current round in progress
- Current period start time
- Blessings already cast in current round

**DOES affect:**
- Future rounds after the current one ends
- When `selectDailyWinner()` can be called next time
- Time decay calculations for future blessings

**Example:**
```
Current round started at: 2025-12-08 00:00:00
Current voting period: 1 day
Update voting period to: 12 hours at 2025-12-08 10:00:00

Current round will STILL end at: 2025-12-09 00:00:00 (24h from start)
Next round will end at: 2025-12-09 12:00:00 (12h from next start)
```

### Blessings Per NFT Changes

**Takes effect:**
- Immediately for all users
- For the current day's blessing limits

**DOES NOT affect:**
- Blessings already cast
- Previous rounds

**Example:**
```
User has 5 NFTs
Current blessings per NFT: 1
User has blessed 1 time today
Update blessings per NFT to: 3

Before update: 1/5 blessings used (4 remaining)
After update: 1/15 blessings used (14 remaining)
```

---

## Best Practices

### 1. Test Configuration Changes on Testnet First

Always test configuration changes on Base Sepolia before applying to mainnet:

```bash
# Test on Base Sepolia
cast send $SEPOLIA_CONTRACT \
  "updateVotingPeriod(uint256)" \
  43200 \
  --rpc-url https://sepolia.base.org \
  --private-key $ADMIN_KEY

# Verify it worked
cast call $SEPOLIA_CONTRACT "votingPeriod()" --rpc-url https://sepolia.base.org

# If successful, apply to mainnet
cast send $MAINNET_CONTRACT \
  "updateVotingPeriod(uint256)" \
  43200 \
  --rpc-url https://mainnet.base.org \
  --private-key $ADMIN_KEY
```

### 2. Communicate Changes to Users

Before making configuration changes, notify your community:

```typescript
// Example: Announce on Discord/Twitter before changing
async function updateVotingPeriodWithAnnouncement(newPeriod: number) {
  // 1. Announce change
  await postToDiscord(`
    📢 Governance Update

    We're updating the voting period:
    Current: ${currentPeriod / 86400} days
    New: ${newPeriod / 86400} days

    This change will take effect after the current round ends.
  `);

  // 2. Wait for current round to end
  const timeRemaining = await contract.getTimeUntilPeriodEnd();
  await sleep(Number(timeRemaining) * 1000);

  // 3. Apply change
  const tx = await contract.updateVotingPeriod(newPeriod);
  await tx.wait();

  // 4. Confirm change
  await postToDiscord(`✅ Voting period updated successfully!`);
}
```

### 3. Monitor for Unexpected Behavior

After configuration changes, monitor:
- User blessing patterns
- Daily winner selection
- Blessing score calculations
- Gas costs for transactions

### 4. Document All Changes

Keep a log of all configuration changes:

```typescript
// configuration-log.json
{
  "changes": [
    {
      "timestamp": "2025-12-08T10:00:00Z",
      "parameter": "votingPeriod",
      "previousValue": 86400,
      "newValue": 43200,
      "txHash": "0x123...",
      "reason": "Community vote to reduce voting period"
    }
  ]
}
```

---

## Emergency Configuration Scenarios

### Scenario 1: Voting Period Too Short

**Problem:** Users complaining they don't have enough time to vote

**Solution:**
```bash
# Increase voting period to 2 days
cast send $CONTRACT "updateVotingPeriod(uint256)" 172800 --rpc-url $RPC --private-key $KEY
```

### Scenario 2: Too Many/Few Blessings

**Problem:** Blessing system feels unbalanced

**Solution:**
```bash
# Adjust blessings per NFT
# Too many: reduce from 3 to 1
cast send $CONTRACT "updateBlessingsPerNFT(uint256)" 1 --rpc-url $RPC --private-key $KEY

# Too few: increase from 1 to 3
cast send $CONTRACT "updateBlessingsPerNFT(uint256)" 3 --rpc-url $RPC --private-key $KEY
```

### Scenario 3: Time Decay Issues

**Problem:** Last-minute blessings dominating

**Solution:** Voting period is already using quadratic time decay. Consider:
1. Educating users about early blessing benefits
2. Not adjusting parameters (system working as designed)

---

## API Integration

If you've implemented admin API endpoints:

```typescript
// GET current configuration
const config = await fetch('/api/config').then(r => r.json());
console.log(config.data);

// POST update voting period (admin only)
await fetch('/api/admin/config/voting-period', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ votingPeriod: 43200 })
});

// POST update blessings per NFT (admin only)
await fetch('/api/admin/config/blessings-per-nft', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ blessingsPerNFT: 3 })
});
```

---

## Comparison with Other Contracts

TheSeeds follows the same configuration pattern as other Abraham contracts:

| Contract | Configurable Parameters |
|----------|------------------------|
| **AbrahamCovenant** | Work cycle duration, sales mechanic, abraham address |
| **AbrahamAuction** | Extension window, extension duration, payout address |
| **TheSeeds** | Voting period, blessings per NFT |

All contracts:
- ✅ Use admin-only functions for updates
- ✅ Emit events for configuration changes
- ✅ Validate inputs with proper error handling
- ✅ Maintain sensible defaults in constructor
- ✅ Enable runtime flexibility without redeployment

---

## Further Reading

- [Smart Contract Guide](../SMART_CONTRACT_GUIDE.md)
- [API Reference](./API_REFERENCE.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Contract Source Code](../contracts/TheSeeds.sol)
