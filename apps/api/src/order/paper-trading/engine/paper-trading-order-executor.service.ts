import { Injectable, Logger } from '@nestjs/common';

import { Decimal } from 'decimal.js';
import { DataSource, EntityManager } from 'typeorm';

import { ExecuteOrderResult, TradingSignal, resolveMinHoldMs } from './paper-trading-engine.utils';

import { SignalType as AlgoSignalType } from '../../../algorithm/interfaces';
import { FeeCalculatorService, Portfolio } from '../../backtest/shared';
import {
  PaperTradingAccount,
  PaperTradingExitType,
  PaperTradingOrder,
  PaperTradingOrderSide,
  PaperTradingOrderStatus,
  PaperTradingOrderType,
  PaperTradingSession,
  PaperTradingSignal
} from '../entities';
import { PaperTradingMarketDataService } from '../paper-trading-market-data.service';

export interface ExecuteOrderContext {
  session: PaperTradingSession;
  signal: TradingSignal;
  signalEntity: PaperTradingSignal;
  portfolio: Portfolio;
  prices: Record<string, number>;
  exchangeSlug: string;
  quoteCurrency: string;
  timestamp: Date;
  allocation: { maxAllocation: number; minAllocation: number };
  exitType?: PaperTradingExitType;
}

/**
 * Executes BUY/SELL paper trading orders atomically within a transaction.
 * Extracted from PaperTradingEngineService as part of the engine refactor.
 *
 * Two intentional behavior changes vs. the legacy implementation:
 *  - SELL sizing (BUG #3): no more `0.25 + confidence * 0.75` blend and no 25%
 *    fallback. Priority is: explicit quantity → explicit percentage → confidence
 *    (used directly as a fraction of held quantity) → 100% of held quantity.
 *  - Realized PnL percent (BUG #4): numerator is now
 *    `proceeds - fee - costBasisTotal`, so fees are included in the percent.
 */
@Injectable()
export class PaperTradingOrderExecutorService {
  private readonly logger = new Logger(PaperTradingOrderExecutorService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly marketDataService: PaperTradingMarketDataService
  ) {}

  async execute(ctx: ExecuteOrderContext): Promise<ExecuteOrderResult> {
    const { signal, prices, exchangeSlug, portfolio } = ctx;
    const basePrice = prices[signal.symbol];
    if (!basePrice) {
      this.logger.warn(`No price data available for ${signal.symbol}`);
      return { status: 'no_price', order: null };
    }

    const isBuy = signal.action === 'BUY';

    const slippageResult = await this.marketDataService.calculateRealisticSlippage(
      exchangeSlug,
      signal.symbol,
      signal.quantity ?? (portfolio.totalValue * 0.1) / basePrice,
      isBuy ? 'BUY' : 'SELL'
    );

    const executionPrice =
      slippageResult.estimatedPrice || basePrice * (1 + ((isBuy ? 1 : -1) * slippageResult.slippageBps) / 10000);
    const slippageBps = slippageResult.slippageBps;

    return this.dataSource.transaction(async (txManager) => {
      const [baseCurrency] = signal.symbol.split('/');

      const quoteAccount = await txManager.findOne(PaperTradingAccount, {
        where: { session: { id: ctx.session.id }, currency: ctx.quoteCurrency },
        lock: { mode: 'pessimistic_write' }
      });

      const baseAccount = await txManager.findOne(PaperTradingAccount, {
        where: { session: { id: ctx.session.id }, currency: baseCurrency },
        lock: { mode: 'pessimistic_write' }
      });

      if (!quoteAccount) {
        throw new Error(`Quote currency account (${ctx.quoteCurrency}) not found`);
      }

      if (isBuy) {
        return this.executeBuy(ctx, {
          txManager,
          baseCurrency,
          basePrice,
          executionPrice,
          slippageBps,
          quoteAccount,
          baseAccount
        });
      }

      return this.executeSell(ctx, {
        txManager,
        baseCurrency,
        basePrice,
        executionPrice,
        slippageBps,
        quoteAccount,
        baseAccount
      });
    });
  }

  private calculateBuyQuantity(
    signal: TradingSignal,
    portfolio: Portfolio,
    executionPrice: number,
    allocation: { maxAllocation: number; minAllocation: number }
  ): number {
    const { maxAllocation, minAllocation } = allocation;

    if (signal.quantity) {
      const maxQuantity = (portfolio.totalValue * maxAllocation) / executionPrice;
      if (signal.quantity > maxQuantity) {
        this.logger.warn(
          `Capping explicit BUY quantity from ${signal.quantity} to ${maxQuantity} (${maxAllocation * 100}% cap)`
        );
        return maxQuantity;
      }
      return signal.quantity;
    }
    if (signal.percentage) {
      const investmentAmount = portfolio.totalValue * Math.min(signal.percentage, maxAllocation);
      return investmentAmount / executionPrice;
    }
    if (signal.confidence !== undefined) {
      const alloc = minAllocation + signal.confidence * (maxAllocation - minAllocation);
      return (portfolio.totalValue * alloc) / executionPrice;
    }
    return (portfolio.totalValue * minAllocation) / executionPrice;
  }

  /**
   * BUG #3 fix — SELL sizing.
   * Priority:
   *  1. `signal.quantity` (capped to held)
   *  2. `signal.percentage` → percentage * heldQty
   *  3. `signal.confidence` → confidence * heldQty
   *  4. default → 100% of heldQty
   */
  private calculateSellQuantity(signal: TradingSignal, heldQty: number): number {
    if (signal.quantity) return Math.min(signal.quantity, heldQty);
    if (signal.percentage) return heldQty * Math.min(signal.percentage, 1);
    if (signal.confidence !== undefined) return heldQty * Math.min(Math.max(signal.confidence, 0), 1);
    return heldQty;
  }

  private async executeBuy(
    ctx: ExecuteOrderContext,
    args: {
      txManager: EntityManager;
      baseCurrency: string;
      basePrice: number;
      executionPrice: number;
      slippageBps: number;
      quoteAccount: PaperTradingAccount;
      baseAccount: PaperTradingAccount | null;
    }
  ): Promise<ExecuteOrderResult> {
    const { session, signal, signalEntity, portfolio, quoteCurrency, timestamp, exitType, allocation } = ctx;
    const { txManager, baseCurrency, basePrice, executionPrice, slippageBps, quoteAccount } = args;
    let { baseAccount } = args;

    const quantity = this.calculateBuyQuantity(signal, portfolio, executionPrice, allocation);

    const dQuantity = new Decimal(quantity);
    const dExecutionPrice = new Decimal(executionPrice);
    const totalValue = dQuantity.mul(dExecutionPrice).toNumber();

    const feeConfig = this.feeCalculator.fromFlatRate(session.tradingFee);
    const feeResult = this.feeCalculator.calculateFee({ tradeValue: totalValue }, feeConfig);
    const fee = feeResult.fee;

    const totalCost = new Decimal(totalValue).plus(fee);
    if (new Decimal(quoteAccount.available).lt(totalCost)) {
      this.logger.warn(
        `Insufficient ${quoteCurrency} balance for BUY order: need ${totalCost.toFixed(2)}, have ${quoteAccount.available.toFixed(
          2
        )}`
      );
      return { status: 'insufficient_funds', order: null };
    }

    quoteAccount.available = new Decimal(quoteAccount.available).minus(totalCost).toNumber();
    await txManager.save(quoteAccount);

    if (!baseAccount) {
      baseAccount = txManager.create(PaperTradingAccount, {
        currency: baseCurrency,
        available: 0,
        locked: 0,
        entryDate: timestamp,
        session
      });
    }
    const acct = baseAccount;
    const oldQuantity = acct.available;
    if (!acct.entryDate || oldQuantity === 0) {
      acct.entryDate = timestamp;
    }

    const dOldCost = new Decimal(acct.averageCost ?? 0);
    const dOldQuantity = new Decimal(oldQuantity);
    const dNewQuantity = dOldQuantity.plus(dQuantity);
    acct.averageCost = dOldQuantity.gt(0)
      ? dOldCost.mul(dOldQuantity).plus(dExecutionPrice.mul(dQuantity)).div(dNewQuantity).toNumber()
      : executionPrice;
    acct.available = dNewQuantity.toNumber();
    await txManager.save(acct);

    const order = txManager.create(PaperTradingOrder, {
      side: PaperTradingOrderSide.BUY,
      orderType: PaperTradingOrderType.MARKET,
      status: PaperTradingOrderStatus.FILLED,
      symbol: signal.symbol,
      baseCurrency,
      quoteCurrency,
      requestedQuantity: quantity,
      filledQuantity: quantity,
      executedPrice: executionPrice,
      averagePrice: executionPrice,
      slippageBps,
      fee,
      feeAsset: quoteCurrency,
      totalValue,
      executedAt: timestamp,
      session,
      signal: signalEntity,
      ...(exitType && { exitType }),
      metadata: {
        reason: signal.reason,
        confidence: signal.confidence,
        basePrice
      }
    });

    return { status: 'success', order: await txManager.save(order) };
  }

  private async executeSell(
    ctx: ExecuteOrderContext,
    args: {
      txManager: EntityManager;
      baseCurrency: string;
      basePrice: number;
      executionPrice: number;
      slippageBps: number;
      quoteAccount: PaperTradingAccount;
      baseAccount: PaperTradingAccount | null;
    }
  ): Promise<ExecuteOrderResult> {
    const { session, signal, signalEntity, quoteCurrency, timestamp, exitType } = ctx;
    const { txManager, baseCurrency, basePrice, executionPrice, slippageBps, quoteAccount, baseAccount } = args;

    if (!baseAccount || baseAccount.available <= 0) {
      this.logger.debug(`No ${baseCurrency} position to sell`);
      return { status: 'no_position', order: null };
    }

    const minHoldMs = resolveMinHoldMs(session.algorithmConfig);
    const isRiskControl =
      signal.originalType === AlgoSignalType.STOP_LOSS || signal.originalType === AlgoSignalType.TAKE_PROFIT;

    if (!isRiskControl && minHoldMs > 0 && baseAccount.entryDate) {
      const holdTimeMs = timestamp.getTime() - baseAccount.entryDate.getTime();
      if (holdTimeMs < minHoldMs) {
        this.logger.debug(
          `Hold period not met for ${baseCurrency}: held ${Math.round(holdTimeMs / 3600000)}h, min ${Math.round(
            minHoldMs / 3600000
          )}h`
        );
        return { status: 'hold_period', order: null };
      }
    }

    const costBasis = baseAccount.averageCost ?? 0;

    const quantity = this.calculateSellQuantity(signal, baseAccount.available);

    const dSellQuantity = new Decimal(quantity);
    const dSellPrice = new Decimal(executionPrice);
    const totalValue = dSellQuantity.mul(dSellPrice).toNumber();

    const feeConfig = this.feeCalculator.fromFlatRate(session.tradingFee);
    const feeResult = this.feeCalculator.calculateFee({ tradeValue: totalValue }, feeConfig);
    const fee = feeResult.fee;

    const dCostBasis = new Decimal(costBasis);
    const dFee = new Decimal(fee);
    const dCostBasisTotal = dCostBasis.mul(dSellQuantity);
    const realizedPnL = dSellPrice.minus(dCostBasis).mul(dSellQuantity).minus(dFee).toNumber();
    // BUG #4 fix: include fee in realizedPnLPercent numerator.
    const realizedPnLPercent = dCostBasisTotal.gt(0)
      ? new Decimal(totalValue).minus(dFee).minus(dCostBasisTotal).div(dCostBasisTotal).toNumber()
      : 0;

    baseAccount.available = new Decimal(baseAccount.available).minus(dSellQuantity).toNumber();
    if (baseAccount.available < 0.00000001) {
      baseAccount.available = 0;
      baseAccount.averageCost = undefined;
      baseAccount.entryDate = undefined;
    }
    await txManager.save(baseAccount);

    quoteAccount.available = new Decimal(quoteAccount.available).plus(new Decimal(totalValue).minus(dFee)).toNumber();
    await txManager.save(quoteAccount);

    const order = txManager.create(PaperTradingOrder, {
      side: PaperTradingOrderSide.SELL,
      orderType: PaperTradingOrderType.MARKET,
      status: PaperTradingOrderStatus.FILLED,
      symbol: signal.symbol,
      baseCurrency,
      quoteCurrency,
      requestedQuantity: quantity,
      filledQuantity: quantity,
      executedPrice: executionPrice,
      averagePrice: executionPrice,
      slippageBps,
      fee,
      feeAsset: quoteCurrency,
      totalValue,
      realizedPnL,
      realizedPnLPercent,
      costBasis,
      executedAt: timestamp,
      session,
      signal: signalEntity,
      ...(exitType && { exitType }),
      metadata: {
        reason: signal.reason,
        confidence: signal.confidence,
        basePrice
      }
    });

    return { status: 'success', order: await txManager.save(order) };
  }
}
