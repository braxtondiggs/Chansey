import { Injectable, Logger } from '@nestjs/common';

import {
  CompositeRegimeType,
  DEFAULT_VOLATILITY_CONFIG,
  determineVolatilityRegime,
  MarketRegimeType
} from '@chansey/api-interfaces';

import { Coin } from '../../../../coin/coin.entity';
import { RegimeGateService } from '../../../../market-regime/regime-gate.service';
import { VolatilityCalculator } from '../../../../market-regime/volatility.calculator';
import { DEFAULT_RISK_LEVEL } from '../../../../risk/risk.constants';
import { toErrorInfo } from '../../../../shared/error.util';
import { IncrementalSma } from '../../incremental-sma';
import { SignalFilterChainService, SignalFilterContext } from '../filters';
import { Portfolio } from '../portfolio';
import { PriceTrackingContext } from '../price-window';
import { MarketData, TradingSignal } from '../types';

/** SMA period used for BTC trend detection in regime classification. */
export const REGIME_SMA_PERIOD = 200;

/** Result of composite regime computation. */
export interface CompositeRegimeResult {
  compositeRegime: CompositeRegimeType;
  volatilityRegime: MarketRegimeType;
}

@Injectable()
export class CompositeRegimeService {
  private readonly logger = new Logger('CompositeRegimeService');

  constructor(
    private readonly regimeGateService: RegimeGateService,
    private readonly volatilityCalculator: VolatilityCalculator,
    private readonly signalFilterChain: SignalFilterChainService
  ) {}

  /**
   * Compute the composite regime (trend + volatility) from BTC price data.
   *
   * Trend detection uses the O(1) incremental SMA maintained by
   * `advancePriceWindows` instead of recomputing `SMA.calculate()` every bar.
   * Volatility still uses `mapToArray` (small window, acceptable cost).
   *
   * Returns null if insufficient data (< 200 bars or SMA not filled).
   */
  computeCompositeRegime(btcCoinId: string, priceCtx: PriceTrackingContext): CompositeRegimeResult | null {
    const btcWindow = priceCtx.windowsByCoin.get(btcCoinId);
    if (!btcWindow || btcWindow.length < REGIME_SMA_PERIOD) {
      return null;
    }

    // Use the incremental SMA if available (O(1)), otherwise fall back to window-based calculation
    const sma200 = priceCtx.btcRegimeSma?.filled ? priceCtx.btcRegimeSma.value : undefined;
    if (sma200 === undefined) {
      return null;
    }

    const lastEntry = btcWindow.last();
    const latestBtcPrice = lastEntry ? (lastEntry.close ?? lastEntry.avg) : undefined;
    if (latestBtcPrice === undefined) {
      return null;
    }

    const trendAboveSma = latestBtcPrice > sma200;

    // Volatility detection still uses mapToArray (small window, acceptable)
    let volatilityRegime = MarketRegimeType.NORMAL;
    const volConfig = DEFAULT_VOLATILITY_CONFIG;
    const btcCloseCount = btcWindow.length;
    if (btcCloseCount >= volConfig.rollingDays + 1) {
      try {
        const btcCloses = btcWindow.mapToArray((p) => p.close ?? p.avg);
        const realizedVol = this.volatilityCalculator.calculateRealizedVolatility(btcCloses, volConfig);
        if (btcCloseCount >= volConfig.lookbackDays) {
          const percentile = this.volatilityCalculator.calculatePercentile(realizedVol, btcCloses, volConfig);
          volatilityRegime = determineVolatilityRegime(percentile);
        }
      } catch (error) {
        this.logger.debug?.(`Volatility regime calc fell back to NORMAL: ${toErrorInfo(error).message}`);
      }
    }

    const compositeRegime = this.regimeGateService.classifyComposite(volatilityRegime, trendAboveSma);
    return { compositeRegime, volatilityRegime };
  }

  resolveRegimeConfig(
    options: { enableRegimeGate?: boolean; enableRegimeScaledSizing?: boolean; riskLevel?: number },
    coins: Coin[]
  ): { enableRegimeScaledSizing: boolean; riskLevel: number; regimeGateEnabled: boolean; btcCoin: Coin | undefined } {
    const enableRegimeScaledSizing = options.enableRegimeScaledSizing !== false;
    const riskLevel = options.riskLevel ?? DEFAULT_RISK_LEVEL;
    const regimeGateEnabled = options.enableRegimeGate ?? riskLevel <= 2;
    const btcCoin =
      regimeGateEnabled || enableRegimeScaledSizing ? coins.find((c) => c.symbol?.toUpperCase() === 'BTC') : undefined;
    if (regimeGateEnabled && !btcCoin) {
      this.logger.warn('Regime gate enabled but BTC not found in dataset — gate disabled for this run');
    }
    return { enableRegimeScaledSizing, riskLevel, regimeGateEnabled, btcCoin };
  }

  resolveRegimeConfigForOptimization(
    config: { enableRegimeGate?: boolean; enableRegimeScaledSizing?: boolean; riskLevel?: number },
    coins: Coin[],
    priceCtx: PriceTrackingContext
  ): { enableRegimeScaledSizing: boolean; riskLevel: number; regimeGateEnabled: boolean; btcCoin: Coin | undefined } {
    const result = this.resolveRegimeConfig(config, coins);
    if (result.btcCoin) {
      priceCtx.btcRegimeSma = new IncrementalSma(REGIME_SMA_PERIOD);
      priceCtx.btcCoinId = result.btcCoin.id;
    }
    return result;
  }

  buildConcentrationContext(portfolio: Portfolio, marketData: MarketData): SignalFilterContext['concentrationContext'] {
    return portfolio.positions.size > 0
      ? {
          portfolioPositions: portfolio.positions,
          portfolioTotalValue: portfolio.totalValue,
          currentPrices: marketData.prices
        }
      : undefined;
  }

  applyBarRegime(
    strategySignals: TradingSignal[],
    priceCtx: PriceTrackingContext,
    regimeConfig: {
      btcCoin?: Coin;
      regimeGateEnabled: boolean;
      enableRegimeScaledSizing: boolean;
      riskLevel: number;
      concentrationContext?: SignalFilterContext['concentrationContext'];
    },
    allocationLimits: { maxAllocation: number; minAllocation: number },
    precomputedRegime?: CompositeRegimeResult | null
  ): { filteredSignals: TradingSignal[]; barMaxAllocation: number; barMinAllocation: number } {
    if (!regimeConfig.btcCoin || strategySignals.length === 0) {
      return {
        filteredSignals: strategySignals,
        barMaxAllocation: allocationLimits.maxAllocation,
        barMinAllocation: allocationLimits.minAllocation
      };
    }

    const regimeResult =
      precomputedRegime !== undefined
        ? precomputedRegime
        : this.computeCompositeRegime(regimeConfig.btcCoin.id, priceCtx);
    if (!regimeResult) {
      return {
        filteredSignals: strategySignals,
        barMaxAllocation: allocationLimits.maxAllocation,
        barMinAllocation: allocationLimits.minAllocation
      };
    }

    const result = this.signalFilterChain.apply(
      strategySignals,
      {
        compositeRegime: regimeResult.compositeRegime,
        riskLevel: regimeConfig.riskLevel,
        regimeGateEnabled: regimeConfig.regimeGateEnabled,
        regimeScaledSizingEnabled: regimeConfig.enableRegimeScaledSizing,
        tradingContext: 'backtest',
        concentrationContext: regimeConfig.concentrationContext
      },
      allocationLimits
    );

    return {
      filteredSignals: result.signals,
      barMaxAllocation: result.maxAllocation,
      barMinAllocation: result.minAllocation
    };
  }
}
