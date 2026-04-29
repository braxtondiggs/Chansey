/**
 * Trading style classification for the regime fitness gate.
 *
 * Declared as an abstract field on `BaseAlgorithmStrategy`, so every concrete
 * strategy must declare its style at compile time. The pipeline orchestrator's
 * regime gate reads this field to skip incompatible (style, regime) pairings
 * before any OPTIMIZE compute is spent.
 */
export enum TradingStyle {
  TREND_FOLLOWING = 'TREND_FOLLOWING',
  MEAN_REVERTING = 'MEAN_REVERTING',
  VOLATILITY_EXPANSION = 'VOLATILITY_EXPANSION',
  MULTI_SIGNAL = 'MULTI_SIGNAL'
}
