import { ExitConfig } from './exit-config.interface';

import { PriceSummary } from '../../ohlc/ohlc-candle.entity';

/**
 * Trade signal interface for algorithm-generated signals
 */
export interface TradeSignal {
  algorithmActivationId: string;
  userId: string;
  exchangeKeyId: string;
  action: 'BUY' | 'SELL';
  symbol: string;
  quantity: number;
  /** Market type: 'spot' (default) or 'futures' */
  marketType?: 'spot' | 'futures';
  /** Position side for futures: 'long' or 'short' */
  positionSide?: 'long' | 'short';
  /** Leverage multiplier for futures positions (1-10) */
  leverage?: number;
}

/**
 * Extended trade signal with exit configuration
 */
export interface TradeSignalWithExit extends TradeSignal {
  /** Original algorithm confidence score (0-1) */
  confidence?: number;
  /** Exit configuration for automatic SL/TP/trailing stop placement */
  exitConfig?: Partial<ExitConfig>;
  /** Historical price data for ATR-based exit calculations */
  priceData?: PriceSummary[];
  /** Whether to auto-size the order based on portfolio value */
  autoSize?: boolean;
  /** Total portfolio value in USD for auto-sizing */
  portfolioValue?: number;
  /** Allocation percentage of portfolio for this trade */
  allocationPercentage?: number;
}
