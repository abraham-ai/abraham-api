# Smart Contract Implementation Summary

## Overview

We've implemented a **cross-chain NFT governance system** for the Abraham project using the new **AbrahamSeeds** contract architecture. This system enables decentralized curation of daily NFT mints through community voting (blessings).

## Contract Architecture

### 1. AbrahamSeeds Contract (L2 - Base)

**Location**: [contracts/src/agents/abraham/AbrahamSeeds.sol](./contracts/src/agents/abraham/AbrahamSeeds.sol)

The main governance contract that manages:
- **Seed Submission**: Artists propose artworks (Seeds) via IPFS hash
- **Blessings**: FirstWorks NFT holders vote using Merkle proofs
- **Commandments**: Comments/feedback on seeds
- **Daily Winner Selection**: Highest blessed Seed wins each period
- **ERC1155 NFT Minting**: Winners are minted as edition NFTs

**Key Features**:
- Gas-efficient on L2 (Base)
- ERC1155-based NFT minting for winners
- Role-based access control (CREATOR_ROLE, OPERATOR_ROLE)
- Modular gating system via MerkleGating
- Comprehensive event emission for indexing

### 2. MerkleGating Module (L2 - Base)

**Location**: [contracts/src/modules/gating/MerkleGating.sol](./contracts/src/modules/gating/MerkleGating.sol)

A dedicated gating module for cross-chain NFT ownership verification:
- Stores Merkle root of L1 NFT ownership
- Verifies ownership proofs on-chain
- Separates gating logic from main contract
- Enables easy root updates without contract changes

### 3. EdenAgent Base Contract

**Location**: [contracts/src/core/EdenAgent.sol](./contracts/src/core/EdenAgent.sol)

The base contract that AbrahamSeeds inherits from:
- ERC1155 implementation for edition NFTs
- Edition management and pricing
- Curator edition distribution
- Base seed/blessing/commandment logic

## Deployed Contracts (Base Sepolia Testnet)

| Contract | Address | Description |
|----------|---------|-------------|
| AbrahamSeeds | `0x0b95d25463b7a937b3df28368456f2c40e95c730` | Main governance contract |
| MerkleGating | `0x46657b69308d90a4756369094c5d78781f3f5979` | Cross-chain verification module |

**Deployment Block**: 36452477

## Architecture Design

### Cross-Chain Flow

```
+-------------------------------------------------------------+
|                    Ethereum L1 (Mainnet)                     |
+-------------------------------------------------------------+
|                                                              |
|  Abraham's First Works NFT                                  |
|  Address: 0x9734c959A5FEC7BaD8b0b560AD94F9740B90Efd8        |
|  - 2,044 NFTs (fully minted)                                |
|  - Each NFT = 1 blessing per day on L2                      |
|  - Ownership tracked via daily snapshots                     |
|                                                              |
+-------------------------------------------------------------+
                            |
                            | Daily Snapshot -> Merkle Tree
                            v
+-------------------------------------------------------------+
|                       Base L2                                |
+-------------------------------------------------------------+
|                                                              |
|  MerkleGating Module                                        |
|  - Stores Merkle root of L1 NFT ownership                   |
|  - Verifies proofs on-chain                                 |
|  - Updated daily via backend                                 |
|                                                              |
|  AbrahamSeeds Contract                                       |
|  - Seed submission (IPFS hash)                              |
|  - Blessing with Merkle proof verification                   |
|  - Commandments (comments on seeds)                          |
|  - Daily winner selection                                    |
|  - ERC1155 NFT minting for winners                          |
|                                                              |
+-------------------------------------------------------------+
```

### How It Works

1. **Daily Snapshot** (Backend)
   ```bash
   npm run snapshot:generate   # Fetch FirstWorks ownership from L1
   npm run merkle:generate     # Create Merkle tree with proofs
   npm run update-root         # Update MerkleGating contract
   ```

2. **Seed Submission** (Creators with CREATOR_ROLE)
   - Upload artwork metadata to IPFS
   - Call `submitSeed(ipfsHash)` on AbrahamSeeds
   - Seed enters current voting period

3. **Blessing** (FirstWorks NFT Holders)
   - Request Merkle proof from API: `GET /api/blessings/proof/:address`
   - Submit blessing with proof: `blessSeedFor(seedId, user, tokenIds, proof)`
   - Contract verifies L1 ownership via MerkleGating
   - 1 NFT = 1 blessing per day (resets at midnight UTC)

4. **Commandments** (NFT Holders)
   - Submit comments on seeds: `addCommandmentFor(seedId, user, ipfsHash, tokenIds, proof)`
   - Stored on-chain with IPFS reference
   - Requires NFT ownership proof

5. **Winner Selection** (OPERATOR_ROLE)
   - After voting period ends, call `selectDailyWinner()`
   - Highest blessed seed wins
   - Winner is minted as ERC1155 NFT
   - New voting period begins

## Key Design Decisions

### Modular Gating Architecture

**Why separate MerkleGating?**
- Clean separation of concerns
- Easy to update root without touching main contract
- Reusable for other contracts
- Simpler upgrade path

### ERC1155 for Winner NFTs

**Why ERC1155 over ERC721?**
- Supports editions (multiple copies of same artwork)
- More gas-efficient for batch operations
- Built-in metadata URI support
- Compatible with major marketplaces

### Role-Based Access Control

| Role | Permissions |
|------|------------|
| `CREATOR_ROLE` | Submit seeds |
| `OPERATOR_ROLE` | Select winners, update settings |
| `DEFAULT_ADMIN_ROLE` | Grant/revoke roles |

### Merkle Proof Voting

**Why Merkle proofs?**
- Gas efficient: Only root hash stored on L2
- Trustless: Cryptographically proven ownership
- Scalable: Works with 2,000+ NFTs
- No bridging: NFTs stay on L1

## NPM Scripts

```bash
# API
npm run dev                              # Start dev server
npm run snapshot:generate                # Generate FirstWorks snapshot
npm run merkle:generate                  # Generate Merkle tree
npm run update-snapshot                  # Full update pipeline

# Smart Contracts
npm run compile                          # Compile contracts
npm run deploy:abraham-seeds:base-sepolia  # Deploy to testnet
npm run deploy:abraham-seeds:base          # Deploy to mainnet
npm run update-root                       # Update Merkle root
npm run test:contracts                    # Run contract tests
npm run grant-creator:base-sepolia        # Grant CREATOR_ROLE
```

## Environment Variables

```bash
# L1 FirstWorks NFT (Ethereum Mainnet)
FIRSTWORKS_CONTRACT_ADDRESS=0x9734c959A5FEC7BaD8b0b560AD94F9740B90Efd8
FIRSTWORKS_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# L2 AbrahamSeeds (Base Sepolia)
L2_SEEDS_CONTRACT=0x0b95d25463b7a937b3df28368456f2c40e95c730
L2_GATING_CONTRACT=0x46657b69308d90a4756369094c5d78781f3f5979
L2_SEEDS_DEPLOYMENT_BLOCK=36452477
NETWORK=baseSepolia

# RPC URLs
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# Private Keys
RELAYER_PRIVATE_KEY=your_relayer_private_key
DEPLOYER_PRIVATE_KEY=your_deployer_private_key

# API Keys
ADMIN_KEY=your_admin_key
ALCHEMY_API_KEY=your_alchemy_key
BASESCAN_API_KEY=your_basescan_key
```

## API Integration

### Key Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/seeds` | List all seeds with metadata |
| `GET /api/seeds/:id` | Get seed details |
| `GET /api/seeds/count` | Total seed count |
| `GET /api/seeds/stats` | Current round stats, leader |
| `GET /api/seeds/config` | Contract configuration |
| `POST /api/blessings` | Submit blessing (gasless) |
| `POST /api/blessings/prepare` | Prepare blessing tx (user signs) |
| `GET /api/blessings/seed/:id` | Blessings for a seed |
| `GET /api/leaderboard` | User rankings |
| `POST /api/admin/select-winner` | Trigger winner selection |

## Security Considerations

### Trust Assumptions

1. **Snapshot Accuracy**
   - Backend generates accurate L1 ownership snapshots
   - Mitigation: Open source, verifiable code

2. **Role Privileges**
   - OPERATOR_ROLE can select winners
   - CREATOR_ROLE can submit seeds
   - Mitigation: Use multisig for role management

### Attack Vectors & Mitigations

| Attack | Mitigation |
|--------|------------|
| Fake Merkle Proof | Cryptographic verification on-chain |
| Snapshot Manipulation | Open source, multiple verifiers |
| Vote Manipulation | 24-hour snapshot delay |
| DoS on selectWinner | Permissionless call, anyone can trigger |

## Contract Interfaces

### AbrahamSeeds Key Functions

```solidity
// Seed Management
function submitSeed(string ipfsHash) external returns (uint256 seedId)
function getSeed(uint256 seedId) external view returns (Seed memory)
function getSeedCount() external view returns (uint256)

// Blessing
function blessSeedFor(uint256 seedId, address user, uint256[] tokenIds, bytes proof) external
function getSeedBlessingScore(uint256 seedId) external view returns (uint256)
function getUserDailyBlessingCount(address user) external view returns (uint256)

// Commandments
function addCommandmentFor(uint256 seedId, address user, string ipfsHash, uint256[] tokenIds, bytes proof) external

// Winner Selection
function selectDailyWinner() external returns (uint256 winningSeedId)
function getCurrentLeader() external view returns (uint256 seedId, uint256 score)
function getTimeUntilPeriodEnd() external view returns (uint256)
```

### MerkleGating Key Functions

```solidity
function merkleRoot() external view returns (bytes32)
function setMerkleRoot(bytes32 _root) external
function isValidProof(address user, uint256[] tokenIds, bytes32[] proof) external view returns (bool)
```

## Differences from Legacy TheSeeds Contract

| Feature | TheSeeds (Legacy) | AbrahamSeeds (New) |
|---------|------------------|-------------------|
| NFT Standard | ERC721 | ERC1155 (editions) |
| Gating | Built-in | Separate MerkleGating module |
| Inheritance | Standalone | EdenAgent base |
| Winner NFTs | Single mint | Edition-based |
| Configuration | Hardcoded | Constructor params |
| Role System | Owner-based | AccessControl roles |

## Resources

- [QUICKSTART.md](./QUICKSTART.md) - Quick start guide
- [API Reference](./docs/API_REFERENCE.md) - Complete API documentation
- [Deployment Guide](./docs/DEPLOYMENT_GUIDE.md) - Deployment instructions
- [Contract Source](./contracts/src/agents/abraham/AbrahamSeeds.sol) - Main contract

---

**Status**: Deployed to Base Sepolia and fully operational with API integration.
