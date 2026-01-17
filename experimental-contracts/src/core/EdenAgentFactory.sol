// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./EdenAgentCore.sol";
import "../interfaces/IEdenAgentProtocol.sol";

/**
 * @title EdenAgentFactory
 * @notice Factory for deploying and managing Eden agent contracts
 * @dev Supports two deployment modes:
 *      1. Direct deployment of EdenAgentCore (for simple agents)
 *      2. Clone deployment of registered implementations (for custom agents)
 *
 * The factory also serves as a registry of all deployed agents, making it easy
 * to discover and interact with agents in the Eden ecosystem.
 */
contract EdenAgentFactory is Ownable {
    using Clones for address;

    // ============ State Variables ============

    /// @notice Core implementation for cloning (default agent)
    address public coreImplementation;

    /// @notice Registered custom implementations (e.g., "abraham" => AbrahamSeeds address)
    mapping(string => address) public implementations;

    /// @notice All agent types that have been registered
    string[] public agentTypes;

    /// @notice All deployed agents
    address[] public deployedAgents;

    /// @notice Agent metadata
    mapping(address => AgentInfo) public agentInfo;

    /// @notice Check if an address is a deployed agent
    mapping(address => bool) public isAgent;

    struct AgentInfo {
        string agentType;       // "core" or custom type like "abraham"
        string name;            // Human-readable name
        address admin;          // Admin address
        uint256 deployedAt;     // Deployment timestamp
        bool isClone;           // Whether this is a clone or direct deployment
    }

    // ============ Events ============

    event AgentDeployed(
        address indexed agent,
        string indexed agentType,
        string name,
        address indexed admin,
        bool isClone
    );

    event ImplementationRegistered(
        string indexed agentType,
        address indexed implementation
    );

    event ImplementationUpdated(
        string indexed agentType,
        address indexed oldImplementation,
        address indexed newImplementation
    );

    event CoreImplementationUpdated(
        address indexed oldImplementation,
        address indexed newImplementation
    );

    // ============ Errors ============

    error InvalidImplementation();
    error AgentTypeNotRegistered();
    error AgentTypeAlreadyRegistered();
    error InvalidConfig();
    error DeploymentFailed();

    // ============ Constructor ============

    constructor(address admin_) Ownable(admin_) {}

    // ============ Deployment Functions ============

    /**
     * @notice Deploy a new agent using the core implementation
     * @param name Human-readable name for the agent
     * @param symbol NFT symbol for the agent
     * @param admin Admin address for the new agent
     * @param treasury Treasury address for the new agent
     * @param config Agent configuration
     * @param scoringConfig Scoring configuration
     * @return agent Address of the deployed agent
     */
    function createAgent(
        string calldata name,
        string calldata symbol,
        address admin,
        address treasury,
        IEdenAgentProtocol.AgentConfig calldata config,
        IEdenAgentProtocol.ScoringConfig calldata scoringConfig
    ) external returns (address agent) {
        // Deploy new EdenAgentCore directly
        agent = address(new EdenAgentCore(
            name,
            symbol,
            admin,
            treasury,
            config,
            scoringConfig
        ));

        _registerDeployedAgent(agent, "core", name, admin, false);

        emit AgentDeployed(agent, "core", name, admin, false);
    }

    /**
     * @notice Deploy a clone of a registered custom implementation
     * @param agentType The type of agent to deploy (must be registered)
     * @param name Human-readable name for the agent
     * @param admin Admin address for the new agent
     * @param initData Initialization calldata for the clone
     * @return agent Address of the deployed agent clone
     */
    function createAgentClone(
        string calldata agentType,
        string calldata name,
        address admin,
        bytes calldata initData
    ) external returns (address agent) {
        address implementation = implementations[agentType];
        if (implementation == address(0)) revert AgentTypeNotRegistered();

        // Deploy minimal proxy (clone)
        agent = implementation.clone();

        // Initialize the clone
        if (initData.length > 0) {
            (bool success,) = agent.call(initData);
            if (!success) revert DeploymentFailed();
        }

        _registerDeployedAgent(agent, agentType, name, admin, true);

        emit AgentDeployed(agent, agentType, name, admin, true);
    }

    /**
     * @notice Deploy a clone of the core implementation
     * @param name Human-readable name for the agent
     * @param admin Admin address for the new agent
     * @param initData Initialization calldata for the clone
     * @return agent Address of the deployed agent clone
     */
    function createCoreClone(
        string calldata name,
        address admin,
        bytes calldata initData
    ) external returns (address agent) {
        if (coreImplementation == address(0)) revert InvalidImplementation();

        // Deploy minimal proxy (clone)
        agent = coreImplementation.clone();

        // Initialize the clone
        if (initData.length > 0) {
            (bool success,) = agent.call(initData);
            if (!success) revert DeploymentFailed();
        }

        _registerDeployedAgent(agent, "core-clone", name, admin, true);

        emit AgentDeployed(agent, "core-clone", name, admin, true);
    }

    // ============ Registration Functions ============

    /**
     * @notice Register a custom implementation for cloning
     * @param agentType Unique identifier for the agent type
     * @param implementation Address of the implementation contract
     */
    function registerImplementation(
        string calldata agentType,
        address implementation
    ) external onlyOwner {
        if (implementation == address(0)) revert InvalidImplementation();
        if (implementations[agentType] != address(0)) revert AgentTypeAlreadyRegistered();

        implementations[agentType] = implementation;
        agentTypes.push(agentType);

        emit ImplementationRegistered(agentType, implementation);
    }

    /**
     * @notice Update an existing implementation
     * @param agentType The agent type to update
     * @param newImplementation New implementation address
     */
    function updateImplementation(
        string calldata agentType,
        address newImplementation
    ) external onlyOwner {
        if (newImplementation == address(0)) revert InvalidImplementation();
        address oldImplementation = implementations[agentType];
        if (oldImplementation == address(0)) revert AgentTypeNotRegistered();

        implementations[agentType] = newImplementation;

        emit ImplementationUpdated(agentType, oldImplementation, newImplementation);
    }

    /**
     * @notice Set the core implementation for cloning
     * @param implementation Address of the core implementation
     */
    function setCoreImplementation(address implementation) external onlyOwner {
        if (implementation == address(0)) revert InvalidImplementation();
        address oldImplementation = coreImplementation;
        coreImplementation = implementation;

        emit CoreImplementationUpdated(oldImplementation, implementation);
    }

    // ============ View Functions ============

    /**
     * @notice Get all deployed agents
     * @return agents Array of agent addresses
     */
    function getDeployedAgents() external view returns (address[] memory) {
        return deployedAgents;
    }

    /**
     * @notice Get total number of deployed agents
     * @return count Number of agents
     */
    function getAgentCount() external view returns (uint256) {
        return deployedAgents.length;
    }

    /**
     * @notice Get all registered agent types
     * @return types Array of agent type identifiers
     */
    function getAgentTypes() external view returns (string[] memory) {
        return agentTypes;
    }

    /**
     * @notice Get agents by type
     * @param agentType The type to filter by
     * @return agents Array of agent addresses of that type
     */
    function getAgentsByType(string calldata agentType) external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < deployedAgents.length; i++) {
            if (keccak256(bytes(agentInfo[deployedAgents[i]].agentType)) == keccak256(bytes(agentType))) {
                count++;
            }
        }

        address[] memory result = new address[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < deployedAgents.length; i++) {
            if (keccak256(bytes(agentInfo[deployedAgents[i]].agentType)) == keccak256(bytes(agentType))) {
                result[index++] = deployedAgents[i];
            }
        }

        return result;
    }

    /**
     * @notice Get agent info
     * @param agent The agent address
     * @return info The agent metadata
     */
    function getAgentInfo(address agent) external view returns (AgentInfo memory) {
        return agentInfo[agent];
    }

    /**
     * @notice Predict the address of a clone before deployment
     * @param implementation The implementation to clone
     * @param salt Unique salt for deterministic deployment
     * @return predicted The predicted address
     */
    function predictCloneAddress(
        address implementation,
        bytes32 salt
    ) external view returns (address) {
        return implementation.predictDeterministicAddress(salt, address(this));
    }

    // ============ Internal Functions ============

    function _registerDeployedAgent(
        address agent,
        string memory agentType,
        string memory name,
        address admin,
        bool isClone_
    ) internal {
        deployedAgents.push(agent);
        isAgent[agent] = true;
        agentInfo[agent] = AgentInfo({
            agentType: agentType,
            name: name,
            admin: admin,
            deployedAt: block.timestamp,
            isClone: isClone_
        });
    }
}
