import { type MarketData, type TradingSignal } from './backtest-signal.interface';

import { type OHLCCandle } from '../../../../ohlc/ohlc-candle.entity';
import { type ExecuteTradeResult } from '../execution/trade-executor.helpers';
import { type Portfolio } from '../portfolio';
import { type SlippageConfig, type SpreadEstimationContext } from '../slippage';

/**
 * Parameters for executing a trade on the in-memory portfolio.
 */
export interface ExecuteTradeParams {
  signal: TradingSignal;
  portfolio: Portfolio;
  marketData: MarketData;
  tradingFee: number;
  slippageConfig: SlippageConfig;
  dailyVolume?: number;
  minHoldMs?: number;
  maxAllocation?: number;
  minAllocation?: number;
  defaultLeverage?: number;
  spreadContext?: SpreadEstimationContext;
}

/**
 * Callback type for executing a trade on the in-memory portfolio.
 */
export type ExecuteTradeFn = (params: ExecuteTradeParams) => Promise<ExecuteTradeResult | null>;

/**
 * Callback type for extracting daily volume from OHLC candles.
 * Accepts a pre-built Map<coinId, OHLCCandle> for O(1) lookup.
 */
export type ExtractDailyVolumeFn = (priceMap: Map<string, OHLCCandle>, coinId: string) => number | undefined;

/**
 * Callback type for building spread estimation context.
 * Accepts a pre-built Map<coinId, OHLCCandle> for O(1) lookup.
 */
export type BuildSpreadContextFn = (
  priceMap: Map<string, OHLCCandle>,
  coinId: string,
  prevCandleMap: Map<string, OHLCCandle>
) => SpreadEstimationContext | undefined;
