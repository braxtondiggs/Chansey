import { Injectable, Logger } from '@nestjs/common';

import { getAllocationLimits, PipelineStage, SignalReasonCode } from '@chansey/api-interfaces';

import { resolveOpportunitySellingConfig, TradingSignal } from './paper-trading-engine.utils';
import { PaperTradingOrderExecutorService } from './paper-trading-order-executor.service';
import { PaperTradingPortfolioService } from './paper-trading-portfolio.service';
import { PaperTradingSignalService } from './paper-trading-signal.service';

import { DEFAULT_RISK_LEVEL } from '../../../risk/risk.constants';
import { toErrorInfo } from '../../../shared/error.util';
import { FeeCalculatorService } from '../../backtest/shared';
import { PositionAnalysisService } from '../../services/position-analysis.service';
import { PaperTradingSession, PaperTradingSignalStatus } from '../entities';

/**
 * Attempts to sell weakest positions to free cash for a higher-confidence BUY signal.
 * Mirrors the BacktestEngine pattern using PositionAnalysisService for scoring.
 */
@Injectable()
export class PaperTradingOpportunitySellingService {
  private readonly logger = new Logger(PaperTradingOpportunitySellingService.name);

  constructor(
    private readonly portfolioService: PaperTradingPortfolioService,
    private readonly signalService: PaperTradingSignalService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly positionAnalysis: PositionAnalysisService,
    private readonly orderExecutor: PaperTradingOrderExecutorService
  ) {}

  /**
   * @returns number of sell orders executed
   */
  async attempt(
    session: PaperTradingSession,
    buySignal: TradingSignal,
    priceMap: Record<string, number>,
    quoteCurrency: string,
    exchangeSlug: string,
    timestamp: Date,
    allocationOverrides?: { maxAllocation: number; minAllocation: number }
  ): Promise<number> {
    const { enabled, config } = resolveOpportunitySellingConfig(session.algorithmConfig);
    if (!enabled) return 0;

    const buyConfidence = buySignal.confidence ?? 0;
    if (buyConfidence < config.minOpportunityConfidence) return 0;

    const accounts = await this.portfolioService.loadAccounts(session.id);
    const updatedPortfolio = this.portfolioService.updateWithPrices(
      this.portfolioService.buildFromAccounts(accounts, quoteCurrency),
      priceMap,
      quoteCurrency
    );

    // Estimate the required buy amount
    const buyPrice = priceMap[buySignal.symbol];
    if (!buyPrice) return 0;

    const { maxAllocation, minAllocation } = allocationOverrides ?? this.getSessionAllocationLimits(session);
    let requiredAmount: number;
    if (buySignal.quantity) {
      requiredAmount = buySignal.quantity * buyPrice;
    } else if (buySignal.percentage) {
      requiredAmount = updatedPortfolio.totalValue * Math.min(buySignal.percentage, maxAllocation);
    } else if (buySignal.confidence !== undefined) {
      const alloc = minAllocation + buySignal.confidence * (maxAllocation - minAllocation);
      requiredAmount = updatedPortfolio.totalValue * alloc;
    } else {
      requiredAmount = updatedPortfolio.totalValue * minAllocation;
    }

    // Fee estimate
    const feeConfig = this.feeCalculator.fromFlatRate(session.tradingFee);
    const estFee = this.feeCalculator.calculateFee({ tradeValue: requiredAmount }, feeConfig).fee;
    const totalRequired = requiredAmount + estFee;

    if (updatedPortfolio.cashBalance >= totalRequired) return 0; // No shortfall

    const shortfall = totalRequired - updatedPortfolio.cashBalance;

    // Score and rank eligible positions
    const eligible: { coinId: string; score: number; quantity: number; price: number }[] = [];

    for (const [coinId, position] of updatedPortfolio.positions) {
      if (coinId === buySignal.coinId) continue;
      if (config.protectedCoins.includes(coinId)) continue;

      const symbol = `${coinId}/${quoteCurrency}`;
      const currentPrice = priceMap[symbol];
      if (!currentPrice || currentPrice <= 0) continue;

      const account = accounts.find((a) => a.currency === coinId);
      const score = this.positionAnalysis.calculatePositionSellScore(
        {
          coinId,
          averagePrice: account?.averageCost ?? position.averagePrice,
          quantity: position.quantity,
          entryDate: account?.entryDate
        },
        currentPrice,
        buyConfidence,
        config,
        timestamp
      );

      if (score.eligible) {
        eligible.push({ coinId, score: score.totalScore, quantity: position.quantity, price: currentPrice });
      }
    }

    if (eligible.length === 0) return 0;

    // Sort by score ASC (lowest = sell first)
    eligible.sort((a, b) => a.score - b.score);

    // Execute sells to cover the shortfall, respecting maxLiquidationPercent cap
    const maxSellValue = (updatedPortfolio.totalValue * config.maxLiquidationPercent) / 100;
    let coveredAmount = 0;
    let sellCount = 0;

    for (const candidate of eligible) {
      if (coveredAmount >= shortfall) break;
      if (coveredAmount >= maxSellValue) break;

      const remainingNeeded = Math.min(shortfall - coveredAmount, maxSellValue - coveredAmount);
      const sellQuantity = Math.min(candidate.quantity, remainingNeeded / candidate.price);
      if (sellQuantity <= 0) continue;

      const sellSignal: TradingSignal = {
        action: 'SELL',
        coinId: candidate.coinId,
        symbol: `${candidate.coinId}/${quoteCurrency}`,
        quantity: sellQuantity,
        reason: `Opportunity sell: freeing cash for ${buySignal.coinId} BUY (confidence ${buyConfidence.toFixed(2)})`,
        confidence: buyConfidence,
        metadata: { opportunitySell: true, targetBuyCoinId: buySignal.coinId }
      };

      const signalEntity = await this.signalService.save(session, sellSignal);

      try {
        const result = await this.orderExecutor.execute({
          session,
          signal: sellSignal,
          signalEntity,
          portfolio: updatedPortfolio,
          prices: priceMap,
          exchangeSlug,
          quoteCurrency,
          timestamp,
          allocation: this.getSessionAllocationLimits(session)
        });

        if (result.order) {
          coveredAmount += (result.order.totalValue ?? 0) - (result.order.fee ?? 0);
          sellCount++;
          signalEntity.status = PaperTradingSignalStatus.SIMULATED;
        } else {
          signalEntity.status = PaperTradingSignalStatus.REJECTED;
          signalEntity.rejectionCode = SignalReasonCode.INSUFFICIENT_FUNDS;
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        signalEntity.status = PaperTradingSignalStatus.ERROR;
        this.logger.warn(`Opportunity sell failed for ${candidate.coinId}: ${err.message}`);
      }

      await this.signalService.markProcessed(signalEntity);
    }

    if (sellCount > 0) {
      this.logger.log(
        `Opportunity selling: executed ${sellCount} sells to free cash for ${buySignal.coinId} BUY (session ${session.id})`
      );
    }

    return sellCount;
  }

  private getSessionAllocationLimits(session: PaperTradingSession) {
    return getAllocationLimits(PipelineStage.PAPER_TRADE, session.riskLevel ?? DEFAULT_RISK_LEVEL);
  }
}
