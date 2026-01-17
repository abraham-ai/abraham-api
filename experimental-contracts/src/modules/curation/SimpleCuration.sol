// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../../interfaces/ICurationModule.sol";

/**
 * @title SimpleCuration
 * @notice No-op curation module that maintains traditional voting behavior
 * @dev This module is used when no share-based curation is desired.
 *      Reactions and messages are tracked but no shares are minted.
 *      This is the default/legacy behavior.
 *
 * Use Cases:
 *      - Simple voting/polling systems
 *      - Content ranking without economic incentives
 *      - Testing and development
 */
contract SimpleCuration is ICurationModule, Ownable {
    // ============ State Variables ============

    /// @notice The agent contract this module is attached to
    address public agentContract;

    /// @notice Curation configuration (mostly unused for simple curation)
    CurationConfig public curationConfig;

    /// @notice Session state tracking (minimal for simple curation)
    mapping(uint256 => SessionCurationState) private _sessionStates;

    // ============ Errors ============

    error OnlyAgentContract();
    error NotSupported();

    // ============ Modifiers ============

    modifier onlyAgent() {
        if (msg.sender != agentContract) revert OnlyAgentContract();
        _;
    }

    // ============ Constructor ============

    constructor(address admin_, address agentContract_) Ownable(admin_) {
        agentContract = agentContract_;

        // Set minimal config
        curationConfig = CurationConfig({
            creatorShareBps: 0,
            protocolFeeBps: 0,
            earlyContributorBonus: 0,
            reactionShareAmount: 0,
            messageShareAmount: 0,
            bondingCurveSlope: 0,
            bondingCurveIntercept: 0,
            minStakeAmount: 0,
            enableSecondaryTrading: false
        });
    }

    // ============ Core Hooks ============

    /**
     * @inheritdoc ICurationModule
     * @dev No-op for simple curation - just emits event for tracking
     */
    function onReaction(
        uint256 sessionId,
        address reactor,
        uint256 reactionCount,
        uint256 /* ethPaid */
    ) external override onlyAgent {
        // Track reaction in state (for potential future use)
        _sessionStates[sessionId].totalShares += reactionCount;

        // Emit event for off-chain tracking
        emit SharesMinted(sessionId, reactor, 0, block.timestamp);
    }

    /**
     * @inheritdoc ICurationModule
     * @dev No-op for simple curation
     */
    function onMessage(
        uint256 sessionId,
        address sender,
        uint256 /* ethPaid */
    ) external override onlyAgent {
        emit SharesMinted(sessionId, sender, 0, block.timestamp);
    }

    /**
     * @inheritdoc ICurationModule
     * @dev No-op for simple curation
     */
    function onSessionSelected(
        uint256 sessionId,
        uint256 /* period */
    ) external override onlyAgent {
        _sessionStates[sessionId].isFinalized = true;
    }

    /**
     * @inheritdoc ICurationModule
     */
    function onSessionCreated(
        uint256 sessionId,
        address /* creator */
    ) external override onlyAgent {
        _sessionStates[sessionId] = SessionCurationState({
            totalShares: 0,
            totalStaked: 0,
            rewardPool: 0,
            lastPricePerShare: 0,
            isFinalized: false
        });
    }

    // ============ Trading Functions (Not Supported) ============

    function buyShares(uint256, uint256) external payable override returns (uint256) {
        revert NotSupported();
    }

    function sellShares(uint256, uint256, uint256) external override returns (uint256) {
        revert NotSupported();
    }

    function getCurrentPrice(uint256) external pure override returns (uint256) {
        return 0;
    }

    function getBuyPrice(uint256, uint256) external pure override returns (uint256) {
        return 0;
    }

    function getSellPrice(uint256, uint256) external pure override returns (uint256) {
        return 0;
    }

    // ============ Staking Functions (Not Supported) ============

    function stake(uint256) external payable override {
        revert NotSupported();
    }

    function unstake(uint256, uint256) external override {
        revert NotSupported();
    }

    function getStakedAmount(uint256, address) external pure override returns (uint256) {
        return 0;
    }

    // ============ Rewards Functions (Not Supported) ============

    function claimRewards(uint256) external pure override returns (uint256) {
        return 0;
    }

    function getClaimableRewards(uint256, address) external pure override returns (uint256) {
        return 0;
    }

    // ============ View Functions ============

    function getShares(uint256, address) external pure override returns (uint256) {
        return 0;
    }

    function getTotalShares(uint256 sessionId) external view override returns (uint256) {
        return _sessionStates[sessionId].totalShares;
    }

    function getSessionState(uint256 sessionId) external view override returns (SessionCurationState memory) {
        return _sessionStates[sessionId];
    }

    function getCurationType() external pure override returns (CurationType) {
        return CurationType.SIMPLE;
    }

    function getCurationConfig() external view override returns (CurationConfig memory) {
        return curationConfig;
    }

    function getShareTokenContract() external pure override returns (address) {
        return address(0);
    }

    // ============ Admin Functions ============

    function setAgentContract(address newAgent) external onlyOwner {
        agentContract = newAgent;
    }
}
