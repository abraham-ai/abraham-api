# AbrahamSeeds Configuration Guide

Complete guide for configuring AbrahamSeeds contract parameters after deployment.

## Overview

AbrahamSeeds (via EdenAgent base contract) allows key governance parameters to be adjusted after deployment without requiring contract redeployment.

### Configurable Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| **Period Duration** | 1 day (86,400s) | Duration of each voting/blessing round |
| **Reactions Per Token** | 1 | Number of blessings each NFT grants per period |
| **Messages Per Token** | 1 | Number of commandments each NFT grants per period |
| **Edition Price** | 0 | Price per public edition (in wei) |
| **Creator Editions** | 1 | Editions minted to creator on win |
| **Curator Editions** | 5 | Editions for top blessers (priests) |
| **Public Editions** | 10 | Editions available for purchase |

## Default Configuration

When the contract is deployed, the following defaults are set:

```solidity
// In EdenAgent constructor
Config({
    periodDuration: 1 days,      // 86,400 seconds
    reactionsPerToken: 1,        // 1 blessing per NFT
    messagesPerToken: 1,         // 1 message per NFT
    editionPrice: 0              // Free editions
})

EditionAlloc({
    creatorAmount: 1,            // 1 edition to creator
    curatorAmount: 5,            // 5 editions for curators
    publicAmount: 10             // 10 editions for sale
})
```

## Updating Configuration

### Requirements

- Must have `DEFAULT_ADMIN_ROLE` on the contract
- Must have ETH for gas fees on Base (or Base Sepolia)

### Method 1: Using Viem (Recommended)

```typescript
import { createWalletClient, http, publicActions } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import edenAgentABI from './lib/abi/EdenAgent.json';

const SEEDS_CONTRACT = '0x0b95d25463b7a937b3df28368456f2c40e95c730';

const account = privateKeyToAccount(`0x${process.env.ADMIN_PRIVATE_KEY}`);
const client = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(process.env.BASE_SEPOLIA_RPC_URL)
}).extend(publicActions);

// Update full configuration
const tx = await client.writeContract({
  address: SEEDS_CONTRACT,
  abi: edenAgentABI,
  functionName: 'setConfig',
  args: [{
    periodDuration: 43200n,      // 12 hours
    reactionsPerToken: 2n,       // 2 blessings per NFT
    messagesPerToken: 1n,        // 1 message per NFT
    editionPrice: 0n             // Free editions
  }]
});

await client.waitForTransactionReceipt({ hash: tx });
console.log('Configuration updated!');
```

### Method 2: Using Hardhat Console

```bash
npx hardhat console --network baseSepolia
```

```javascript
const contract = await ethers.getContractAt(
  "AbrahamSeeds",
  "0x0b95d25463b7a937b3df28368456f2c40e95c730"
);

// Update configuration
const tx = await contract.setConfig({
  periodDuration: 43200,      // 12 hours
  reactionsPerToken: 2,       // 2 blessings per NFT
  messagesPerToken: 1,        // 1 message per NFT
  editionPrice: 0             // Free editions
});

await tx.wait();
console.log('Configuration updated!');
```

### Method 3: Using Cast (Foundry)

```bash
# Update configuration
cast send 0x0b95d25463b7a937b3df28368456f2c40e95c730 \
  "setConfig((uint256,uint256,uint256,uint256))" \
  "(43200,2,1,0)" \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $ADMIN_PRIVATE_KEY
```

## Common Configuration Scenarios

### 1. Change Voting Period to 12 Hours

```typescript
await client.writeContract({
  address: SEEDS_CONTRACT,
  abi: edenAgentABI,
  functionName: 'setConfig',
  args: [{
    periodDuration: 43200n,      // 12 hours
    reactionsPerToken: 1n,
    messagesPerToken: 1n,
    editionPrice: 0n
  }]
});
```

**Common Voting Periods:**
- 6 hours: `21600`
- 12 hours: `43200`
- 1 day: `86400` (default)
- 2 days: `172800`
- 3 days: `259200`
- 1 week: `604800`

### 2. Increase Blessings Per NFT

```typescript
// Allow 3 blessings per NFT per period
await client.writeContract({
  address: SEEDS_CONTRACT,
  abi: edenAgentABI,
  functionName: 'setConfig',
  args: [{
    periodDuration: 86400n,
    reactionsPerToken: 3n,       // 3 blessings per NFT
    messagesPerToken: 1n,
    editionPrice: 0n
  }]
});
```

### 3. Set Edition Price

```typescript
import { parseEther } from 'viem';

// Set price to 0.01 ETH per edition
await client.writeContract({
  address: SEEDS_CONTRACT,
  abi: edenAgentABI,
  functionName: 'setConfig',
  args: [{
    periodDuration: 86400n,
    reactionsPerToken: 1n,
    messagesPerToken: 1n,
    editionPrice: parseEther('0.01')
  }]
});
```

### 4. Update Edition Allocation

```typescript
// More editions for creators and curators
await client.writeContract({
  address: SEEDS_CONTRACT,
  abi: edenAgentABI,
  functionName: 'setEditionAlloc',
  args: [{
    creatorAmount: 3n,           // 3 editions to creator
    curatorAmount: 10n,          // 10 editions for curators
    publicAmount: 20n            // 20 editions for sale
  }]
});
```

## Reading Current Configuration

### Get Config

```typescript
const config = await client.readContract({
  address: SEEDS_CONTRACT,
  abi: edenAgentABI,
  functionName: 'config'
});

console.log({
  periodDuration: Number(config.periodDuration),
  reactionsPerToken: Number(config.reactionsPerToken),
  messagesPerToken: Number(config.messagesPerToken),
  editionPrice: config.editionPrice
});
```

### Get Edition Allocation

```typescript
const [creator, curator, public_] = await client.readContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'getEditionAllocation'
});

console.log({
  creatorEditions: Number(creator),
  curatorEditions: Number(curator),
  publicEditions: Number(public_)
});
```

### Get Voting Period

```typescript
const period = await client.readContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'votingPeriod'
});

console.log(`Voting period: ${Number(period) / 3600} hours`);
```

### Get Blessings Per NFT

```typescript
const perNFT = await client.readContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'blessingsPerNFT'
});

console.log(`Blessings per NFT: ${perNFT}`);
```

## API Endpoint

The current configuration can be read via API:

```http
GET /api/seeds/config
```

**Response:**
```json
{
  "success": true,
  "data": {
    "roundMode": { "value": 0, "name": "ROUND_BASED" },
    "tieBreakingStrategy": { "value": 0, "name": "LOWEST_SEED_ID" },
    "eligibleSeedsCount": 85,
    "blessingsPerNFT": 1,
    "votingPeriod": 86400
  }
}
```

## Events

Configuration changes emit events:

```solidity
event ConfigUpdated(
    uint256 periodDuration,
    uint256 reactionsPerToken,
    uint256 messagesPerToken,
    uint256 editionPrice
);

event EditionAllocUpdated(
    uint256 creatorAmount,
    uint256 curatorAmount,
    uint256 publicAmount
);
```

## Security Considerations

1. **Admin Only**: Only addresses with `DEFAULT_ADMIN_ROLE` can update configuration
2. **No Time Lock**: Changes take effect immediately
3. **Period Impact**: Changing period duration affects active rounds
4. **Price Changes**: Edition price changes affect future purchases only

## Troubleshooting

### "AccessControl: account 0x... is missing role"

Your wallet doesn't have `DEFAULT_ADMIN_ROLE`. Check with:

```typescript
const ADMIN_ROLE = await client.readContract({
  address: SEEDS_CONTRACT,
  abi: accessControlABI,
  functionName: 'DEFAULT_ADMIN_ROLE'
});

const hasRole = await client.readContract({
  address: SEEDS_CONTRACT,
  abi: accessControlABI,
  functionName: 'hasRole',
  args: [ADMIN_ROLE, yourAddress]
});

console.log('Has admin role:', hasRole);
```

### Configuration Not Updating

1. Ensure transaction was mined successfully
2. Check the transaction receipt for errors
3. Verify you're reading from the correct contract address

## See Also

- [Deployment Guide](./DEPLOYMENT_GUIDE.md) - Initial deployment
- [Seeds Contract Reference](./SEEDS_CONTRACT_REFERENCE.md) - All contract functions
- [API Reference](./API_REFERENCE.md) - API documentation
