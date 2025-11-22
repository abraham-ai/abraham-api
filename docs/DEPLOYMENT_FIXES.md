# TheSeeds Deployment Script - Technical Fixes

This document outlines the key fixes and improvements made to the automated deployment script to ensure reliable deployment.

## Issues Fixed

### 1. Contract Read Timing Issue

**Problem:** Script tried to read from contract immediately after deployment, causing "returned no data" errors.

**Solution:** Added `waitForContract()` function with retry logic that polls the contract until it's ready for read operations.

```typescript
async function waitForContract(
  publicClient: any,
  contractAddress: Address,
  abi: any,
  maxRetries: number = 10
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await publicClient.readContract({
        address: contractAddress,
        abi,
        functionName: "paused",
      });
      return;
    } catch (error) {
      if (i < maxRetries - 1) {
        await sleep(3000);
      }
    }
  }
}
```

### 2. Wrong Environment File

**Problem:** Script created/updated `.env` instead of `.env.local`.

**Solution:** Changed all references to use `.env.local` (Next.js convention for local environment variables).

### 3. ABI Error Signature Decoding

**Problem:** Using `parseAbi()` with minimal function signatures didn't include custom error definitions, resulting in undecoded error signatures like `0xe2517d3f`.

**Solution:** Use full compiled ABI from Hardhat artifacts:

```typescript
import TheSeeds from "../artifacts/contracts/TheSeeds.sol/TheSeeds.json";
const theSeedsAbi = TheSeeds.abi;
```

**Benefit:** Full ABI includes all custom errors, events, and function signatures for proper decoding.

### 4. CREATOR_ROLE Verification Failed

**Problem:** Hardcoded role hash didn't match actual contract's computed hash.

**Solution:** Read role hash directly from deployed contract:

```typescript
const roleAbi = parseAbi(["function CREATOR_ROLE() view returns (bytes32)"]);
CREATOR_ROLE = await publicClient.readContract({
  address: contractAddress,
  abi: roleAbi,
  functionName: "CREATOR_ROLE",
});
```

**Why:** Role hashes are computed as `keccak256("ROLE_NAME")`. Reading from contract ensures we always use the correct hash.

### 5. State Propagation Delays

**Problem:** Reading state immediately after write operations returned stale data.

**Solution:** Added 2-second delays after state-changing operations:

```typescript
// After granting role
await sleep(2000);

// Then verify
const hasRole = await publicClient.readContract({
  address: contractAddress,
  abi: theSeedsAbi,
  functionName: "hasRole",
  args: [CREATOR_ROLE, relayerAccount.address],
});
```

**Why:** Blockchain state changes take time to propagate. The delay ensures subsequent reads see updated state.

### 6. Seed ID Calculation (Critical Fix)

**Problem:** Trying to calculate seed ID from `seedCount` after transaction resulted in `-1` because state hadn't propagated yet.

**Solution:** Get seed ID directly from contract's return value via simulation:

```typescript
// Simulate to capture return value
const { result: simulateResult } = await publicClient.simulateContract({
  address: contractAddress,
  abi: theSeedsAbi,
  functionName: "submitSeed",
  args: [TEST_IPFS_HASH],
  account: relayerAccount,
});

// submitSeed returns the created seed ID
createdSeedId = simulateResult as bigint;

// Execute actual transaction
seedHash = await relayerClient.writeContract({
  address: contractAddress,
  abi: theSeedsAbi,
  functionName: "submitSeed",
  args: [TEST_IPFS_HASH],
});
```

**Why:** The contract's `submitSeed` function returns the seed ID:

```solidity
function submitSeed(string memory _ipfsHash) external returns (uint256) {
    uint256 seedId = seedCount;
    seedCount++;
    // ... create seed ...
    return seedId;
}
```

By simulating first, we capture the return value before executing the transaction. This is more reliable than trying to read `seedCount` after the transaction.

### 7. Viem Return Value Format Handling

**Problem:** Viem can return struct data as arrays or objects depending on version/configuration.

**Solution:** Handle both formats defensively:

```typescript
const s = seed as any;

if (Array.isArray(seed) && seed.length >= 8) {
  // Array format: [id, creator, ipfsHash, votes, blessings, createdAt, minted, mintedInRound]
  id = seed[0] as bigint;
  creator = seed[1] as Address;
  ipfsHash = seed[2] as string;
  createdAt = seed[5] as bigint;
} else {
  // Object format with named properties
  id = s.id;
  creator = s.creator;
  ipfsHash = s.ipfsHash;
  createdAt = s.createdAt;
}
```

## Key Takeaways

### 1. Always Simulate Before Writing

Simulating transactions before execution:
- Catches errors before spending gas
- Allows capturing return values
- Provides better error messages

### 2. Use Full Compiled ABIs

Full ABIs from Hardhat artifacts include:
- Custom error definitions
- All event signatures
- Complete type information

This enables proper error decoding and better debugging.

### 3. Account for State Propagation

Blockchain state changes aren't instant. Always:
- Wait for transaction receipts
- Add delays before reading updated state
- Use retry logic for critical operations

### 4. Read Constants from Contract

Instead of hardcoding values like role hashes:
- Read them from the deployed contract
- Ensures accuracy across contract versions
- Makes scripts more maintainable

### 5. Handle Library Type Variations

Libraries like viem may change return formats:
- Write defensive code that handles multiple formats
- Don't assume specific return types
- Test with different library versions

## Testing the Deployment

After deployment, verify all steps completed:

```bash
# 1. Check environment variables
grep THESEEDS_CONTRACT_ADDRESS .env.local

# 2. Check ABI files were updated
ls -la lib/abi/theSeeds.ts lib/abi/TheSeeds.json

# 3. Verify deployment result
cat deployment-result.json | jq

# 4. Test API endpoints
npm run dev
curl http://localhost:3000/api/seeds/0
```

## Documentation

For complete deployment documentation, see:
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Complete deployment guide
- [BLESSING_SYSTEM.md](./BLESSING_SYSTEM.md) - Blessing system details
- [../scripts/deployComplete.ts](../scripts/deployComplete.ts) - Implementation

---

**Last Updated:** 2025-11-21
