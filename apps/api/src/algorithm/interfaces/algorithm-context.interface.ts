import { Coin } from '../../coin/coin.entity';
import { Order } from '../../order/order.entity';
import { PriceSummaryByDay } from '../../price/price.entity';

/**
 * Context object containing all the data and services needed for algorithm execution
 */
export interface AlgorithmContext {
  /**
   * Coins available in the portfolio
   */
  coins: Coin[];

  /**
   * Historical price data organized by coin ID and day
   */
  priceData: PriceSummaryByDay;

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
}
