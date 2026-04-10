import { SignalType as AlgoSignalType, type TradingSignal as StrategySignal } from '../../../algorithm/interfaces';
import { type CandleData } from '../../../ohlc/ohlc-candle.entity';
import { type TradingSignal as BacktestTradingSignal } from '../../backtest/shared/types/backtest-signal.interface';
import {
  DEFAULT_OPPORTUNITY_SELLING_CONFIG,
  type OpportunitySellingUserConfig
} from '../../interfaces/opportunity-selling.interface';
import { PaperTradingAccount, PaperTradingExitType, type PaperTradingOrder, PaperTradingSignalType } from '../entities';

// ─── Public Types ───────────────────────────────────────────────────────────

export interface TradingSignal extends BacktestTradingSignal {
  symbol: string;
}

export interface TickResult {
  processed: boolean;
  signalsReceived: number;
  ordersExecuted: number;
  errors: string[];
  portfolioValue: number;
  prices: Record<string, number>;
}

export type ExecuteOrderStatus = 'success' | 'insufficient_funds' | 'no_price' | 'no_position' | 'hold_period';

export interface ExecuteOrderResult {
  status: ExecuteOrderStatus;
  order: PaperTradingOrder | null;
}

// ─── Engine-Internal Result Types ───────────────────────────────────────────

export interface EngineMarketData {
  accounts: PaperTradingAccount[];
  quoteCurrency: string;
  exchangeSlug: string;
  priceMap: Record<string, number>;
  historicalCandles: Record<string, CandleData[]>;
  allSymbols: string[];
}

export interface FilteredSignals {
  signals: TradingSignal[];
  allocation: { maxAllocation: number; minAllocation: number };
}

export interface SignalLoopResult {
  ordersExecuted: number;
  errors: string[];
}

// ─── Exit Type Helpers ──────────────────────────────────────────────────────

export const VALID_EXIT_TYPES = new Set(Object.values(PaperTradingExitType));

/** Safely convert an unknown string to PaperTradingExitType, returning undefined for invalid values */
export function toExitType(value: string | undefined | null): PaperTradingExitType | undefined {
  if (!value) return undefined;
  return VALID_EXIT_TYPES.has(value as PaperTradingExitType) ? (value as PaperTradingExitType) : undefined;
}

// ─── Signal Mapping ─────────────────────────────────────────────────────────

export const mapStrategySignal = (signal: StrategySignal, quoteCurrency: string): TradingSignal => {
  let action: TradingSignal['action'];
  switch (signal.type) {
    case AlgoSignalType.BUY:
      action = 'BUY';
      break;
    case AlgoSignalType.SELL:
    case AlgoSignalType.STOP_LOSS:
    case AlgoSignalType.TAKE_PROFIT:
      action = 'SELL';
      break;
    case AlgoSignalType.SHORT_ENTRY:
      action = 'OPEN_SHORT';
      break;
    case AlgoSignalType.SHORT_EXIT:
      action = 'CLOSE_SHORT';
      break;
    default:
      action = 'HOLD';
  }

  const symbol = `${signal.coinId}/${quoteCurrency}`;

  return {
    action,
    coinId: signal.coinId,
    symbol,
    quantity: signal.quantity,
    percentage: signal.strength,
    reason: signal.reason,
    confidence: signal.confidence,
    metadata: signal.metadata as Record<string, unknown>,
    originalType: signal.type
  };
};

export const classifySignalType = (signal: TradingSignal): PaperTradingSignalType => {
  if (signal.originalType === AlgoSignalType.STOP_LOSS || signal.originalType === AlgoSignalType.TAKE_PROFIT) {
    return PaperTradingSignalType.RISK_CONTROL;
  }
  if (signal.action === 'BUY' || signal.action === 'OPEN_SHORT') return PaperTradingSignalType.ENTRY;
  if (signal.action === 'SELL' || signal.action === 'CLOSE_SHORT') return PaperTradingSignalType.EXIT;
  return PaperTradingSignalType.ADJUSTMENT;
};

// ─── Config Resolvers ───────────────────────────────────────────────────────

export function resolveMinHoldMs(algorithmConfig?: Record<string, any>): number {
  const DEFAULT_MIN_HOLD_MS = 24 * 60 * 60 * 1000;
  const val = algorithmConfig?.minHoldMs;
  if (typeof val !== 'number' || !isFinite(val) || val < 0) return DEFAULT_MIN_HOLD_MS;
  return val;
}

/**
 * Extract symbols from algorithm config. Deduplicates at source.
 */
export function extractSymbolsFromConfig(config?: Record<string, any>): string[] {
  if (!config) return [];

  const seen = new Set<string>();
  const symbols: string[] = [];

  const addAll = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const s of arr) {
      if (typeof s === 'string' && !seen.has(s)) {
        seen.add(s);
        symbols.push(s);
      }
    }
  };

  addAll(config.symbols);
  addAll(config.tradingPairs);

  return symbols;
}

export function extractCoinsFromPrices(prices: Record<string, number>): Array<{ id: string; symbol: string }> {
  const seen = new Set<string>();
  const coins: Array<{ id: string; symbol: string }> = [];

  for (const symbol of Object.keys(prices)) {
    const [baseCurrency] = symbol.split('/');
    if (!seen.has(baseCurrency)) {
      seen.add(baseCurrency);
      coins.push({ id: baseCurrency, symbol: baseCurrency });
    }
  }

  return coins;
}

/**
 * Build price data context with historical candles for algorithm indicator calculations.
 */
export function buildPriceDataContext(
  prices: Record<string, number>,
  historicalCandles: Record<string, CandleData[]> = {}
): Record<string, CandleData[]> {
  const priceData: Record<string, CandleData[]> = {};
  const now = new Date();

  for (const [symbol, price] of Object.entries(prices)) {
    const [baseCurrency] = symbol.split('/');
    const candles = historicalCandles[symbol] ?? [];
    const candidate =
      candles.length > 0
        ? [...candles, { avg: price, high: price, low: price, date: now }]
        : [{ avg: price, high: price, low: price, date: now }];

    if (!priceData[baseCurrency] || candidate.length > priceData[baseCurrency].length) {
      priceData[baseCurrency] = candidate;
    }
  }

  return priceData;
}

function clampNum(val: unknown, fallback: number, min: number, max: number): number {
  const n = typeof val === 'number' && isFinite(val) ? val : fallback;
  return Math.max(min, Math.min(max, n));
}

export function resolveOpportunitySellingConfig(algorithmConfig?: Record<string, any>): {
  enabled: boolean;
  config: OpportunitySellingUserConfig;
} {
  const params = algorithmConfig ?? {};
  const enabled = params.enableOpportunitySelling === true;
  const userConfig = params.opportunitySellingConfig;

  if (!enabled || !userConfig || typeof userConfig !== 'object') {
    return { enabled, config: { ...DEFAULT_OPPORTUNITY_SELLING_CONFIG } };
  }

  return {
    enabled,
    config: {
      minOpportunityConfidence: clampNum(
        userConfig.minOpportunityConfidence,
        DEFAULT_OPPORTUNITY_SELLING_CONFIG.minOpportunityConfidence,
        0,
        1
      ),
      minHoldingPeriodHours: clampNum(
        userConfig.minHoldingPeriodHours,
        DEFAULT_OPPORTUNITY_SELLING_CONFIG.minHoldingPeriodHours,
        0,
        8760
      ),
      protectGainsAbovePercent: clampNum(
        userConfig.protectGainsAbovePercent,
        DEFAULT_OPPORTUNITY_SELLING_CONFIG.protectGainsAbovePercent,
        0,
        1000
      ),
      protectedCoins: Array.isArray(userConfig.protectedCoins) ? userConfig.protectedCoins : [],
      minOpportunityAdvantagePercent: clampNum(
        userConfig.minOpportunityAdvantagePercent,
        DEFAULT_OPPORTUNITY_SELLING_CONFIG.minOpportunityAdvantagePercent,
        0,
        100
      ),
      maxLiquidationPercent: clampNum(
        userConfig.maxLiquidationPercent,
        DEFAULT_OPPORTUNITY_SELLING_CONFIG.maxLiquidationPercent,
        1,
        100
      ),
      useAlgorithmRanking:
        typeof userConfig.useAlgorithmRanking === 'boolean'
          ? userConfig.useAlgorithmRanking
          : DEFAULT_OPPORTUNITY_SELLING_CONFIG.useAlgorithmRanking
    }
  };
}
