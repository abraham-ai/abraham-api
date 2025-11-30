# Leaderboard API Documentation

A hybrid lifetime leaderboard that prevents whale dominance while rewarding quality curation.

## Key Principle

**NFTs enable blessings, but only blessings earn points.**

- 0 blessings = 0 points (regardless of NFT count)
- NFT count is used to calculate blessing efficiency, not direct scoring
- Square root scaling prevents whales from dominating through sheer volume
- 7-day efficiency window ensures fair comparison despite dynamic NFT ownership

---

## Endpoints

### Get Leaderboard

```
GET /api/leaderboard
```

**Query Parameters:**
- `limit` (optional): Number of entries to return (default: 100, max: 500)
- `timeframe` (optional): Time period for leaderboard - `daily` | `weekly` | `monthly` | `yearly` | `lifetime` (default: lifetime)

**Example Requests:**
```bash
# Lifetime leaderboard (default)
curl 'http://localhost:3000/api/leaderboard?limit=10'

# Daily leaderboard (last 24 hours)
curl 'http://localhost:3000/api/leaderboard?limit=10&timeframe=daily'

# Weekly leaderboard (last 7 days)
curl 'http://localhost:3000/api/leaderboard?limit=10&timeframe=weekly'

# Monthly leaderboard (last 30 days)
curl 'http://localhost:3000/api/leaderboard?limit=10&timeframe=monthly'

# Yearly leaderboard (last 365 days)
curl 'http://localhost:3000/api/leaderboard?limit=10&timeframe=yearly'
```

**Example Response:**
```json
{
  "success": true,
  "count": 1,
  "leaderboard": [
    {
      "address": "0x8eaba6d5bb11c1bf2589c90184f07f304e365d03",
      "nftCount": 2,
      "blessingCount": 9,
      "winningBlessings": 0,
      "recentActivity": true,
      "score": 130,
      "blessingEfficiency": 1.0,
      "curationAccuracy": 0,
      "rank": 1
    }
  ],
  "scoring": { ... }
}
```

### Get User Rank

```
GET /api/leaderboard/user/:address
```

**Query Parameters:**
- `timeframe` (optional): Time period for rank - `daily` | `weekly` | `monthly` | `yearly` | `lifetime` (default: lifetime)

**Example Requests:**
```bash
# Lifetime rank (default)
curl 'http://localhost:3000/api/leaderboard/user/0x8eaba6d5bb11c1bf2589c90184f07f304e365d03'

# Daily rank
curl 'http://localhost:3000/api/leaderboard/user/0x8eaba6d5bb11c1bf2589c90184f07f304e365d03?timeframe=daily'

# Weekly rank
curl 'http://localhost:3000/api/leaderboard/user/0x8eaba6d5bb11c1bf2589c90184f07f304e365d03?timeframe=weekly'
```

**Example Response:**
```json
{
  "success": true,
  "address": "0x8eaba6d5bb11c1bf2589c90184f07f304e365d03",
  "rank": 1,
  "totalParticipants": 238,
  "score": 130,
  "stats": {
    "nftCount": 2,
    "blessingCount": 9,
    "winningBlessings": 0,
    "recentActivity": true
  },
  "blessings": [...]
}
```

---

## Timeframe Support

The leaderboard supports multiple timeframes to track user performance over different periods:

| Timeframe | Duration | Use Case |
|-----------|----------|----------|
| `daily` | Last 24 hours | See today's most active curators |
| `weekly` | Last 7 days | Weekly competition |
| `monthly` | Last 30 days | Monthly rankings |
| `yearly` | Last 365 days | Annual performance |
| `lifetime` | All time | Overall cumulative rankings (default) |

**How it works:**
- Blessings are filtered by timestamp based on the selected timeframe
- All scoring components (volume, efficiency, winning blessings, accuracy) only consider blessings within the timeframe
- Recent activity multiplier (1.3x) still checks last 30 days regardless of timeframe

**Note:** For short timeframes (daily/weekly), efficiency scoring may be lower since the 7-day efficiency window extends beyond the timeframe. This is intentional - it rewards consistent daily activity even in daily leaderboards.

---

## Scoring Formula

### Hybrid Lifetime Strategy

This leaderboard combines two approaches to create a fair lifetime ranking:

1. **Square Root Scaling**: Prevents whale dominance by using logarithmic scaling for total blessing volume
2. **7-Day Efficiency**: Rewards daily consistency using a rolling window that's fair despite dynamic NFT ownership

### Components

The score is calculated from multiple factors that reward quality curation:

#### 1. Square Root Blessing Volume (50 points per sqrt(blessing))
```
sqrt(Total Blessings) × 50
```

- **What it measures**: Total blessing volume with anti-whale scaling
- **Why square root**: Makes the relationship logarithmic, not linear
- **Example**:
  - User A: 100 blessings = sqrt(100) × 50 = 500 points
  - User B: 10 blessings = sqrt(10) × 50 = 158 points
  - **User A is only 3x ahead, not 10x** - this prevents whales from dominating

#### 2. Blessing Efficiency (100 points max)
```
(Blessings in Period / Max Possible over Time) × 100
Max Possible = NFTs × Days Active × 1 blessing/NFT/day
```

- **What it measures**: Daily consistency in using your blessing power
- **Period**: Rolling 7-day window (or since first blessing if < 7 days)
- **Why 7 days**: Matches our snapshot retention period, ensures fair comparison despite NFT ownership changes
- **Example**:
  - User A: 2 NFTs, active 5 days, blessed 9 times in last 7 days = 9/(2×5) = 90% efficiency = 90 points
  - User B: 100 NFTs, active 7 days, blessed 140 times in last 7 days = 140/(100×7) = 20% efficiency = 20 points
  - **User A scores higher by being more consistent daily**

#### 3. Winning Blessings (50-150 points each)
```
Base 50 points × Early Bird Multiplier (1x to 3x)
```

- **What it measures**: Blessing seeds that eventually get minted
- **Early Bird Bonus**:
  - Blessing immediately after creation = up to 3x multiplier
  - Blessing right before mint = 1x multiplier (no bonus)
  - Uses exponential decay to heavily favor early curation

- **Example**:
  - Bless a seed 1 hour after creation → 2.8x multiplier = 140 points
  - Bless same seed 6 days later → 1.2x multiplier = 60 points

#### 4. Curation Accuracy (150 points max)
```
(Winning Blessings / Total Blessings) × 150
```

- **What it measures**: Your winning percentage
- **Example**:
  - User A: 10 blessings, 8 winners = 80% accuracy = 120 points
  - User B: 100 blessings, 20 winners = 20% accuracy = 30 points
  - **Quality beats quantity**

#### 5. Recency Multiplier (1.3x)
```
Total Score × 1.3 (if active in last 30 days)
```

- **What it measures**: Recent engagement
- Multiplies entire score by 1.3x if you've blessed in the last 30 days

---

## Complete Formula

```
Score = [
  (sqrt(Total Blessings) × 50)
  + (Blessing Efficiency × 100)
  + Σ(Winning Blessing × Early Bird Multiplier)
  + (Curation Accuracy × 150)
] × 1.3 (if recent activity)
```

**Important**: If you have 0 blessings, your score is always 0.

### Why This Hybrid Approach Works

1. **Square Root Prevents Whale Dominance**:
   - 1,000 blessings = sqrt(1000) × 50 = 1,581 points
   - 100 blessings = sqrt(100) × 50 = 500 points
   - **Ratio is 3.2:1, not 10:1** - whales can't dominate just through volume

2. **7-Day Efficiency Window Is Fair**:
   - Doesn't penalize users who bought/sold NFTs months ago
   - Matches our snapshot retention (we have ~5-7 days of history)
   - Recent activity matters more than ancient history

3. **Quality Still Beats Quantity**:
   - High accuracy (150 pts max) and early bird bonuses (up to 150 pts each) reward smart curation
   - A curator with 10 blessings and 80% accuracy can beat a whale with 100 blessings and 20% accuracy

---

## Response Fields

### Leaderboard Entry

| Field | Type | Description |
|-------|------|-------------|
| `address` | string | User's wallet address |
| `nftCount` | number | Number of FirstWorks NFTs owned |
| `blessingCount` | number | Total blessings given |
| `winningBlessings` | number | Blessings on minted seeds |
| `recentActivity` | boolean | Active in last 30 days |
| `score` | number | Total engagement score |
| `rank` | number | Leaderboard position |
| `blessingEfficiency` | number | 0-1 ratio of blessing utilization |
| `curationAccuracy` | number | 0-1 ratio of winning percentage |
| `avgEarlyBirdScore` | number? | Average early bird score (0-1, only if has winning blessings) |

---

## Strategy Guide

### How to Maximize Your Score

1. **Use Your Blessings**: Don't hoard them
   - 10 NFTs × 100% usage > 100 NFTs × 20% usage

2. **Bless Early**: Earlier blessings on winners score up to 3x more
   - Don't wait to see which seeds are winning
   - Trust your curation instinct

3. **Be Selective**: Quality over quantity
   - High win rate (80%) > low win rate (20%)
   - Don't spam blessings on everything

4. **Stay Active**: Recent activity gives 1.3x multiplier
   - Bless regularly to maintain recency bonus

### Example Scenarios

**Scenario A: The Efficient Curator**
- 10 NFTs, 10 blessings (last 7 days), 8 winners, blessed early
- Volume: sqrt(10) × 50 = 158 points
- Efficiency: (10/(10×7)) × 100 = 14 points
- Winning: 8 × 140 (high early bird) = 1,120 points
- Accuracy: 0.8 × 150 = 120 points
- Recency: 1.3x multiplier
- **Total: (158 + 14 + 1,120 + 120) × 1.3 = 1,835 points**

**Scenario B: The Volume Whale**
- 100 NFTs, 200 blessings (140 in last 7 days), 40 winners, blessed late
- Volume: sqrt(200) × 50 = 707 points
- Efficiency: (140/(100×7)) × 100 = 20 points
- Winning: 40 × 60 (low early bird) = 2,400 points
- Accuracy: 0.2 × 150 = 30 points
- Recency: 1.3x multiplier
- **Total: (707 + 20 + 2,400 + 30) × 1.3 = 4,104 points**

**Scenario C: The Quality Curator**
- 5 NFTs, 25 blessings (all in last 7 days), 20 winners, blessed early
- Volume: sqrt(25) × 50 = 250 points
- Efficiency: (25/(5×7)) × 100 = 71 points
- Winning: 20 × 140 (high early bird) = 2,800 points
- Accuracy: 0.8 × 150 = 120 points
- Recency: 1.3x multiplier
- **Total: (250 + 71 + 2,800 + 120) × 1.3 = 4,213 points**

**The quality curator with 5 NFTs beats the whale with 100 NFTs through better accuracy and early bird bonuses!**

---

## Notes

- Leaderboard updates in real-time based on on-chain blessing data
- NFT snapshots are generated daily via automated cron job (midnight UTC)
- Historical snapshots are stored in Vercel Blob (keeps last 5 versions)
- Early bird scoring assumes 7-day average time to mint (configurable)
- Maximum efficiency is capped at 100% (can't go over max possible blessings)
- Square root scaling is applied to total lifetime blessing count
- Efficiency window is 7 days to match snapshot retention period
