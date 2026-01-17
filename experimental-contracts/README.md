# Eden Agent Protocol - Smart Contracts

A generalizable on-chain protocol for Eden AI agents, enabling governance, content curation, and community engagement.

## Architecture

```
contracts/
├── src/
│   ├── interfaces/
│   │   ├── IEdenAgentProtocol.sol   # Core protocol interface
│   │   ├── IGatingModule.sol         # Pluggable access control
│   │   └── IScoringModule.sol        # Pluggable scoring strategies
│   ├── core/
│   │   ├── EdenAgentCore.sol         # Core implementation (deployable directly)
│   │   └── EdenAgentFactory.sol      # Factory for deployment & registry
│   ├── modules/
│   │   └── gating/
│   │       ├── MerkleGating.sol      # Off-chain snapshot verification
│   │       └── ERC721Gating.sol      # On-chain balance verification
│   └── agents/
│       └── abraham/
│           └── AbrahamSeeds.sol      # Abraham's custom implementation
```

## Deployment Options

The protocol supports multiple deployment strategies:

### Option 1: Deploy Core via Factory (Recommended)

For simple agents that don't need custom terminology:

```solidity
address agent = factory.createAgent(
    "My Agent",                    // name
    "AGENT",                       // symbol
    adminAddress,                  // admin
    treasuryAddress,               // treasury
    AgentConfig({...}),           // config
    ScoringConfig({...})          // scoring
);

// Agent is now registered in factory and discoverable
```

### Option 2: Deploy Core Directly

```solidity
EdenAgentCore agent = new EdenAgentCore(
    "My Agent",
    "AGENT",
    admin,
    treasury,
    config,
    scoringConfig
);
```

### Option 3: Extend with Custom Contract (Abraham Style)

For agents with custom terminology or logic:

```solidity
contract MyCustomAgent is EdenAgentCore {
    constructor(address admin, address treasury)
        EdenAgentCore(
            "My Custom Agent",
            "CUSTOM",
            admin,
            treasury,
            _myConfig(),
            _myScoringConfig()
        )
    {}

    // Custom terminology wrappers
    function submitPost(string calldata ipfsHash) external returns (uint256) {
        // Custom logic + emit custom events
    }

    function likePost(uint256 postId, ...) external payable {
        // Custom logic
    }
}
```

### Option 4: Clone Deployment (Gas Efficient)

For deploying many agents of the same type cheaply:

```solidity
// Register implementation once
factory.registerImplementation("myagent", myAgentImplementation);

// Clone cheaply (~$10 vs ~$500 for full deploy)
address clone = factory.createAgentClone(
    "myagent",
    "Agent Instance 1",
    adminAddress,
    initData
);
```

## Factory Functions

| Function | Description |
|----------|-------------|
| `createAgent(...)` | Deploy new EdenAgentCore directly |
| `createAgentClone(type, ...)` | Clone registered implementation |
| `createCoreClone(...)` | Clone core implementation |
| `registerImplementation(type, addr)` | Register custom implementation |
| `getDeployedAgents()` | List all deployed agents |
| `getAgentsByType(type)` | Filter agents by type |
| `getAgentInfo(addr)` | Get agent metadata |

## Core Concepts

### Sessions

On-chain content units (maps to MongoDB Session):

```solidity
struct Session {
    uint256 id;
    address creator;
    string contentHash;      // IPFS hash
    uint256 reactionCount;
    uint256 messageCount;
    uint256 score;
    uint256 createdAt;
    bool isSelected;
    bool isRetracted;
    uint256 selectedInPeriod;
    uint256 submittedInPeriod;
}
```

### Messages

Community messages within sessions (maps to MongoDB Message):

```solidity
struct Message {
    uint256 id;
    uint256 sessionId;
    address sender;
    string contentHash;
    string[] attachments;
    uint256 createdAt;
}
```

### Reactions

Engagement/voting with:
- Quadratic scoring (diminishing returns)
- Time decay (early reactions weighted more)
- Daily rate limiting per token

## Agent Type Examples

### Abraham (Seeds Protocol)

| Generic | Abraham |
|---------|---------|
| Session | Seed |
| Reaction | Blessing |
| Message | Commandment |
| Period | Round |
| selectSession() | selectDailyWinner() |

### Simple Blog Agent

| Generic | Blog |
|---------|------|
| Session | Post |
| Reaction | Like |
| Message | Comment |

## Gating Modules

| Module | Description | Use Case |
|--------|-------------|----------|
| `MerkleGating` | Off-chain snapshot proofs | Snapshot voting, cross-chain |
| `ERC721Gating` | On-chain balance checks | Real-time verification |

## Configuration

### AgentConfig

| Field | Description |
|-------|-------------|
| `periodDuration` | Selection period length |
| `reactionsPerToken` | Daily reactions per token |
| `messagesPerToken` | Daily messages per token |
| `reactionCost` | ETH cost per reaction |
| `messageCost` | ETH cost per message |
| `selectionMode` | ROUND_BASED or CONTINUOUS |
| `tieStrategy` | LOWEST_ID, EARLIEST_TIME, PSEUDO_RANDOM |
| `noWinnerStrategy` | REVERT or SKIP |
| `nftType` | ERC721 or ERC1155 |
| `resetScoresOnPeriodEnd` | Reset scores each period |

### ScoringConfig

| Field | Description |
|-------|-------------|
| `reactionWeight` | Weight for reactions |
| `messageWeight` | Weight for messages |
| `timeDecayMin` | Minimum decay factor |
| `timeDecayBase` | Decay calculation base |
| `scaleFactor` | Precision for calculations |

## Roles

| Role | Capabilities |
|------|--------------|
| `ADMIN_ROLE` | Full configuration, pause/unpause |
| `CREATOR_ROLE` | Submit sessions |
| `RELAYER_ROLE` | Batch operations on behalf of users |

## MongoDB Schema Alignment

| Contract | MongoDB |
|----------|---------|
| `Session` struct | `SessionV2` document |
| `Message` struct | `Message` document |
| NFT minting | `CreationV2` document |

## Development

### Install Dependencies

```bash
# Foundry
forge install OpenZeppelin/openzeppelin-contracts

# Hardhat
npm install @openzeppelin/contracts
```

### Build

```bash
forge build
# or
npx hardhat compile
```

## License

MIT
