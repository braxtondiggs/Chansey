/**
 * Market type for orders — spot or futures (perpetual contracts)
 */
export enum MarketType {
  SPOT = 'spot',
  FUTURES = 'futures'
}

/**
 * Margin mode for futures positions
 * Phase 1: isolated only. Phase 2 roadmap: cross margin.
 */
export enum MarginMode {
  ISOLATED = 'isolated',
  CROSS = 'cross'
}

/**
 * Position direction for futures trading
 */
export enum PositionSide {
  LONG = 'long',
  SHORT = 'short'
}
