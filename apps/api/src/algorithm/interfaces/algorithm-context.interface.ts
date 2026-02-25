import { CandleData } from '../../ohlc/ohlc-candle.entity';
import { Order } from '../../order/order.entity';

/**
 * Context object containing all the data and services needed for algorithm execution
 */
export interface AlgorithmContext {
  /**
   * Coins available in the portfolio.
   * Accepts full Coin entities or lightweight { id, symbol } objects (e.g. paper trading).
   */
  coins: Array<{ id: string; symbol: string }>;

  /**
   * Historical price data organized by coin ID.
   * Accepts PriceSummary[] (backtest) or CandleData[] (paper trading) per coin.
   */
  priceData: Record<string, CandleData[]>;

  /**
   * Current market data timestamp
   */
  timestamp: Date;

  /**
   * Algorithm-specific configuration parameters
   */
  config: Record<string, unknown>;

  /**
   * Available balance for trading
   */
  availableBalance?: number;

  /**
   * Current portfolio positions
   */
  positions?: Record<string, number>;

  /**
   * Recent orders for context
   */
  recentOrders?: Order[];

  /**
   * Market conditions or additional metadata
   */
  metadata?: Record<string, unknown>;

  /**
   * Precomputed indicator series for optimization fast-path.
   * Keyed by coinId → indicatorKey (e.g. "ema_21") → full padded number array.
   * When present, strategies should read values at `currentTimestampIndex`
   * instead of calling IndicatorService.
   */
  precomputedIndicators?: Record<string, Record<string, ArrayLike<number>>>;

  /**
   * Current position in the timestamp loop (0-based index into the full series).
   * Used with `precomputedIndicators` to look up precomputed values.
   */
  currentTimestampIndex?: number;
}
