import { type ExitConfig } from './exit-config.interface';

import { type SignalType as AlgoSignalType } from '../../algorithm/interfaces';
import { type PriceSummary } from '../../ohlc/ohlc-candle.entity';

/**
 * Trade signal interface for algorithm-generated signals
 *
 * `algorithmActivationId` and `exchangeKeyId` are optional so that event-driven
 * callers (e.g. listing-tracker) can execute trades without owning an activation
 * row. When `exchangeKeyId` is missing, `TradeExecutionService` will resolve the
 * best active key for the user via `ExchangeSelectionService.selectForBuy()`.
 */
export interface TradeSignal {
  algorithmActivationId?: string | null;
  userId: string;
  exchangeKeyId?: string | null;
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
  /** Coin UUID from the originating algorithm signal — used to stamp the throttle ledger after order placement */
  coinId?: string;
  /** Original algorithm signal type — preserved so callers can identify bypass signals (STOP_LOSS / TAKE_PROFIT / SHORT_EXIT) */
  originalType?: AlgoSignalType;
}
