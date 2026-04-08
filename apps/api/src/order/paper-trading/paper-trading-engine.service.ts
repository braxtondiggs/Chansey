import { Injectable, Logger } from '@nestjs/common';

import { getAllocationLimits, PipelineStage, SignalReasonCode } from '@chansey/api-interfaces';

import {
  buildPriceDataContext,
  extractCoinsFromPrices,
  extractSymbolsFromConfig,
  mapStrategySignal,
  TickResult,
  TradingSignal
} from './engine/paper-trading-engine.utils';
import { PaperTradingExitExecutorService } from './engine/paper-trading-exit-executor.service';
import { PaperTradingOpportunitySellingService } from './engine/paper-trading-opportunity-selling.service';
import { PaperTradingOrderExecutorService } from './engine/paper-trading-order-executor.service';
import { PaperTradingPortfolioService } from './engine/paper-trading-portfolio.service';
import { PaperTradingSignalService } from './engine/paper-trading-signal.service';
import { PaperTradingSnapshotService } from './engine/paper-trading-snapshot.service';
import { PaperTradingThrottleService } from './engine/paper-trading-throttle.service';
import { PaperTradingAccount, PaperTradingSession, PaperTradingSignalStatus } from './entities';
import { PaperTradingMarketDataService } from './paper-trading-market-data.service';

import { AlgorithmContext, AlgorithmResult } from '../../algorithm/interfaces';
import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { CompositeRegimeService } from '../../market-regime/composite-regime.service';
import { CandleData } from '../../ohlc/ohlc-candle.entity';
import { DEFAULT_RISK_LEVEL } from '../../risk/risk.constants';
import { toErrorInfo } from '../../shared/error.util';
import {
  PAPER_TRADING_DEFAULT_THROTTLE_CONFIG,
  Portfolio,
  SerializableExitTrackerState,
  SignalFilterChainService,
  SerializableThrottleState,
  SignalThrottleService
} from '../backtest/shared';

interface MarketData {
  accounts: PaperTradingAccount[];
  quoteCurrency: string;
  exchangeSlug: string;
  priceMap: Record<string, number>;
  historicalCandles: Record<string, CandleData[]>;
  allSymbols: string[];
}

interface FilteredSignals {
  signals: TradingSignal[];
  allocation: { maxAllocation: number; minAllocation: number };
}

interface SignalLoopResult {
  ordersExecuted: number;
  errors: string[];
}

@Injectable()
export class PaperTradingEngineService {
  private readonly logger = new Logger(PaperTradingEngineService.name);

  constructor(
    private readonly marketDataService: PaperTradingMarketDataService,
    private readonly algorithmRegistry: AlgorithmRegistry,
    private readonly signalThrottle: SignalThrottleService,
    private readonly compositeRegimeService: CompositeRegimeService,
    private readonly signalFilterChain: SignalFilterChainService,
    private readonly portfolioService: PaperTradingPortfolioService,
    private readonly signalService: PaperTradingSignalService,
    private readonly snapshotService: PaperTradingSnapshotService,
    private readonly throttleService: PaperTradingThrottleService,
    private readonly orderExecutor: PaperTradingOrderExecutorService,
    private readonly exitExecutor: PaperTradingExitExecutorService,
    private readonly opportunitySelling: PaperTradingOpportunitySellingService
  ) {}

  /** Process a single tick for a paper trading session. */
  async processTick(session: PaperTradingSession, exchangeKey: ExchangeKey): Promise<TickResult> {
    const errors: string[] = [];
    let signalsReceived = 0;
    let ordersExecuted = 0;
    const now = new Date();

    try {
      const market = await this.fetchMarketData(session, exchangeKey);
      const { accounts, quoteCurrency, exchangeSlug, priceMap, historicalCandles } = market;

      const portfolio = this.portfolioService.buildFromAccounts(accounts, quoteCurrency);
      const updatedPortfolio = this.portfolioService.updateWithPrices(portfolio, priceMap, quoteCurrency);

      this.exitExecutor.getOrCreate(session);
      const exitOrdersExecuted = await this.runExits(
        session,
        priceMap,
        historicalCandles,
        quoteCurrency,
        exchangeSlug,
        now
      );
      ordersExecuted += exitOrdersExecuted;

      let algoPortfolio = updatedPortfolio;
      let activeAccounts = accounts;
      if (exitOrdersExecuted > 0) {
        ({ portfolio: algoPortfolio, accounts: activeAccounts } = await this.portfolioService.refresh(
          session.id,
          priceMap,
          quoteCurrency
        ));
      }

      const signals = await this.runAlgorithm(
        session,
        algoPortfolio,
        priceMap,
        activeAccounts,
        quoteCurrency,
        historicalCandles
      );
      signalsReceived = signals.length;

      const filtered = await this.filterSignals(session, signals);

      const heldCoins = new Set(
        activeAccounts.filter((a) => a.currency !== quoteCurrency && a.total > 1e-8).map((a) => a.currency)
      );

      const loopResult = await this.processSignalLoop(
        session,
        filtered,
        algoPortfolio,
        heldCoins,
        priceMap,
        historicalCandles,
        quoteCurrency,
        exchangeSlug,
        now
      );
      ordersExecuted += loopResult.ordersExecuted;
      errors.push(...loopResult.errors);

      const finalPortfolioValue = await this.finalizeSnapshot(session, priceMap, quoteCurrency, ordersExecuted, now);

      return {
        processed: true,
        signalsReceived,
        ordersExecuted,
        errors,
        portfolioValue: finalPortfolioValue,
        prices: priceMap
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Tick processing failed for session ${session.id}: ${err.message}`, err.stack);
      errors.push(err.message);
      return {
        processed: false,
        signalsReceived,
        ordersExecuted,
        errors,
        portfolioValue: session.currentPortfolioValue ?? session.initialCapital,
        prices: {}
      };
    }
  }

  /** Fetch accounts, prices, and historical candles for the tick. */
  private async fetchMarketData(session: PaperTradingSession, exchangeKey: ExchangeKey): Promise<MarketData> {
    const accounts = await this.portfolioService.loadAccounts(session.id);
    const quoteCurrency = this.portfolioService.getQuoteCurrency(accounts);

    const holdingSymbols = accounts
      .filter((a) => a.currency !== quoteCurrency && a.total > 0)
      .map((a) => `${a.currency}/${quoteCurrency}`);
    const configSymbols = extractSymbolsFromConfig(session.algorithmConfig);
    const allSymbols = [...new Set([...holdingSymbols, ...configSymbols])];
    if (allSymbols.length === 0) {
      allSymbols.push(`BTC/${quoteCurrency}`, `ETH/${quoteCurrency}`);
    }

    const exchangeSlug = exchangeKey.exchange?.slug ?? 'binance_us';
    const prices = await this.marketDataService.getPrices(exchangeSlug, allSymbols);
    const priceMap: Record<string, number> = {};
    for (const [symbol, priceData] of prices) {
      priceMap[symbol] = priceData.price;
    }

    const historicalCandles: Record<string, CandleData[]> = {};
    const candleResults = await Promise.all(
      allSymbols.map(async (symbol) => {
        const candles = await this.marketDataService.getHistoricalCandles(
          exchangeSlug,
          symbol,
          '1h',
          100,
          session.user
        );
        return { symbol, candles };
      })
    );
    for (const { symbol, candles } of candleResults) {
      if (candles.length > 0) historicalCandles[symbol] = candles;
    }

    return { accounts, quoteCurrency, exchangeSlug, priceMap, historicalCandles, allSymbols };
  }

  /** Thin delegate to exit executor. */
  private async runExits(
    session: PaperTradingSession,
    priceMap: Record<string, number>,
    historicalCandles: Record<string, CandleData[]>,
    quoteCurrency: string,
    exchangeSlug: string,
    now: Date
  ): Promise<number> {
    return this.exitExecutor.checkAndExecute(session, priceMap, historicalCandles, quoteCurrency, exchangeSlug, now);
  }

  /** Apply throttle + regime filter chain; persist rejected signals. */
  private async filterSignals(session: PaperTradingSession, signals: TradingSignal[]): Promise<FilteredSignals> {
    const throttleConfig = this.signalThrottle.resolveConfig(session.algorithmConfig, PAPER_TRADING_DEFAULT_THROTTLE_CONFIG);
    const { accepted: throttleAccepted, rejected: throttledSignals } = this.throttleService.filter(
      session.id,
      signals,
      throttleConfig,
      Date.now()
    );

    if (throttledSignals.length > 0) {
      this.logger.debug(`Throttled ${throttledSignals.length}/${signals.length} signals for session ${session.id}`);
      for (const blocked of throttledSignals) {
        const entity = await this.signalService.save(session, blocked);
        await this.signalService.markRejected(entity, SignalReasonCode.SIGNAL_THROTTLED);
      }
    }

    const compositeRegime = this.compositeRegimeService.getCompositeRegime();
    const { maxAllocation, minAllocation } = this.getSessionAllocationLimits(session);
    const regimeResult = this.signalFilterChain.apply(
      throttleAccepted,
      {
        compositeRegime,
        riskLevel: session.riskLevel ?? DEFAULT_RISK_LEVEL,
        regimeGateEnabled: true,
        regimeScaledSizingEnabled: true,
        tradingContext: 'paper'
      },
      { maxAllocation, minAllocation }
    );

    const regimeFilteredSignals = regimeResult.signals as TradingSignal[];

    if (regimeResult.regimeGateBlockedCount > 0) {
      this.logger.debug(
        `Regime gate blocked ${regimeResult.regimeGateBlockedCount} signals in ${compositeRegime} regime for session ${session.id}`
      );
      const regimePassedSignals = new Set<TradingSignal>(regimeFilteredSignals);
      const regimeBlockedSignals = throttleAccepted.filter((s: TradingSignal) => !regimePassedSignals.has(s));
      for (const blocked of regimeBlockedSignals) {
        const entity = await this.signalService.save(session, blocked);
        await this.signalService.markRejected(entity, SignalReasonCode.REGIME_GATE);
      }
    }

    return {
      signals: regimeFilteredSignals,
      allocation: { maxAllocation: regimeResult.maxAllocation, minAllocation: regimeResult.minAllocation }
    };
  }

  /** Iterate filtered signals, execute orders, handle opportunity selling and exit tracking. */
  private async processSignalLoop(
    session: PaperTradingSession,
    filtered: FilteredSignals,
    initialPortfolio: Portfolio,
    heldCoins: Set<string>,
    priceMap: Record<string, number>,
    historicalCandles: Record<string, CandleData[]>,
    quoteCurrency: string,
    exchangeSlug: string,
    now: Date
  ): Promise<SignalLoopResult> {
    const errors: string[] = [];
    let ordersExecuted = 0;
    let currentPortfolio = initialPortfolio;
    const adjustedAllocation = filtered.allocation;

    for (const signal of filtered.signals) {
      if (signal.action === 'BUY') {
        const [baseCurrency] = signal.symbol.split('/');
        if (heldCoins.has(baseCurrency)) {
          this.logger.debug(`Skipped duplicate BUY for ${signal.symbol}: position already held`);
          continue;
        }
      }

      const signalEntity = await this.signalService.save(session, signal);

      try {
        if (signal.action !== 'HOLD') {
          let result = await this.orderExecutor.execute({
            session,
            signal,
            signalEntity,
            portfolio: currentPortfolio,
            prices: priceMap,
            exchangeSlug,
            quoteCurrency,
            timestamp: now,
            allocation: adjustedAllocation
          });

          let opportunitySellingAttempted = false;
          if (result.status === 'insufficient_funds' && signal.action === 'BUY') {
            opportunitySellingAttempted = true;
            const oppSellCount = await this.opportunitySelling.attempt(
              session,
              signal,
              priceMap,
              quoteCurrency,
              exchangeSlug,
              now,
              adjustedAllocation
            );

            if (oppSellCount > 0) {
              ordersExecuted += oppSellCount;
              const { portfolio: updatedRetryPortfolio } = await this.portfolioService.refresh(
                session.id,
                priceMap,
                quoteCurrency
              );
              result = await this.orderExecutor.execute({
                session,
                signal,
                signalEntity,
                portfolio: updatedRetryPortfolio,
                prices: priceMap,
                exchangeSlug,
                quoteCurrency,
                timestamp: now,
                allocation: adjustedAllocation
              });
            }
          }

          if (result.order) {
            ordersExecuted++;
            signalEntity.status = PaperTradingSignalStatus.SIMULATED;

            if (signal.action === 'BUY') {
              const [bought] = signal.symbol.split('/');
              heldCoins.add(bought);
              this.exitExecutor.onBuyFill(session, signal, result.order, historicalCandles);
            }
            if (signal.action === 'SELL') {
              const [sold] = signal.symbol.split('/');
              heldCoins.delete(sold);
              this.exitExecutor.onSellFill(session, signal, result.order);
            }

            ({ portfolio: currentPortfolio } = await this.portfolioService.refresh(
              session.id,
              priceMap,
              quoteCurrency
            ));
          } else {
            signalEntity.status = PaperTradingSignalStatus.REJECTED;
            if (result.status === 'insufficient_funds') {
              signalEntity.rejectionCode = opportunitySellingAttempted
                ? SignalReasonCode.OPPORTUNITY_SELLING_REJECTED
                : SignalReasonCode.INSUFFICIENT_FUNDS;
            } else if (result.status === 'no_price') {
              signalEntity.rejectionCode = SignalReasonCode.SYMBOL_RESOLUTION_FAILED;
            } else if (result.status === 'hold_period') {
              signalEntity.rejectionCode = SignalReasonCode.TRADE_COOLDOWN;
            }
          }
        } else {
          signalEntity.status = PaperTradingSignalStatus.SIMULATED;
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        errors.push(`Failed to execute ${signal.action} order for ${signal.symbol}: ${err.message}`);
        this.logger.warn(`Order execution failed: ${err.message}`);
        signalEntity.status = PaperTradingSignalStatus.ERROR;
      } finally {
        // BUG FIX #5: always mark processed, even if an error is thrown mid-block
        await this.signalService.markProcessed(signalEntity);
      }
    }

    return { ordersExecuted, errors };
  }

  /** Refresh portfolio and optionally take a snapshot. */
  private async finalizeSnapshot(
    session: PaperTradingSession,
    priceMap: Record<string, number>,
    quoteCurrency: string,
    ordersExecuted: number,
    now: Date
  ): Promise<number> {
    const { portfolio: finalPortfolio } = await this.portfolioService.refresh(session.id, priceMap, quoteCurrency);
    const finalPortfolioValue = finalPortfolio.totalValue;
    const shouldSnapshot = session.tickCount % 10 === 0 || ordersExecuted > 0;
    if (shouldSnapshot) {
      await this.snapshotService.save(session, finalPortfolio, finalPortfolioValue, priceMap, quoteCurrency, now);
    }
    return finalPortfolioValue;
  }

  /** Run the algorithm and get trading signals. */
  private async runAlgorithm(
    session: PaperTradingSession,
    portfolio: Portfolio,
    prices: Record<string, number>,
    accounts: PaperTradingAccount[],
    quoteCurrency: string,
    historicalCandles: Record<string, CandleData[]> = {}
  ): Promise<TradingSignal[]> {
    try {
      const coins = extractCoinsFromPrices(prices);
      const priceData = buildPriceDataContext(prices, historicalCandles);
      const positions = this.portfolioService.buildPositionsContext(accounts, quoteCurrency);

      const context: AlgorithmContext = {
        coins,
        priceData,
        timestamp: new Date(),
        config: session.algorithmConfig ?? {},
        positions,
        availableBalance: portfolio.cashBalance,
        metadata: { sessionId: session.id, isPaperTrading: true },
        compositeRegime: this.compositeRegimeService.getCompositeRegime(),
        volatilityRegime: this.compositeRegimeService.getVolatilityRegime()
      };

      const result: AlgorithmResult = await this.algorithmRegistry.executeAlgorithm(
        session.algorithm?.id ?? '',
        context
      );

      if (result.success && result.signals?.length) {
        return result.signals
          .map((signal) => mapStrategySignal(signal, quoteCurrency))
          .filter((signal) => signal.action !== 'HOLD');
      }
      return [];
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Algorithm execution failed: ${err.message}`);
      return [];
    }
  }

  async calculateSessionMetrics(session: PaperTradingSession): Promise<{
    sharpeRatio: number;
    winRate: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    maxDrawdown: number;
  }> {
    return this.snapshotService.calculateSessionMetrics(session);
  }

  private getSessionAllocationLimits(session: PaperTradingSession) {
    return getAllocationLimits(PipelineStage.PAPER_TRADE, session.riskLevel ?? DEFAULT_RISK_LEVEL);
  }

  clearThrottleState(sessionId: string): void {
    this.throttleService.clear(sessionId);
  }

  hasThrottleState(sessionId: string): boolean {
    return this.throttleService.has(sessionId);
  }

  restoreThrottleState(sessionId: string, serializedState: SerializableThrottleState): void {
    this.throttleService.restore(sessionId, serializedState);
  }

  getSerializedThrottleState(sessionId: string): SerializableThrottleState | undefined {
    return this.throttleService.getSerialized(sessionId);
  }

  getSerializedExitTrackerState(sessionId: string): SerializableExitTrackerState | undefined {
    return this.exitExecutor.serialize(sessionId);
  }

  clearExitTracker(sessionId: string): void {
    this.exitExecutor.clear(sessionId);
  }

  /**
   * Sweep in-memory state for sessions that are no longer active.
   * @param activeSessionIds Set of session IDs that are still RUNNING or PAUSED
   */
  sweepOrphanedState(activeSessionIds: Set<string>): number {
    let swept = this.exitExecutor.sweep(activeSessionIds);
    swept += this.throttleService.sweepOrphaned(activeSessionIds);
    return swept;
  }
}
