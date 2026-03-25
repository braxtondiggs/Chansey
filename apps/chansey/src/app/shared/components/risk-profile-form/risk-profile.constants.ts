/** Human-readable descriptions of coin selection criteria per risk level */
export const RISK_CRITERIA: Record<number, string> = {
  1: 'High-volume, established coins with stable track records',
  2: 'Balanced selection favoring stability over growth',
  3: 'Mix of established and emerging coins',
  4: 'Growth-oriented coins with higher potential',
  5: 'Top-ranked trending coins for maximum growth'
};

export const DAILY_LOSS_LIMIT_SCALE = 5;
export const BEAR_MARKET_CAPITAL_SCALE = 4;
