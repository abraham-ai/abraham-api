// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../../interfaces/ICurationModule.sol";

/**
 * @title CurationMarket
 * @notice Flexible curation market with configurable features
 * @dev All features are optional and can be toggled on/off:
 *
 *      Features:
 *      - Contribution Shares: Mint ERC1155 shares when users react/message
 *      - Bonding Curve: Enable buy/sell of shares with price discovery
 *      - Staking: Allow users to stake ETH on sessions
 *      - Rewards: Distribute rewards when sessions are selected
 *
 *      Example Configurations:
 *      1. Simple Shares: enableShares=true, enableBondingCurve=false
 *         → Users get shares on contribution, no trading
 *
 *      2. Full Market: enableShares=true, enableBondingCurve=true, enableRewards=true
 *         → Complete curation market with trading and rewards
 *
 *      3. Staking Only: enableShares=false, enableStaking=true
 *         → Prediction market style - stake on winners
 *
 *      4. Shares + Rewards: enableShares=true, enableRewards=true
 *         → Contributors get shares and rewards, no trading
 */
contract CurationMarket is ICurationModule, ERC1155, AccessControl, ReentrancyGuard {
    // ============ Constants ============

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant PRECISION = 1e18;

    // ============ Feature Flags ============

    struct FeatureFlags {
        bool enableShares;           // Mint shares on contribution
        bool enableBondingCurve;     // Allow buy/sell trading
        bool enableStaking;          // Allow staking on sessions
        bool enableRewards;          // Distribute rewards to contributors
        bool enableEarlyBonus;       // Bonus for early contributors
        bool enableSecondaryTransfers; // Allow ERC1155 transfers
    }

    // ============ Share Configuration ============

    struct ShareConfig {
        uint256 reactionShareAmount;    // Shares per reaction (default: 1e18)
        uint256 messageShareAmount;     // Shares per message (default: 2e18)
        uint256 earlyBonusMultiplier;   // Early contributor bonus (1000 = 1x, 2000 = 2x)
        uint256 earlyBonusDecayPeriod;  // Seconds over which bonus decays to 1x
    }

    // ============ Bonding Curve Configuration ============

    struct BondingCurveConfig {
        uint256 initialPrice;        // Starting price per share (wei)
        uint256 slope;               // Price increase per share (wei)
        uint256 tradingFeeBps;       // Fee on trades (basis points)
        uint256 creatorFeeBps;       // Creator's share of trading fees
    }

    // ============ Staking Configuration ============

    struct StakingConfig {
        uint256 minStakeAmount;      // Minimum stake (wei)
        uint256 unstakePenaltyBps;   // Penalty for early unstake (basis points)
        uint256 lockPeriod;          // Lock period in seconds (0 = no lock)
    }

    // ============ Rewards Configuration ============

    struct RewardsConfig {
        uint256 creatorShareBps;     // Creator's share of rewards (basis points)
        uint256 protocolFeeBps;      // Protocol fee (basis points)
        address protocolTreasury;    // Where protocol fees go
    }

    // ============ Session State ============

    struct SessionMarketState {
        uint256 totalShares;         // Total shares minted/bought
        uint256 totalStaked;         // Total ETH staked
        uint256 rewardPool;          // Accumulated rewards
        uint256 tradingVolume;       // Total trading volume
        uint256 curveSupply;         // Shares from bonding curve
        uint256 createdAt;           // Session creation time
        address creator;             // Session creator
        bool isFinalized;            // Rewards distributed
    }

    struct UserPosition {
        uint256 sharesFromContribution; // Shares earned from reactions/messages
        uint256 sharesFromTrading;      // Shares bought via bonding curve
        uint256 staked;                 // Amount staked
        uint256 stakedAt;               // When user staked
        uint256 claimedRewards;         // Already claimed
    }

    // ============ State Variables ============

    /// @notice Feature flags
    FeatureFlags public features;

    /// @notice Share configuration
    ShareConfig public shareConfig;

    /// @notice Bonding curve configuration
    BondingCurveConfig public bondingCurveConfig;

    /// @notice Staking configuration
    StakingConfig public stakingConfig;

    /// @notice Rewards configuration
    RewardsConfig public rewardsConfig;

    /// @notice Session market state
    mapping(uint256 => SessionMarketState) public sessionMarkets;

    /// @notice User positions per session
    mapping(uint256 => mapping(address => UserPosition)) public userPositions;

    /// @notice List of stakers per session (for reward distribution)
    mapping(uint256 => address[]) public sessionStakers;

    /// @notice List of contributors per session
    mapping(uint256 => address[]) public sessionContributors;

    /// @notice Whether user is already in contributor list
    mapping(uint256 => mapping(address => bool)) public isContributor;

    // ============ Events ============

    event FeatureToggled(string feature, bool enabled);
    event ShareConfigUpdated(uint256 reactionAmount, uint256 messageAmount);
    event BondingCurveConfigUpdated(uint256 initialPrice, uint256 slope);
    event StakingConfigUpdated(uint256 minStake, uint256 penalty);
    event RewardsConfigUpdated(uint256 creatorShare, uint256 protocolFee);

    // ============ Errors ============

    error FeatureDisabled();
    error InsufficientPayment();
    error InsufficientShares();
    error InsufficientStake();
    error StakeLocked();
    error SlippageExceeded();
    error AlreadyFinalized();
    error NotFinalized();
    error NothingToClaim();
    error TransfersDisabled();
    error InvalidConfig();

    // ============ Constructor ============

    constructor(
        address admin_,
        string memory uri_,
        FeatureFlags memory features_,
        ShareConfig memory shareConfig_,
        BondingCurveConfig memory bondingCurveConfig_,
        StakingConfig memory stakingConfig_,
        RewardsConfig memory rewardsConfig_
    ) ERC1155(uri_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(ADMIN_ROLE, admin_);

        features = features_;
        shareConfig = shareConfig_;
        bondingCurveConfig = bondingCurveConfig_;
        stakingConfig = stakingConfig_;
        rewardsConfig = rewardsConfig_;
    }

    // ============ Core Hooks (called by agent contract) ============

    /**
     * @inheritdoc ICurationModule
     */
    function onReaction(
        uint256 sessionId,
        address reactor,
        uint256 reactionCount,
        uint256 ethPaid
    ) external override onlyRole(AGENT_ROLE) {
        SessionMarketState storage market = sessionMarkets[sessionId];

        // Add to reward pool
        if (features.enableRewards) {
            market.rewardPool += ethPaid;
        }

        // Mint shares if enabled
        if (features.enableShares) {
            uint256 baseShares = reactionCount * shareConfig.reactionShareAmount;
            uint256 shares = _applyEarlyBonus(sessionId, baseShares);

            _mintShares(sessionId, reactor, shares, true);
        }

        // Track contributor
        if (!isContributor[sessionId][reactor]) {
            sessionContributors[sessionId].push(reactor);
            isContributor[sessionId][reactor] = true;
        }
    }

    /**
     * @inheritdoc ICurationModule
     */
    function onMessage(
        uint256 sessionId,
        address sender,
        uint256 ethPaid
    ) external override onlyRole(AGENT_ROLE) {
        SessionMarketState storage market = sessionMarkets[sessionId];

        // Add to reward pool
        if (features.enableRewards) {
            market.rewardPool += ethPaid;
        }

        // Mint shares if enabled
        if (features.enableShares) {
            uint256 baseShares = shareConfig.messageShareAmount;
            uint256 shares = _applyEarlyBonus(sessionId, baseShares);

            _mintShares(sessionId, sender, shares, true);
        }

        // Track contributor
        if (!isContributor[sessionId][sender]) {
            sessionContributors[sessionId].push(sender);
            isContributor[sessionId][sender] = true;
        }
    }

    /**
     * @inheritdoc ICurationModule
     */
    function onSessionSelected(
        uint256 sessionId,
        uint256 /* period */
    ) external override onlyRole(AGENT_ROLE) {
        SessionMarketState storage market = sessionMarkets[sessionId];
        if (market.isFinalized) revert AlreadyFinalized();

        market.isFinalized = true;

        if (features.enableRewards && market.rewardPool > 0) {
            _distributeRewards(sessionId);
        }
    }

    /**
     * @inheritdoc ICurationModule
     */
    function onSessionCreated(
        uint256 sessionId,
        address creator
    ) external override onlyRole(AGENT_ROLE) {
        sessionMarkets[sessionId] = SessionMarketState({
            totalShares: 0,
            totalStaked: 0,
            rewardPool: 0,
            tradingVolume: 0,
            curveSupply: 0,
            createdAt: block.timestamp,
            creator: creator,
            isFinalized: false
        });
    }

    // ============ Bonding Curve Trading ============

    /**
     * @inheritdoc ICurationModule
     */
    function buyShares(
        uint256 sessionId,
        uint256 minShares
    ) external payable override nonReentrant returns (uint256 sharesBought) {
        if (!features.enableBondingCurve) revert FeatureDisabled();

        SessionMarketState storage market = sessionMarkets[sessionId];

        // Calculate shares for ETH sent
        uint256 fee = (msg.value * bondingCurveConfig.tradingFeeBps) / BPS_DENOMINATOR;
        uint256 netAmount = msg.value - fee;

        sharesBought = _calculateSharesForEth(sessionId, netAmount);
        if (sharesBought < minShares) revert SlippageExceeded();

        // Distribute fee
        if (fee > 0) {
            uint256 creatorFee = (fee * bondingCurveConfig.creatorFeeBps) / BPS_DENOMINATOR;
            uint256 protocolFee = fee - creatorFee;

            if (creatorFee > 0) {
                payable(market.creator).transfer(creatorFee);
            }
            if (protocolFee > 0 && rewardsConfig.protocolTreasury != address(0)) {
                payable(rewardsConfig.protocolTreasury).transfer(protocolFee);
            }
        }

        // Mint shares
        market.curveSupply += sharesBought;
        market.tradingVolume += msg.value;
        _mintShares(sessionId, msg.sender, sharesBought, false);

        emit SharesPurchased(sessionId, msg.sender, sharesBought, msg.value, getCurrentPrice(sessionId));
    }

    /**
     * @inheritdoc ICurationModule
     */
    function sellShares(
        uint256 sessionId,
        uint256 shareAmount,
        uint256 minEth
    ) external override nonReentrant returns (uint256 ethReceived) {
        if (!features.enableBondingCurve) revert FeatureDisabled();

        UserPosition storage position = userPositions[sessionId][msg.sender];
        if (position.sharesFromTrading < shareAmount) revert InsufficientShares();

        SessionMarketState storage market = sessionMarkets[sessionId];

        // Calculate ETH for shares
        uint256 grossEth = _calculateEthForShares(sessionId, shareAmount);
        uint256 fee = (grossEth * bondingCurveConfig.tradingFeeBps) / BPS_DENOMINATOR;
        ethReceived = grossEth - fee;

        if (ethReceived < minEth) revert SlippageExceeded();

        // Burn shares
        _burn(msg.sender, sessionId, shareAmount);
        position.sharesFromTrading -= shareAmount;
        market.curveSupply -= shareAmount;
        market.totalShares -= shareAmount;
        market.tradingVolume += grossEth;

        // Transfer ETH
        payable(msg.sender).transfer(ethReceived);

        // Distribute fee
        if (fee > 0) {
            uint256 creatorFee = (fee * bondingCurveConfig.creatorFeeBps) / BPS_DENOMINATOR;
            if (creatorFee > 0) {
                payable(market.creator).transfer(creatorFee);
            }
        }

        emit SharesSold(sessionId, msg.sender, shareAmount, ethReceived, getCurrentPrice(sessionId));
    }

    /**
     * @inheritdoc ICurationModule
     */
    function getCurrentPrice(uint256 sessionId) public view override returns (uint256) {
        if (!features.enableBondingCurve) return 0;

        SessionMarketState storage market = sessionMarkets[sessionId];
        // Linear bonding curve: price = initialPrice + slope * supply
        return bondingCurveConfig.initialPrice + (bondingCurveConfig.slope * market.curveSupply) / PRECISION;
    }

    /**
     * @inheritdoc ICurationModule
     */
    function getBuyPrice(uint256 sessionId, uint256 shareAmount) external view override returns (uint256) {
        if (!features.enableBondingCurve) return 0;

        SessionMarketState storage market = sessionMarkets[sessionId];
        uint256 startSupply = market.curveSupply;
        uint256 endSupply = startSupply + shareAmount;

        // Integral of linear curve: area under curve
        uint256 startPrice = bondingCurveConfig.initialPrice + (bondingCurveConfig.slope * startSupply) / PRECISION;
        uint256 endPrice = bondingCurveConfig.initialPrice + (bondingCurveConfig.slope * endSupply) / PRECISION;

        // Trapezoidal area
        return ((startPrice + endPrice) * shareAmount) / (2 * PRECISION);
    }

    /**
     * @inheritdoc ICurationModule
     */
    function getSellPrice(uint256 sessionId, uint256 shareAmount) external view override returns (uint256) {
        if (!features.enableBondingCurve) return 0;

        SessionMarketState storage market = sessionMarkets[sessionId];
        if (market.curveSupply < shareAmount) return 0;

        uint256 startSupply = market.curveSupply;
        uint256 endSupply = startSupply - shareAmount;

        uint256 startPrice = bondingCurveConfig.initialPrice + (bondingCurveConfig.slope * startSupply) / PRECISION;
        uint256 endPrice = bondingCurveConfig.initialPrice + (bondingCurveConfig.slope * endSupply) / PRECISION;

        uint256 grossAmount = ((startPrice + endPrice) * shareAmount) / (2 * PRECISION);
        uint256 fee = (grossAmount * bondingCurveConfig.tradingFeeBps) / BPS_DENOMINATOR;

        return grossAmount - fee;
    }

    // ============ Staking ============

    /**
     * @inheritdoc ICurationModule
     */
    function stake(uint256 sessionId) external payable override nonReentrant {
        if (!features.enableStaking) revert FeatureDisabled();
        if (msg.value < stakingConfig.minStakeAmount) revert InsufficientPayment();

        SessionMarketState storage market = sessionMarkets[sessionId];
        if (market.isFinalized) revert AlreadyFinalized();

        UserPosition storage position = userPositions[sessionId][msg.sender];

        if (position.staked == 0) {
            sessionStakers[sessionId].push(msg.sender);
        }

        position.staked += msg.value;
        position.stakedAt = block.timestamp;
        market.totalStaked += msg.value;

        emit Staked(sessionId, msg.sender, msg.value);
    }

    /**
     * @inheritdoc ICurationModule
     */
    function unstake(uint256 sessionId, uint256 amount) external override nonReentrant {
        if (!features.enableStaking) revert FeatureDisabled();

        UserPosition storage position = userPositions[sessionId][msg.sender];
        if (position.staked < amount) revert InsufficientStake();

        // Check lock period
        if (stakingConfig.lockPeriod > 0) {
            if (block.timestamp < position.stakedAt + stakingConfig.lockPeriod) {
                revert StakeLocked();
            }
        }

        SessionMarketState storage market = sessionMarkets[sessionId];

        // Apply penalty if session not finalized
        uint256 penalty = 0;
        if (!market.isFinalized && stakingConfig.unstakePenaltyBps > 0) {
            penalty = (amount * stakingConfig.unstakePenaltyBps) / BPS_DENOMINATOR;
            market.rewardPool += penalty; // Penalty goes to reward pool
        }

        position.staked -= amount;
        market.totalStaked -= amount;

        uint256 netAmount = amount - penalty;
        payable(msg.sender).transfer(netAmount);

        emit Unstaked(sessionId, msg.sender, amount);
    }

    /**
     * @inheritdoc ICurationModule
     */
    function getStakedAmount(uint256 sessionId, address user) external view override returns (uint256) {
        return userPositions[sessionId][user].staked;
    }

    // ============ Rewards ============

    /**
     * @inheritdoc ICurationModule
     */
    function claimRewards(uint256 sessionId) external override nonReentrant returns (uint256 amount) {
        if (!features.enableRewards) revert FeatureDisabled();

        SessionMarketState storage market = sessionMarkets[sessionId];
        if (!market.isFinalized) revert NotFinalized();

        amount = _calculateClaimableRewards(sessionId, msg.sender);
        if (amount == 0) revert NothingToClaim();

        UserPosition storage position = userPositions[sessionId][msg.sender];
        position.claimedRewards += amount;

        payable(msg.sender).transfer(amount);

        emit RewardsClaimed(sessionId, msg.sender, amount);
    }

    /**
     * @inheritdoc ICurationModule
     */
    function getClaimableRewards(uint256 sessionId, address user) external view override returns (uint256) {
        if (!features.enableRewards) return 0;

        SessionMarketState storage market = sessionMarkets[sessionId];
        if (!market.isFinalized) return 0;

        return _calculateClaimableRewards(sessionId, user);
    }

    // ============ View Functions ============

    /**
     * @inheritdoc ICurationModule
     */
    function getShares(uint256 sessionId, address user) external view override returns (uint256) {
        return balanceOf(user, sessionId);
    }

    /**
     * @inheritdoc ICurationModule
     */
    function getTotalShares(uint256 sessionId) external view override returns (uint256) {
        return sessionMarkets[sessionId].totalShares;
    }

    /**
     * @inheritdoc ICurationModule
     */
    function getSessionState(uint256 sessionId) external view override returns (SessionCurationState memory) {
        SessionMarketState storage market = sessionMarkets[sessionId];
        return SessionCurationState({
            totalShares: market.totalShares,
            totalStaked: market.totalStaked,
            rewardPool: market.rewardPool,
            lastPricePerShare: getCurrentPrice(sessionId),
            isFinalized: market.isFinalized
        });
    }

    /**
     * @inheritdoc ICurationModule
     */
    function getCurationType() external view override returns (CurationType) {
        if (features.enableBondingCurve) return CurationType.BONDING_CURVE;
        if (features.enableStaking) return CurationType.STAKING_REWARDS;
        if (features.enableShares) return CurationType.CONTRIBUTION_SHARES;
        return CurationType.SIMPLE;
    }

    /**
     * @inheritdoc ICurationModule
     */
    function getCurationConfig() external view override returns (CurationConfig memory) {
        return CurationConfig({
            creatorShareBps: rewardsConfig.creatorShareBps,
            protocolFeeBps: rewardsConfig.protocolFeeBps,
            earlyContributorBonus: shareConfig.earlyBonusMultiplier,
            reactionShareAmount: shareConfig.reactionShareAmount,
            messageShareAmount: shareConfig.messageShareAmount,
            bondingCurveSlope: bondingCurveConfig.slope,
            bondingCurveIntercept: bondingCurveConfig.initialPrice,
            minStakeAmount: stakingConfig.minStakeAmount,
            enableSecondaryTrading: features.enableSecondaryTransfers
        });
    }

    /**
     * @inheritdoc ICurationModule
     */
    function getShareTokenContract() external view override returns (address) {
        return address(this);
    }

    /// @notice Get user's full position
    function getUserPosition(uint256 sessionId, address user) external view returns (UserPosition memory) {
        return userPositions[sessionId][user];
    }

    /// @notice Get feature flags
    function getFeatures() external view returns (FeatureFlags memory) {
        return features;
    }

    /// @notice Get number of contributors for a session
    function getContributorCount(uint256 sessionId) external view returns (uint256) {
        return sessionContributors[sessionId].length;
    }

    // ============ Admin Functions ============

    /// @notice Toggle a feature on/off
    function setFeature(string calldata featureName, bool enabled) external onlyRole(ADMIN_ROLE) {
        bytes32 hash = keccak256(bytes(featureName));

        if (hash == keccak256("shares")) {
            features.enableShares = enabled;
        } else if (hash == keccak256("bondingCurve")) {
            features.enableBondingCurve = enabled;
        } else if (hash == keccak256("staking")) {
            features.enableStaking = enabled;
        } else if (hash == keccak256("rewards")) {
            features.enableRewards = enabled;
        } else if (hash == keccak256("earlyBonus")) {
            features.enableEarlyBonus = enabled;
        } else if (hash == keccak256("secondaryTransfers")) {
            features.enableSecondaryTransfers = enabled;
        } else {
            revert InvalidConfig();
        }

        emit FeatureToggled(featureName, enabled);
    }

    /// @notice Update share configuration
    function setShareConfig(ShareConfig calldata config_) external onlyRole(ADMIN_ROLE) {
        shareConfig = config_;
        emit ShareConfigUpdated(config_.reactionShareAmount, config_.messageShareAmount);
    }

    /// @notice Update bonding curve configuration
    function setBondingCurveConfig(BondingCurveConfig calldata config_) external onlyRole(ADMIN_ROLE) {
        bondingCurveConfig = config_;
        emit BondingCurveConfigUpdated(config_.initialPrice, config_.slope);
    }

    /// @notice Update staking configuration
    function setStakingConfig(StakingConfig calldata config_) external onlyRole(ADMIN_ROLE) {
        stakingConfig = config_;
        emit StakingConfigUpdated(config_.minStakeAmount, config_.unstakePenaltyBps);
    }

    /// @notice Update rewards configuration
    function setRewardsConfig(RewardsConfig calldata config_) external onlyRole(ADMIN_ROLE) {
        rewardsConfig = config_;
        emit RewardsConfigUpdated(config_.creatorShareBps, config_.protocolFeeBps);
    }

    /// @notice Grant agent role to a contract
    function setAgentContract(address agent) external onlyRole(ADMIN_ROLE) {
        _grantRole(AGENT_ROLE, agent);
    }

    // ============ Internal Functions ============

    function _mintShares(
        uint256 sessionId,
        address recipient,
        uint256 amount,
        bool isContribution
    ) internal {
        _mint(recipient, sessionId, amount, "");

        sessionMarkets[sessionId].totalShares += amount;

        UserPosition storage position = userPositions[sessionId][recipient];
        if (isContribution) {
            position.sharesFromContribution += amount;
        } else {
            position.sharesFromTrading += amount;
        }

        emit SharesMinted(sessionId, recipient, amount, block.timestamp);
    }

    function _applyEarlyBonus(uint256 sessionId, uint256 baseShares) internal view returns (uint256) {
        if (!features.enableEarlyBonus) return baseShares;

        SessionMarketState storage market = sessionMarkets[sessionId];
        uint256 elapsed = block.timestamp - market.createdAt;

        if (elapsed >= shareConfig.earlyBonusDecayPeriod) {
            return baseShares; // No bonus after decay period
        }

        // Linear decay: bonus goes from earlyBonusMultiplier to 1000 (1x)
        uint256 bonusRange = shareConfig.earlyBonusMultiplier - 1000;
        uint256 remainingBonus = bonusRange * (shareConfig.earlyBonusDecayPeriod - elapsed) / shareConfig.earlyBonusDecayPeriod;
        uint256 currentMultiplier = 1000 + remainingBonus;

        return (baseShares * currentMultiplier) / 1000;
    }

    function _calculateSharesForEth(uint256 sessionId, uint256 ethAmount) internal view returns (uint256) {
        SessionMarketState storage market = sessionMarkets[sessionId];
        uint256 currentSupply = market.curveSupply;

        // Solve: ethAmount = integral of (initialPrice + slope * x) from currentSupply to currentSupply + shares
        // This is: ethAmount = initialPrice * shares + slope * (shares^2 / 2 + currentSupply * shares)
        // Simplified quadratic: (slope/2) * shares^2 + (initialPrice + slope * currentSupply) * shares - ethAmount = 0

        uint256 a = bondingCurveConfig.slope / 2;
        uint256 b = bondingCurveConfig.initialPrice + (bondingCurveConfig.slope * currentSupply) / PRECISION;

        if (a == 0) {
            // Linear case
            return (ethAmount * PRECISION) / b;
        }

        // Quadratic formula: shares = (-b + sqrt(b^2 + 4*a*ethAmount)) / (2*a)
        uint256 discriminant = b * b + 4 * a * ethAmount * PRECISION;
        uint256 sqrtDiscriminant = _sqrt(discriminant);

        return ((sqrtDiscriminant - b) * PRECISION) / (2 * a);
    }

    function _calculateEthForShares(uint256 sessionId, uint256 shareAmount) internal view returns (uint256) {
        SessionMarketState storage market = sessionMarkets[sessionId];
        uint256 currentSupply = market.curveSupply;
        uint256 endSupply = currentSupply - shareAmount;

        uint256 startPrice = bondingCurveConfig.initialPrice + (bondingCurveConfig.slope * currentSupply) / PRECISION;
        uint256 endPrice = bondingCurveConfig.initialPrice + (bondingCurveConfig.slope * endSupply) / PRECISION;

        return ((startPrice + endPrice) * shareAmount) / (2 * PRECISION);
    }

    function _distributeRewards(uint256 sessionId) internal {
        SessionMarketState storage market = sessionMarkets[sessionId];
        uint256 totalReward = market.rewardPool;

        // Protocol fee
        uint256 protocolFee = (totalReward * rewardsConfig.protocolFeeBps) / BPS_DENOMINATOR;
        if (protocolFee > 0 && rewardsConfig.protocolTreasury != address(0)) {
            payable(rewardsConfig.protocolTreasury).transfer(protocolFee);
        }

        // Creator share
        uint256 creatorShare = (totalReward * rewardsConfig.creatorShareBps) / BPS_DENOMINATOR;
        if (creatorShare > 0) {
            payable(market.creator).transfer(creatorShare);
        }

        // Remaining goes to contributor pool (claimed individually)
        uint256 contributorPool = totalReward - protocolFee - creatorShare;
        market.rewardPool = contributorPool;

        emit RewardsDistributed(sessionId, totalReward, creatorShare, contributorPool);
    }

    function _calculateClaimableRewards(uint256 sessionId, address user) internal view returns (uint256) {
        SessionMarketState storage market = sessionMarkets[sessionId];
        UserPosition storage position = userPositions[sessionId][user];

        if (market.totalShares == 0) return 0;

        uint256 userShares = balanceOf(user, sessionId);
        uint256 totalReward = (market.rewardPool * userShares) / market.totalShares;

        if (totalReward <= position.claimedRewards) return 0;
        return totalReward - position.claimedRewards;
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;

        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // ============ ERC1155 Overrides ============

    /**
     * @dev Override to control transfers based on feature flag
     */
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal virtual override {
        // Allow minting and burning
        if (from != address(0) && to != address(0)) {
            // This is a transfer
            if (!features.enableSecondaryTransfers) {
                revert TransfersDisabled();
            }
        }

        super._update(from, to, ids, values);
    }

    /**
     * @dev Required override for AccessControl + ERC1155
     */
    function supportsInterface(bytes4 interfaceId)
        public view virtual override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
