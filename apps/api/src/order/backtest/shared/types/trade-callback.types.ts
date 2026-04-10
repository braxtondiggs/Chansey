import { type MarketData, type TradingSignal } from './backtest-signal.interface';

import { type OHLCCandle } from '../../../../ohlc/ohlc-candle.entity';
import { type ExecuteTradeResult } from '../execution/trade-executor.helpers';
import { type Portfolio } from '../portfolio';
import { type SlippageConfig, type SpreadEstimationContext } from '../slippage';

/**
 * Callback type for executing a trade on the in-memory portfolio.
 */
export type ExecuteTradeFn = (
  signal: TradingSignal,
  portfolio: Portfolio,
  marketData: MarketData,
  tradingFee: number,
  slippageConfig: SlippageConfig,
  dailyVolume?: number,
  minHoldMs?: number,
  maxAllocation?: number,
  minAllocation?: number,
  defaultLeverage?: number,
  spreadContext?: SpreadEstimationContext
) => Promise<ExecuteTradeResult | null>;

/**
 * Callback type for extracting daily volume from OHLC candles.
 */
export type ExtractDailyVolumeFn = (currentPrices: OHLCCandle[], coinId: string) => number | undefined;

/**
 * Callback type for building spread estimation context.
 */
export type BuildSpreadContextFn = (
  currentPrices: OHLCCandle[],
  coinId: string,
  prevCandleMap: Map<string, OHLCCandle>
) => SpreadEstimationContext | undefined;
