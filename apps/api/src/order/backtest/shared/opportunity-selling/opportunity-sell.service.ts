import { Injectable, Logger } from '@nestjs/common';

import { getAllocationLimits } from '@chansey/api-interfaces';

import { Coin } from '../../../../coin/coin.entity';
import { OHLCCandle } from '../../../../ohlc/ohlc-candle.entity';
import { OpportunitySellingUserConfig } from '../../../interfaces/opportunity-selling.interface';
import { PositionAnalysisService } from '../../../services/position-analysis.service';
import { BacktestTrade } from '../../backtest-trade.entity';
import { Backtest } from '../../backtest.entity';
import { SimulatedOrderFill, SimulatedOrderStatus, SimulatedOrderType } from '../../simulated-order-fill.entity';
import { FeeCalculatorService } from '../fees';
import { Portfolio } from '../portfolio';
import { SlippageConfig } from '../slippage';
import { BuildSpreadContextFn, ExecuteTradeFn, ExtractDailyVolumeFn, MarketData, TradingSignal } from '../types';

/**
 * Opportunity Sell Service
 *
 * Evaluates and executes opportunity-based selling: when a high-confidence BUY
 * signal fires but cash is insufficient, this service identifies underperforming
 * positions to liquidate and covers the shortfall.
 *
 * Extracted from BacktestEngine to be reusable across all simulation modes
 * (historical, live-replay, paper trading).
 */
@Injectable()
export class OpportunitySellService {
  private readonly logger = new Logger('OpportunitySellService');

  constructor(
    private readonly feeCalculator: FeeCalculatorService,
    private readonly positionAnalysis: PositionAnalysisService
  ) {}

  /**
   * Attempt opportunity-based selling to free cash for a high-confidence buy.
   *
   * If the buy signal has sufficient confidence and the portfolio lacks cash,
   * eligible positions are scored and sold to cover the shortfall. Trades are
   * appended to the provided arrays.
   *
   * @returns true if sells were executed and the buy should be re-attempted
   */
  async attemptOpportunitySelling(
    buySignal: TradingSignal,
    portfolio: Portfolio,
    marketData: MarketData,
    tradingFee: number,
    slippageConfig: SlippageConfig,
    config: OpportunitySellingUserConfig,
    coinMap: Map<string, Coin>,
    quoteCoin: Coin,
    backtest: Backtest,
    timestamp: Date,
    trades: Partial<BacktestTrade>[],
    simulatedFills: Partial<SimulatedOrderFill>[],
    executeTradeFn: ExecuteTradeFn,
    buildSpreadContextFn: BuildSpreadContextFn,
    extractDailyVolumeFn?: ExtractDailyVolumeFn,
    maxAllocation: number = getAllocationLimits().maxAllocation,
    minAllocation: number = getAllocationLimits().minAllocation,
    currentPrices?: OHLCCandle[],
    prevCandleMap?: Map<string, OHLCCandle>
  ): Promise<boolean> {
    const buyConfidence = buySignal.confidence ?? 0;

    // Gate: confidence threshold
    if (buyConfidence < config.minOpportunityConfidence) return false;

    // Estimate the required buy amount
    const buyPrice = marketData.prices.get(buySignal.coinId);
    if (!buyPrice) return false;

    let requiredAmount: number;
    if (buySignal.quantity) {
      requiredAmount = buySignal.quantity * buyPrice;
    } else if (buySignal.percentage) {
      requiredAmount = portfolio.totalValue * buySignal.percentage;
    } else if (buySignal.confidence !== undefined) {
      const alloc = minAllocation + buySignal.confidence * (maxAllocation - minAllocation);
      requiredAmount = portfolio.totalValue * alloc;
    } else {
      requiredAmount = portfolio.totalValue * minAllocation;
    }

    // Fee estimate
    const feeConfig = this.feeCalculator.fromFlatRate(tradingFee);
    const estFee = this.feeCalculator.calculateFee({ tradeValue: requiredAmount }, feeConfig).fee;
    const totalRequired = requiredAmount + estFee;

    if (portfolio.cashBalance >= totalRequired) return false; // No shortfall

    const shortfall = totalRequired - portfolio.cashBalance;

    // Score and rank eligible positions
    const eligible = this.scoreEligiblePositions(
      portfolio,
      buySignal.coinId,
      buyConfidence,
      config,
      marketData,
      timestamp
    );
    if (eligible.length === 0) return false;

    // Execute sells to cover the shortfall
    const maxSellValue = (portfolio.totalValue * config.maxLiquidationPercent) / 100;
    return this.executeSellPlan(
      eligible,
      shortfall,
      maxSellValue,
      buySignal,
      buyConfidence,
      totalRequired,
      portfolio,
      marketData,
      tradingFee,
      slippageConfig,
      coinMap,
      quoteCoin,
      backtest,
      timestamp,
      trades,
      simulatedFills,
      executeTradeFn,
      buildSpreadContextFn,
      extractDailyVolumeFn,
      currentPrices,
      prevCandleMap
    );
  }

  /**
   * Score all portfolio positions for opportunity selling eligibility.
   * Returns sorted candidates (lowest score = sell first).
   */
  scoreEligiblePositions(
    portfolio: Portfolio,
    buyCoinId: string,
    buyConfidence: number,
    config: OpportunitySellingUserConfig,
    marketData: MarketData,
    timestamp: Date
  ): { coinId: string; score: number; quantity: number; price: number }[] {
    const eligible: { coinId: string; score: number; quantity: number; price: number }[] = [];

    for (const [coinId, position] of portfolio.positions) {
      if (coinId === buyCoinId) continue;
      if (config.protectedCoins.includes(coinId)) continue;

      const currentPrice = marketData.prices.get(coinId);
      if (!currentPrice || currentPrice <= 0) continue;

      const score = this.positionAnalysis.calculatePositionSellScore(
        position,
        currentPrice,
        buyConfidence,
        config,
        timestamp
      );

      if (score.eligible) {
        eligible.push({ coinId, score: score.totalScore, quantity: position.quantity, price: currentPrice });
      }
    }

    // Sort by score ASC (lowest = sell first)
    eligible.sort((a, b) => a.score - b.score);
    return eligible;
  }

  /**
   * Execute sells from ranked candidates to cover a cash shortfall.
   * Appends resulting trades and fills to the provided arrays.
   *
   * @returns true if any sells were executed
   */
  async executeSellPlan(
    candidates: { coinId: string; score: number; quantity: number; price: number }[],
    shortfall: number,
    maxSellValue: number,
    buySignal: TradingSignal,
    buyConfidence: number,
    totalRequired: number,
    portfolio: Portfolio,
    marketData: MarketData,
    tradingFee: number,
    slippageConfig: SlippageConfig,
    coinMap: Map<string, Coin>,
    quoteCoin: Coin,
    backtest: Backtest,
    timestamp: Date,
    trades: Partial<BacktestTrade>[],
    simulatedFills: Partial<SimulatedOrderFill>[],
    executeTradeFn: ExecuteTradeFn,
    buildSpreadContextFn: BuildSpreadContextFn,
    extractDailyVolumeFn?: ExtractDailyVolumeFn,
    currentPrices?: OHLCCandle[],
    prevCandleMap?: Map<string, OHLCCandle>
  ): Promise<boolean> {
    let remainingShortfall = shortfall;
    let totalSellValue = 0;
    let sellExecuted = false;

    const priceMap = currentPrices ? new Map(currentPrices.map((c) => [c.coinId, c])) : undefined;

    for (const candidate of candidates) {
      if (remainingShortfall <= 0 || totalSellValue >= maxSellValue) break;

      const maxByShortfall = remainingShortfall / candidate.price;
      const maxByLiquidation = (maxSellValue - totalSellValue) / candidate.price;
      const quantity = Math.min(candidate.quantity, maxByShortfall, maxByLiquidation);
      if (quantity <= 0) continue;

      // Execute the sell on the in-memory portfolio
      const sellSignal: TradingSignal = {
        action: 'SELL',
        coinId: candidate.coinId,
        quantity,
        reason: `Opportunity sell: freeing cash for ${buySignal.coinId} buy (confidence=${(buyConfidence * 100).toFixed(0)}%)`,
        confidence: buyConfidence,
        metadata: {
          opportunitySell: true,
          buyTargetCoin: buySignal.coinId,
          buyConfidence,
          shortfall,
          totalRequired,
          eligibleCount: candidates.length,
          candidateScore: candidate.score,
          remainingShortfall
        }
      };

      // Use minHoldMs=0 so the sell isn't blocked by hold period (already checked by scoring)
      const spreadCtx =
        priceMap && prevCandleMap ? buildSpreadContextFn(priceMap, candidate.coinId, prevCandleMap) : undefined;
      const candidateDailyVolume =
        extractDailyVolumeFn && priceMap ? extractDailyVolumeFn(priceMap, candidate.coinId) : undefined;
      const sellResult = await executeTradeFn({
        signal: sellSignal,
        portfolio,
        marketData,
        tradingFee,
        slippageConfig,
        dailyVolume: candidateDailyVolume,
        minHoldMs: 0,
        defaultLeverage: 1,
        spreadContext: spreadCtx
      });
      if (sellResult) {
        const { trade, slippageBps, fillStatus } = sellResult;
        if (fillStatus === SimulatedOrderStatus.CANCELLED) {
          simulatedFills.push({
            orderType: SimulatedOrderType.MARKET,
            status: SimulatedOrderStatus.CANCELLED,
            filledQuantity: 0,
            averagePrice: trade.price,
            fees: 0,
            slippageBps,
            executionTimestamp: timestamp,
            instrument: candidate.coinId,
            metadata: {
              ...(trade.metadata ?? {}),
              opportunitySell: true,
              requestedQuantity: sellResult.requestedQuantity
            },
            backtest
          });
        } else {
          const baseCoin = coinMap.get(candidate.coinId);

          trades.push({ ...trade, executedAt: timestamp, backtest, baseCoin: baseCoin || undefined, quoteCoin });
          simulatedFills.push({
            orderType: SimulatedOrderType.MARKET,
            status: fillStatus,
            filledQuantity: trade.quantity,
            averagePrice: trade.price,
            fees: trade.fee,
            slippageBps,
            executionTimestamp: timestamp,
            instrument: candidate.coinId,
            metadata: { ...(trade.metadata ?? {}), opportunitySell: true },
            backtest
          });

          if (trade.price == null || trade.quantity == null) {
            this.logger.warn(`Trade result missing price/quantity for ${candidate.coinId}`);
            continue;
          }
          totalSellValue += trade.quantity * trade.price;
          remainingShortfall -= trade.quantity * trade.price;
          sellExecuted = true;
        }
      }
    }

    return sellExecuted;
  }
}
