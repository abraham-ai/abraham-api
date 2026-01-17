// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IScoringModule
 * @notice Interface for pluggable scoring strategies
 * @dev Agents can implement different scoring mechanisms:
 *      - Quadratic voting (sqrt-based diminishing returns)
 *      - Linear scoring
 *      - Time-weighted scoring
 *      - Custom algorithms
 */
interface IScoringModule {

    /// @notice Scoring strategy identifiers
    enum ScoringStrategy {
        LINEAR,           // Simple count-based scoring
        QUADRATIC,        // Sqrt-based diminishing returns
        TIME_WEIGHTED,    // Score weighted by time remaining
        QUADRATIC_TIME_WEIGHTED, // Quadratic with time decay
        CUSTOM            // Custom implementation
    }

    /// @notice Parameters for score calculation
    struct ScoreParams {
        uint256 currentCount;      // Current reaction/comment count
        uint256 newCount;          // New count after this action
        uint256 timeRemaining;     // Time remaining in period
        uint256 periodDuration;    // Total period duration
        uint256 weight;            // Weight for this action type
        uint256 scaleFactor;       // Scale factor for precision
    }

    /// @notice Configuration for scoring calculations
    struct ScoringParams {
        uint256 reactionWeight;
        uint256 commentWeight;
        uint256 timeDecayMin;      // Minimum decay factor (e.g., 10 = 1%)
        uint256 timeDecayBase;     // Base for decay (e.g., 1000 = 100%)
        uint256 scaleFactor;       // Scale factor for precision
    }

    // ============ Core Functions ============

    /**
     * @notice Calculate the score delta for a new reaction
     * @param params Score calculation parameters
     * @return scoreDelta The change in score
     */
    function calculateReactionScoreDelta(ScoreParams calldata params)
        external pure returns (uint256 scoreDelta);

    /**
     * @notice Calculate the score delta for a new comment
     * @param params Score calculation parameters
     * @return scoreDelta The change in score
     */
    function calculateCommentScoreDelta(ScoreParams calldata params)
        external pure returns (uint256 scoreDelta);

    /**
     * @notice Calculate time decay factor
     * @param timeRemaining Time remaining in period
     * @param periodDuration Total period duration
     * @param decayMin Minimum decay factor
     * @param decayBase Base for decay calculation
     * @return decayFactor The decay multiplier (scaled by decayBase)
     */
    function calculateTimeDecay(
        uint256 timeRemaining,
        uint256 periodDuration,
        uint256 decayMin,
        uint256 decayBase
    ) external pure returns (uint256 decayFactor);

    /**
     * @notice Get the scoring strategy this module implements
     * @return strategy The scoring strategy
     */
    function getStrategy() external pure returns (ScoringStrategy strategy);

    // ============ Utility Functions ============

    /**
     * @notice Calculate square root (for quadratic scoring)
     * @param x The input value
     * @return y The square root
     */
    function sqrt(uint256 x) external pure returns (uint256 y);
}
