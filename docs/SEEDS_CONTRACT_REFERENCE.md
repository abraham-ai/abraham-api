# AbrahamSeeds Contract - Complete Function Reference

This document provides a comprehensive reference for all functions in the [AbrahamSeeds.sol](../contracts/src/agents/abraham/AbrahamSeeds.sol) smart contract and its base contract [EdenAgent.sol](../contracts/src/core/EdenAgent.sol), with code examples for each function.

## Table of Contents

- [Contract Overview](#contract-overview)
- [Core Concepts](#core-concepts)
- [Structs & Types](#structs--types)
- [Seed Management Functions](#seed-management-functions)
- [Blessing Functions](#blessing-functions)
- [Commandment Functions](#commandment-functions)
- [Winner Selection Functions](#winner-selection-functions)
- [Edition Functions](#edition-functions)
- [Query Functions (Read-Only)](#query-functions-read-only)
- [Configuration Functions (Admin)](#configuration-functions-admin)
- [Role Management Functions (Admin)](#role-management-functions-admin)
- [Delegation Functions](#delegation-functions)
- [Events](#events)
- [Code Examples](#code-examples)

---

## Contract Overview

**AbrahamSeeds** is an ERC1155-based NFT contract that extends the **EdenAgent** base contract. It manages a daily competition system where users submit "seeds" (artwork proposals) and vote on them through "blessings". The contract features:

- **ERC1155 Editions** - Winners receive ERC1155 NFTs with multiple editions (creator, curator, public)
- **Quadratic (sqrt) scoring** - Prevents whales from dominating using sqrt of per-user blessings
- **Period-based competitions** - Configurable voting periods with automatic winner selection
- **Cross-chain NFT-gated voting** - Only FirstWorks NFT holders can bless (verified via Merkle proofs)
- **Role-based access control** - ADMIN, CREATOR, and OPERATOR roles
- **Modular gating** - Pluggable MerkleGating module for ownership verification
- **Commandments** - Messages/comments on seeds

**Architecture:**
```
AbrahamSeeds (Abraham-specific wrapper)
    └── EdenAgent (Core functionality)
           ├── AccessControl (Role management)
           ├── ERC1155 (NFT standard)
           ├── ERC1155Supply (Supply tracking)
           └── ReentrancyGuard (Security)
```

**Deployed Contracts:**

| Network | Contract | Address |
|---------|----------|---------|
| Base Sepolia | AbrahamSeeds | `0x0b95d25463b7a937b3df28368456f2c40e95c730` |
| Base Sepolia | MerkleGating | `0x46657b69308d90a4756369094c5d78781f3f5979` |

---

## Core Concepts

### Seeds (Sessions)

A **Seed** is a proposal for artwork, stored on-chain with IPFS metadata. Seeds have:
- Unique ID (auto-incremented)
- Creator address
- IPFS hash (containing title, description, image)
- Blessing count (raw count)
- Blessing score (sqrt-scaled anti-whale score)
- Commandment count (messages)
- Submission round tracking
- Creation round (when/if selected as winner)

### Blessings (Reactions)

**Blessings** are votes on seeds. The blessing system features:
- NFT-gated: Only FirstWorks NFT holders can bless
- Daily limit: 1 blessing per NFT owned per 24 hours (configurable)
- Anti-whale: Uses sqrt(blessings_per_user) for scoring
- Merkle proof verification: Cross-chain ownership verification

### Scoring Formula

```
For each user's blessings on a seed:
  previous_score = sqrt(previous_blessing_count * SCALE)
  new_score = sqrt((previous_blessing_count + 1) * SCALE)
  delta = new_score - previous_score

Total seed score = sum of all deltas (quadratic scoring)

SCALE = 1e6 (for precision)
```

### Periods (Rounds)

- **Duration**: Configurable (default 24 hours)
- **Winner selection**: Highest scoring seed wins
- **NFT minting**: Winner gets ERC1155 editions
- **New period**: Automatically starts after winner selection

### Editions

When a seed wins, ERC1155 editions are minted:
- **Creator editions**: Sent directly to seed creator
- **Curator editions**: Distributed by operator to top blessers
- **Public editions**: Available for purchase

---

## Structs & Types

### Seed (AbrahamSeeds)

```solidity
struct Seed {
    uint256 id;              // Unique seed identifier
    address creator;          // Address that submitted the seed
    string ipfsHash;          // IPFS hash of seed metadata
    uint256 blessings;        // Raw blessing count
    uint256 score;            // Quadratic blessing score
    uint256 commandmentCount; // Number of commandments (messages)
    uint256 createdAt;        // Timestamp of creation
    uint256 submittedInRound; // Round when submitted
    uint256 creationRound;    // Round when selected (0 if not winner)
    bool isRetracted;         // Whether seed was retracted
}
```

### Session (EdenAgent base)

```solidity
struct Session {
    uint256 id;
    address creator;
    string contentHash;
    uint256 reactionCount;    // Raw count
    uint256 reactionScore;    // Quadratic score
    uint256 messageCount;
    uint256 createdAt;
    uint256 submittedInPeriod;
    uint256 selectedInPeriod; // 0 if not selected
    bool isRetracted;
}
```

### Config

```solidity
struct Config {
    uint256 periodDuration;    // Duration of each voting period (default: 1 day)
    uint256 reactionsPerToken; // Blessings allowed per NFT per day (default: 1)
    uint256 messagesPerToken;  // Messages allowed per NFT per day (default: 1)
    uint256 editionPrice;      // Price per public edition (default: 0)
}
```

### EditionAlloc

```solidity
struct EditionAlloc {
    uint256 creatorAmount;  // Editions minted to creator
    uint256 curatorAmount;  // Editions for top curators
    uint256 publicAmount;   // Editions available for purchase
}
```

### Roles

```solidity
bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");
// DEFAULT_ADMIN_ROLE from AccessControl
```

---

## Seed Management Functions

### submitSeed

Submit a new seed to the current round.

**Signature:**
```solidity
function submitSeed(string calldata ipfsHash)
    external
    whenNotPaused
    onlyRole(CREATOR_ROLE)
    returns (uint256)
```

**Access:** CREATOR_ROLE required

**Parameters:**
- `ipfsHash` - IPFS hash containing seed metadata

**Returns:** Seed ID (uint256)

**Validation:**
- IPFS hash must be 10-100 characters
- Contract not paused

**Events Emitted:**
```solidity
event SeedSubmitted(uint256 indexed seedId, address indexed creator, string ipfsHash, uint256 round);
event SessionSubmitted(uint256 indexed sessionId, address indexed creator, string contentHash, uint256 period);
```

**Example Usage:**
```typescript
import { abrahamSeedsABI } from './abi/AbrahamSeeds';

// Submit a seed
const tx = await walletClient.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'submitSeed',
  args: ['ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG']
});

const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });

// Get seed ID from event logs
const seedSubmittedLog = receipt.logs.find(log =>
  log.topics[0] === '0x...' // SeedSubmitted event signature
);
const seedId = Number(seedSubmittedLog.topics[1]);

console.log(`Seed ${seedId} submitted!`);
```

---

### retractSeed

Retract a seed (creator only, cannot retract winners).

**Signature:**
```solidity
function retractSeed(uint256 seedId) external
```

**Access:** Seed creator only

**Parameters:**
- `seedId` - ID of seed to retract

**Requirements:**
- Caller must be seed creator
- Seed must exist
- Seed must not have been selected as winner
- Seed must not already be retracted

**Events Emitted:**
```solidity
event SessionRetracted(uint256 indexed seedId, address indexed creator);
```

**Example Usage:**
```typescript
// Retract your seed
const tx = await walletClient.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'retractSeed',
  args: [42n] // seed ID
});

await publicClient.waitForTransactionReceipt({ hash: tx });
console.log('Seed retracted');
```

---

### getSeed

Get complete seed information.

**Signature:**
```solidity
function getSeed(uint256 seedId) external view returns (Seed memory)
```

**Access:** Public (read-only)

**Parameters:**
- `seedId` - Seed ID to query

**Returns:** Seed struct

**Example Usage:**
```typescript
const seed = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getSeed',
  args: [42n]
});

console.log({
  id: Number(seed.id),
  creator: seed.creator,
  ipfsHash: seed.ipfsHash,
  blessings: Number(seed.blessings),
  score: Number(seed.score),
  commandmentCount: Number(seed.commandmentCount),
  createdAt: Number(seed.createdAt),
  submittedInRound: Number(seed.submittedInRound),
  creationRound: Number(seed.creationRound),
  isRetracted: seed.isRetracted
});
```

---

## Blessing Functions

### blessSeed

Bless a seed with your own NFTs (user signs transaction).

**Signature:**
```solidity
function blessSeed(
    uint256 seedId,
    uint256[] calldata tokenIds,
    bytes calldata proof
) external payable
```

**Access:** Public (requires NFT ownership proof)

**Parameters:**
- `seedId` - ID of seed to bless
- `tokenIds` - Array of FirstWorks NFT token IDs you own
- `proof` - Merkle proof of ownership (encoded)

**Requirements:**
- Must own the NFTs (verified via MerkleGating)
- Seed must exist and not be winner/retracted
- Voting period must be active
- Must not exceed daily blessing limit

**Events Emitted:**
```solidity
event BlessingSubmitted(uint256 indexed seedId, address indexed blesser, uint256 score);
event ReactionSubmitted(uint256 indexed sessionId, address indexed reactor, uint256 newScore);
```

**Example Usage:**
```typescript
// Get your NFT token IDs and merkle proof from API
const tokenIds = [1n, 5n, 10n];
const merkleProof = '0x...'; // Encoded proof from merkle tree

// Bless a seed
const tx = await walletClient.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'blessSeed',
  args: [42n, tokenIds, merkleProof]
});

await publicClient.waitForTransactionReceipt({ hash: tx });
console.log('Blessing submitted!');
```

---

### blessSeedFor

Bless a seed on behalf of another user (relayer/delegate).

**Signature:**
```solidity
function blessSeedFor(
    uint256 seedId,
    address blesser,
    uint256[] calldata tokenIds,
    bytes calldata proof
) external payable
```

**Access:** OPERATOR_ROLE or approved delegate

**Parameters:**
- `seedId` - ID of seed to bless
- `blesser` - Address of the user blessing
- `tokenIds` - Array of NFT token IDs owned by blesser
- `proof` - Merkle proof of blesser's ownership

**Requirements:**
- Caller must have OPERATOR_ROLE OR be approved delegate for blesser
- Blesser must own the NFTs (verified via MerkleGating)
- Same requirements as blessSeed

**Events Emitted:** Same as blessSeed

**Example Usage:**
```typescript
// Backend relayer blessing on behalf of user (gasless)
const tx = await relayerWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'blessSeedFor',
  args: [
    seedId,
    userAddress,
    tokenIds,
    merkleProof
  ]
});

await publicClient.waitForTransactionReceipt({ hash: tx });
```

---

## Commandment Functions

### addCommandment

Add a commandment (message) to a seed.

**Signature:**
```solidity
function addCommandment(
    uint256 seedId,
    string calldata ipfsHash,
    uint256[] calldata tokenIds,
    bytes calldata proof
) external payable
```

**Access:** Public (requires NFT ownership proof)

**Parameters:**
- `seedId` - ID of seed to comment on
- `ipfsHash` - IPFS hash of commandment content
- `tokenIds` - Array of NFT token IDs for verification
- `proof` - Merkle proof of ownership

**Requirements:**
- Must own NFTs (verified via MerkleGating)
- Seed must exist
- Must not exceed daily message limit
- IPFS hash must be valid (10-100 chars)

**Events Emitted:**
```solidity
event CommandmentSubmitted(uint256 indexed id, uint256 indexed seedId, address indexed author, string ipfsHash);
event MessageSubmitted(uint256 indexed messageId, uint256 indexed sessionId, address indexed sender, string contentHash);
```

**Example Usage:**
```typescript
const tx = await walletClient.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'addCommandment',
  args: [
    seedId,
    'ipfs://QmCommandmentContent...',
    tokenIds,
    merkleProof
  ]
});

await publicClient.waitForTransactionReceipt({ hash: tx });
console.log('Commandment added!');
```

---

## Winner Selection Functions

### selectDailyWinner

Select the winner of the current round and start new round.

**Signature:**
```solidity
function selectDailyWinner() external returns (uint256 seedId)
```

**Access:** Public (but typically called by backend/operator)

**Requirements:**
- Voting period must have ended
- At least one eligible seed with score > 0

**Side Effects:**
- Marks winning seed as selected
- Mints ERC1155 editions (creator, curator, public)
- Increments period number
- Starts new voting period
- Removes winner from eligible seeds

**Returns:** Winning seed ID

**Events Emitted:**
```solidity
event CreationMinted(uint256 indexed round, uint256 indexed seedId, uint256 tokenId);
event RoundStarted(uint256 indexed round);
event SessionSelected(uint256 indexed period, uint256 indexed sessionId, uint256 score);
event EditionMinted(uint256 indexed sessionId, uint256 indexed tokenId, uint256 supply);
event PeriodStarted(uint256 indexed period);
```

**Example Usage:**
```typescript
// Usually called by backend cron job
const tx = await operatorWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'selectDailyWinner'
});

const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });

// Parse winning seed ID from events
const creationMintedLog = receipt.logs.find(log =>
  log.topics[0] === '0x...' // CreationMinted event signature
);
const winningSeedId = Number(creationMintedLog.topics[2]);

console.log(`Winner: Seed ${winningSeedId}`);
```

---

## Edition Functions

### rewardPriests

Distribute curator editions to top blessers (priests).

**Signature:**
```solidity
function rewardPriests(
    uint256 tokenId,
    address[] calldata priests,
    uint256[] calldata amounts
) external
```

**Access:** OPERATOR_ROLE (via distributeCuratorEditions)

**Parameters:**
- `tokenId` - ERC1155 token ID of the winning creation
- `priests` - Array of curator addresses to reward
- `amounts` - Array of edition amounts for each curator

**Requirements:**
- Arrays must have same length
- Total must not exceed curator allocation
- Contract must have enough editions

**Events Emitted:**
```solidity
event PriestsRewarded(uint256 indexed tokenId, address[] priests, uint256[] amounts);
event CuratorEditionsDistributed(uint256 indexed tokenId, address[] curators, uint256[] amounts);
```

**Example Usage:**
```typescript
// Distribute curator editions to top 3 blessers
const tx = await operatorWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'rewardPriests',
  args: [
    tokenId,
    [curator1, curator2, curator3],
    [1n, 1n, 1n]
  ]
});

await publicClient.waitForTransactionReceipt({ hash: tx });
```

---

### purchaseCreation

Purchase public editions of a creation.

**Signature:**
```solidity
function purchaseCreation(uint256 tokenId, uint256 amount) external payable
```

**Access:** Public

**Parameters:**
- `tokenId` - ERC1155 token ID to purchase
- `amount` - Number of editions to purchase

**Requirements:**
- Must send correct payment (editionPrice * amount)
- Enough public editions must be available

**Value Split:**
- 50% to creator
- 50% to treasury

**Events Emitted:**
```solidity
event EditionPurchased(uint256 indexed tokenId, address indexed buyer, uint256 amount, uint256 price);
```

**Example Usage:**
```typescript
const price = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getEditionPrice'
});

const tx = await walletClient.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'purchaseCreation',
  args: [tokenId, 1n],
  value: price
});

await publicClient.waitForTransactionReceipt({ hash: tx });
console.log('Edition purchased!');
```

---

### getCreationEditionInfo

Get edition information for a creation.

**Signature:**
```solidity
function getCreationEditionInfo(uint256 tokenId) external view returns (
    uint256 seedId,
    uint256 totalMinted,
    uint256 creatorEditions,
    uint256 curatorEditions,
    uint256 curatorDistributed,
    uint256 publicEditions,
    uint256 publicSold,
    uint256 availableForSale
)
```

**Example Usage:**
```typescript
const info = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getCreationEditionInfo',
  args: [tokenId]
});

console.log({
  seedId: Number(info.seedId),
  totalMinted: Number(info.totalMinted),
  creatorEditions: Number(info.creatorEditions),
  curatorEditions: Number(info.curatorEditions),
  curatorDistributed: Number(info.curatorDistributed),
  publicEditions: Number(info.publicEditions),
  publicSold: Number(info.publicSold),
  availableForSale: Number(info.availableForSale)
});
```

---

## Query Functions (Read-Only)

### getSeedCount

Get total number of seeds created.

**Signature:**
```solidity
function getSeedCount() external view returns (uint256)
```

**Example:**
```typescript
const count = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getSeedCount'
});
console.log(`Total seeds: ${count}`);
```

---

### getCurrentRound

Get current round number.

**Signature:**
```solidity
function getCurrentRound() external view returns (uint256)
```

**Example:**
```typescript
const round = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getCurrentRound'
});
console.log(`Round ${round}`);
```

---

### getTimeUntilRoundEnd

Get seconds remaining in current voting period.

**Signature:**
```solidity
function getTimeUntilRoundEnd() external view returns (uint256)
```

**Returns:** Seconds remaining (0 if period ended)

**Example:**
```typescript
const remaining = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getTimeUntilRoundEnd'
});

const hours = Number(remaining) / 3600;
console.log(`${hours.toFixed(1)} hours until winner selection`);
```

---

### getSeedBlessingScore

Get blessing score for a specific seed.

**Signature:**
```solidity
function getSeedBlessingScore(uint256 seedId) external view returns (uint256)
```

**Returns:** Blessing score (quadratic scaled)

**Example:**
```typescript
const score = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getSeedBlessingScore',
  args: [42n]
});

console.log(`Seed 42 score: ${score}`);
```

---

### getBlessingCount

Get how many times a user has blessed a specific seed.

**Signature:**
```solidity
function getBlessingCount(address user, uint256 seedId) external view returns (uint256)
```

**Example:**
```typescript
const count = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getBlessingCount',
  args: [userAddress, 42n]
});

console.log(`User blessed seed 42 ${count} times`);
```

---

### getRemainingBlessings

Get how many blessings a user has left today.

**Signature:**
```solidity
function getRemainingBlessings(address user, uint256 tokenCount) external view returns (uint256)
```

**Parameters:**
- `user` - User address
- `tokenCount` - Number of FirstWorks NFTs owned

**Returns:** Remaining blessings

**Example:**
```typescript
const nftCount = 3n;
const remaining = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getRemainingBlessings',
  args: [userAddress, nftCount]
});

console.log(`${remaining} of ${nftCount} blessings left today`);
```

---

### canBlessToday

Check if user can bless today (has remaining blessings).

**Signature:**
```solidity
function canBlessToday(address user, uint256 tokenCount) external view returns (bool)
```

**Example:**
```typescript
const canBless = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'canBlessToday',
  args: [userAddress, 3n]
});

console.log(`Can bless: ${canBless}`);
```

---

### getEligibleSeedsCount

Get count of eligible seeds (non-winner, non-retracted).

**Signature:**
```solidity
function getEligibleSeedsCount() external view returns (uint256)
```

**Example:**
```typescript
const count = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getEligibleSeedsCount'
});

console.log(`${count} eligible seeds`);
```

---

### getCommandmentCount

Get number of commandments for a seed.

**Signature:**
```solidity
function getCommandmentCount(uint256 seedId) external view returns (uint256)
```

**Example:**
```typescript
const count = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getCommandmentCount',
  args: [42n]
});

console.log(`Seed 42 has ${count} commandments`);
```

---

### getRoundWinner

Get the winning seed ID for a specific round.

**Signature:**
```solidity
function getRoundWinner(uint256 round) external view returns (uint256)
```

**Example:**
```typescript
const winnerId = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getRoundWinner',
  args: [5n]
});

console.log(`Round 5 winner: Seed ${winnerId}`);
```

---

### getTokenIdBySeedId

Get NFT token ID for a winning seed.

**Signature:**
```solidity
function getTokenIdBySeedId(uint256 seedId) external view returns (uint256)
```

**Returns:** Token ID (0 if seed hasn't won)

**Example:**
```typescript
const tokenId = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getTokenIdBySeedId',
  args: [42n]
});

if (tokenId === 0n) {
  console.log('Seed has not won yet');
} else {
  console.log(`Seed 42 NFT token ID: ${tokenId}`);
}
```

---

### getSeedIdByTokenId

Get seed ID for an NFT token.

**Signature:**
```solidity
function getSeedIdByTokenId(uint256 tokenId) external view returns (uint256)
```

**Example:**
```typescript
const seedId = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getSeedIdByTokenId',
  args: [1n]
});

console.log(`Token 1 is for seed ${seedId}`);
```

---

### blessingsPerNFT

Get blessings allowed per NFT per day.

**Signature:**
```solidity
function blessingsPerNFT() external view returns (uint256)
```

**Example:**
```typescript
const perNFT = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'blessingsPerNFT'
});

console.log(`${perNFT} blessing(s) per NFT per day`);
```

---

### votingPeriod

Get voting period duration in seconds.

**Signature:**
```solidity
function votingPeriod() external view returns (uint256)
```

**Example:**
```typescript
const period = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'votingPeriod'
});

console.log(`Voting period: ${Number(period) / 3600} hours`);
```

---

### getEditionPrice

Get price per public edition.

**Signature:**
```solidity
function getEditionPrice() external view returns (uint256)
```

**Example:**
```typescript
const price = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getEditionPrice'
});

console.log(`Edition price: ${formatEther(price)} ETH`);
```

---

### getEditionAllocation

Get edition allocation configuration.

**Signature:**
```solidity
function getEditionAllocation() external view returns (
    uint256 creator,
    uint256 curator,
    uint256 public_
)
```

**Example:**
```typescript
const [creator, curator, public_] = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: abrahamSeedsABI,
  functionName: 'getEditionAllocation'
});

console.log(`Creator: ${creator}, Curator: ${curator}, Public: ${public_}`);
```

---

## Configuration Functions (Admin)

### setConfig

Update contract configuration.

**Signature:**
```solidity
function setConfig(Config calldata newConfig) external onlyRole(DEFAULT_ADMIN_ROLE)
```

**Access:** DEFAULT_ADMIN_ROLE only

**Parameters:**
- `newConfig` - New Config struct

**Example:**
```typescript
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: edenAgentABI,
  functionName: 'setConfig',
  args: [{
    periodDuration: 86400n,      // 1 day
    reactionsPerToken: 1n,       // 1 blessing per NFT
    messagesPerToken: 1n,        // 1 message per NFT
    editionPrice: 0n             // Free editions
  }]
});

await publicClient.waitForTransactionReceipt({ hash: tx });
```

---

### setEditionAlloc

Update edition allocation.

**Signature:**
```solidity
function setEditionAlloc(EditionAlloc calldata newAlloc) external onlyRole(DEFAULT_ADMIN_ROLE)
```

**Example:**
```typescript
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: edenAgentABI,
  functionName: 'setEditionAlloc',
  args: [{
    creatorAmount: 1n,
    curatorAmount: 5n,
    publicAmount: 10n
  }]
});
```

---

### setGatingModule

Update the gating module.

**Signature:**
```solidity
function setGatingModule(address module) external onlyRole(DEFAULT_ADMIN_ROLE)
```

**Example:**
```typescript
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: edenAgentABI,
  functionName: 'setGatingModule',
  args: [newGatingModuleAddress]
});
```

---

### pause / unpause

Pause or unpause the contract.

**Signature:**
```solidity
function pause() external onlyRole(DEFAULT_ADMIN_ROLE);
function unpause() external onlyRole(DEFAULT_ADMIN_ROLE);
```

**Example:**
```typescript
// Pause contract (emergency stop)
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: edenAgentABI,
  functionName: 'pause'
});

// Unpause
const tx2 = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: edenAgentABI,
  functionName: 'unpause'
});
```

---

## Role Management Functions (Admin)

### addCreator

Grant CREATOR_ROLE to an address.

**Signature:**
```solidity
function addCreator(address creator) external onlyRole(DEFAULT_ADMIN_ROLE)
```

**Example:**
```typescript
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: edenAgentABI,
  functionName: 'addCreator',
  args: [newCreatorAddress]
});
```

---

### addOperator

Grant OPERATOR_ROLE to an address.

**Signature:**
```solidity
function addOperator(address operator) external onlyRole(DEFAULT_ADMIN_ROLE)
```

**Example:**
```typescript
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: edenAgentABI,
  functionName: 'addOperator',
  args: [newOperatorAddress]
});
```

---

## Delegation Functions

### approveDelegate

Approve or revoke a delegate to bless on your behalf.

**Signature:**
```solidity
function approveDelegate(address delegate, bool approved) external
```

**Access:** Public

**Parameters:**
- `delegate` - Address to approve/revoke
- `approved` - true to approve, false to revoke

**Events Emitted:**
```solidity
event DelegateApproval(address indexed user, address indexed delegate, bool approved);
```

**Example Usage:**
```typescript
// Approve backend to bless on your behalf (for gasless blessings)
const BACKEND_RELAYER = '0x...';

const tx = await walletClient.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: edenAgentABI,
  functionName: 'approveDelegate',
  args: [BACKEND_RELAYER, true]
});

await publicClient.waitForTransactionReceipt({ hash: tx });
console.log('Backend approved for gasless blessings!');
```

---

## Events

### AbrahamSeeds Events

```solidity
event SeedSubmitted(uint256 indexed seedId, address indexed creator, string ipfsHash, uint256 round);
event BlessingSubmitted(uint256 indexed seedId, address indexed blesser, uint256 score);
event CommandmentSubmitted(uint256 indexed id, uint256 indexed seedId, address indexed author, string ipfsHash);
event CreationMinted(uint256 indexed round, uint256 indexed seedId, uint256 tokenId);
event RoundStarted(uint256 indexed round);
event PriestsRewarded(uint256 indexed tokenId, address[] priests, uint256[] amounts);
```

### EdenAgent Events

```solidity
event SessionSubmitted(uint256 indexed sessionId, address indexed creator, string contentHash, uint256 period);
event SessionRetracted(uint256 indexed sessionId, address indexed creator);
event ReactionSubmitted(uint256 indexed sessionId, address indexed reactor, uint256 newScore);
event MessageSubmitted(uint256 indexed messageId, uint256 indexed sessionId, address indexed sender, string contentHash);
event SessionSelected(uint256 indexed period, uint256 indexed sessionId, uint256 score);
event EditionMinted(uint256 indexed sessionId, uint256 indexed tokenId, uint256 supply);
event EditionPurchased(uint256 indexed tokenId, address indexed buyer, uint256 amount, uint256 price);
event CuratorEditionsDistributed(uint256 indexed tokenId, address[] curators, uint256[] amounts);
event PeriodStarted(uint256 indexed period);
event DelegateApproval(address indexed user, address indexed delegate, bool approved);
```

---

## Code Examples

### Complete Seed Submission Flow

```typescript
import { createPublicClient, createWalletClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import abrahamSeedsABI from './abi/AbrahamSeeds.json';

const SEEDS_CONTRACT = '0x0b95d25463b7a937b3df28368456f2c40e95c730';

// Setup clients
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL)
});

const account = privateKeyToAccount('0x...');
const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(process.env.RPC_URL)
});

// 1. Prepare IPFS metadata
const metadata = {
  name: "My Amazing Seed",
  description: "A revolutionary art concept",
  image: "ipfs://QmImage..."
};

// Upload to IPFS (using Pinata or similar)
const ipfsHash = await uploadToIPFS(metadata);

// 2. Submit seed
const hash = await walletClient.writeContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'submitSeed',
  args: [`ipfs://${ipfsHash}`]
});

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log('Seed submitted!');

// 3. Get seed info
const seedCount = await publicClient.readContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'getSeedCount'
});

const seedId = Number(seedCount) - 1;
const seed = await publicClient.readContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'getSeed',
  args: [BigInt(seedId)]
});

console.log(`Seed ${seedId} created:`, seed);
```

---

### Complete Blessing Flow

```typescript
// 1. Get user's NFT data and merkle proof
const response = await fetch(`${API_URL}/blessings/eligibility`, {
  headers: { Authorization: `Bearer ${token}` }
});
const { data } = await response.json();

if (!data.eligible) {
  throw new Error(`Not eligible: ${data.remainingBlessings} blessings remaining`);
}

// 2. Get merkle proof for user
const proofResponse = await fetch(`${API_URL}/merkle/proof/${userAddress}`);
const { proof, tokenIds } = await proofResponse.json();

// 3. Encode proof for contract
const encodedProof = encodeAbiParameters(
  [{ type: 'bytes32[]' }],
  [proof]
);

// 4. Bless the seed
const hash = await walletClient.writeContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'blessSeed',
  args: [seedId, tokenIds.map(BigInt), encodedProof]
});

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log('Blessed!');

// 5. Check updated seed score
const seed = await publicClient.readContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'getSeed',
  args: [seedId]
});

console.log(`Seed now has ${seed.blessings} blessings, score: ${seed.score}`);
```

---

### Query Current Competition State

```typescript
async function getRoundInfo() {
  const [
    currentRound,
    timeRemaining,
    seedCount,
    eligibleCount
  ] = await Promise.all([
    publicClient.readContract({
      address: SEEDS_CONTRACT,
      abi: abrahamSeedsABI,
      functionName: 'getCurrentRound'
    }),
    publicClient.readContract({
      address: SEEDS_CONTRACT,
      abi: abrahamSeedsABI,
      functionName: 'getTimeUntilRoundEnd'
    }),
    publicClient.readContract({
      address: SEEDS_CONTRACT,
      abi: abrahamSeedsABI,
      functionName: 'getSeedCount'
    }),
    publicClient.readContract({
      address: SEEDS_CONTRACT,
      abi: abrahamSeedsABI,
      functionName: 'getEligibleSeedsCount'
    })
  ]);

  const hoursRemaining = Number(timeRemaining) / 3600;

  return {
    round: Number(currentRound),
    timeRemaining: `${hoursRemaining.toFixed(1)} hours`,
    totalSeeds: Number(seedCount),
    eligibleSeeds: Number(eligibleCount),
    votingEnded: timeRemaining === 0n
  };
}

const info = await getRoundInfo();
console.log(`
Round ${info.round}
Total Seeds: ${info.totalSeeds}
Eligible: ${info.eligibleSeeds}
Time: ${info.timeRemaining}
`);
```

---

### Listening to Events

```typescript
// Watch for new seed submissions
publicClient.watchContractEvent({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  eventName: 'SeedSubmitted',
  onLogs: logs => {
    for (const log of logs) {
      const { seedId, creator, ipfsHash, round } = log.args;
      console.log(`New seed ${seedId} by ${creator} in round ${round}`);
    }
  }
});

// Watch for blessings
publicClient.watchContractEvent({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  eventName: 'BlessingSubmitted',
  onLogs: logs => {
    for (const log of logs) {
      const { seedId, blesser, score } = log.args;
      console.log(`${blesser} blessed seed ${seedId}, new score: ${score}`);
    }
  }
});

// Watch for creations (winners)
publicClient.watchContractEvent({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  eventName: 'CreationMinted',
  onLogs: logs => {
    for (const log of logs) {
      const { round, seedId, tokenId } = log.args;
      console.log(`Round ${round} winner: Seed ${seedId}, Token ${tokenId}`);
    }
  }
});
```

---

## Error Handling

The contract uses custom errors for gas-efficient error handling:

```solidity
error Paused();                  // Contract is paused
error InvalidContentHash();      // Invalid IPFS hash format
error SessionNotFound();         // Seed doesn't exist
error SessionAlreadySelected();  // Seed already won
error SessionIsRetracted();      // Seed was retracted
error NotSessionCreator();       // Caller is not seed creator
error AlreadyRetracted();        // Seed already retracted
error InvalidGatingProof();      // Merkle proof invalid
error NoTokens();                // No NFTs provided
error DailyLimitReached();       // Daily blessing limit exceeded
error PeriodNotEnded();          // Voting period still active
error NoValidSession();          // No valid winner found
error NotAuthorized();           // Not operator or delegate
error InvalidPayment();          // Wrong payment amount
error EditionNotAvailable();     // Edition sold out
error CuratorLimitExceeded();    // Exceeded curator allocation
error ArrayLengthMismatch();     // Arrays have different lengths
```

---

## Additional Resources

- [Main README](../README.md) - Project overview and architecture
- [API Reference](./API_REFERENCE.md) - REST API endpoints
- [Deployment Guide](./DEPLOYMENT_GUIDE.md) - Contract deployment instructions
- [Smart Contract Summary](../SMART_CONTRACT_SUMMARY.md) - High-level contract overview

---

## Support

For issues or questions:
- GitHub Issues: https://github.com/your-org/abraham-api/issues
- Contract on Base Sepolia: [View on BaseScan](https://sepolia.basescan.org/address/0x0b95d25463b7a937b3df28368456f2c40e95c730)
