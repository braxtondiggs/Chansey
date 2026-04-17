import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { BalanceService } from '../../balance/balance.service';
import { Coin } from '../../coin/coin.entity';
import { CoinSelectionSource } from '../../coin-selection/coin-selection-source.enum';
import { CoinSelectionType } from '../../coin-selection/coin-selection-type.enum';
import { CoinSelectionService } from '../../coin-selection/coin-selection.service';
import {
  ExitConfig,
  StopLossType,
  TakeProfitType,
  TrailingActivationType,
  TrailingType
} from '../../order/interfaces/exit-config.interface';
import { Order } from '../../order/order.entity';
import { TradeExecutionService, TradeSignalWithExit } from '../../order/services/trade-execution.service';
import { toErrorInfo } from '../../shared/error.util';
import { User } from '../../users/users.entity';
import { LISTING_STRATEGY_NAMES, ListingStrategyConfig, resolveExpiryDate } from '../constants/risk-config';
import { ListingAnnouncement } from '../entities/listing-announcement.entity';
import { ListingCandidate } from '../entities/listing-candidate.entity';
import {
  ListingPositionStatus,
  ListingStrategyType,
  ListingTradePosition
} from '../entities/listing-trade-position.entity';

export interface ExecuteListingBuyInput {
  user: User;
  coin: Coin;
  strategyType: ListingStrategyType;
  config: ListingStrategyConfig;
  announcementId?: string | null;
  candidateId?: string | null;
}

export interface ExecuteListingSellInput {
  position: ListingTradePosition;
  nextStatus: ListingPositionStatus;
  reason: string;
}

@Injectable()
export class ListingTradeExecutorService {
  private readonly logger = new Logger(ListingTradeExecutorService.name);

  constructor(
    @InjectRepository(ListingTradePosition)
    private readonly positionRepo: Repository<ListingTradePosition>,
    @InjectRepository(ListingAnnouncement)
    private readonly announcementRepo: Repository<ListingAnnouncement>,
    @InjectRepository(ListingCandidate)
    private readonly candidateRepo: Repository<ListingCandidate>,
    @Inject(forwardRef(() => TradeExecutionService))
    private readonly tradeExecutionService: TradeExecutionService,
    @Inject(forwardRef(() => CoinSelectionService))
    private readonly coinSelectionService: CoinSelectionService,
    @Inject(forwardRef(() => BalanceService))
    private readonly balanceService: BalanceService
  ) {}

  /**
   * Execute a BUY for a listing event and persist the resulting position.
   */
  async executeBuy(input: ExecuteListingBuyInput): Promise<ListingTradePosition | null> {
    const { user, coin, strategyType, config, announcementId, candidateId } = input;
    const strategyName =
      strategyType === ListingStrategyType.PRE_LISTING
        ? LISTING_STRATEGY_NAMES.PRE_LISTING
        : LISTING_STRATEGY_NAMES.POST_ANNOUNCEMENT;

    this.logger.log(`[${strategyName}] user=${user.id} coin=${coin.symbol} attempting BUY`);

    // Ensure coin is tracked (triggers OHLC backfill as a side effect)
    try {
      await this.coinSelectionService.createCoinSelectionItem(
        { coinId: coin.id, type: CoinSelectionType.AUTOMATIC, source: CoinSelectionSource.LISTING },
        user
      );
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to auto-track coin ${coin.symbol}: ${err.message}`);
    }

    const portfolioValue = await this.calculatePortfolioValue(user);
    if (portfolioValue <= 0) {
      this.logger.warn(`[${strategyName}] user=${user.id} skipped: portfolio value is 0`);
      return null;
    }

    const exitConfig = this.buildExitConfig(config);

    const signal: TradeSignalWithExit = {
      userId: user.id,
      action: 'BUY',
      symbol: `${coin.symbol.toUpperCase()}/USDT`,
      quantity: 0,
      autoSize: true,
      portfolioValue,
      allocationPercentage: config.positionSizePct,
      exitConfig
    };

    let order: Order;
    try {
      order = await this.tradeExecutionService.executeTradeSignal(signal);
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(`[${strategyName}] user=${user.id} trade failed: ${err.message}`, err.stack);
      return null;
    }

    const position = this.positionRepo.create({
      userId: user.id,
      orderId: order.id,
      strategyType,
      coinId: coin.id,
      announcementId: announcementId ?? null,
      candidateId: candidateId ?? null,
      expiresAt: resolveExpiryDate(config),
      status: ListingPositionStatus.OPEN,
      metadata: { strategy: strategyName, positionSizePct: config.positionSizePct }
    });
    const saved = await this.positionRepo.save(position);

    if (announcementId) {
      await this.announcementRepo.update({ id: announcementId }, { dispatched: true });
    }
    if (candidateId) {
      await this.candidateRepo.update({ id: candidateId }, { lastTradedAt: new Date() });
    }

    return saved;
  }

  /**
   * Close a listing position with a SELL order and update status.
   */
  async closePosition(input: ExecuteListingSellInput): Promise<ListingTradePosition | null> {
    const { position, nextStatus, reason } = input;

    const order = await this.positionRepo.manager.findOne(Order, {
      where: { id: position.orderId },
      relations: ['baseCoin', 'quoteCoin']
    });
    if (!order) {
      this.logger.warn(`Cannot close position ${position.id}: entry order ${position.orderId} not found`);
      return null;
    }

    const quantity = order.executedQuantity || order.quantity;
    if (quantity <= 0) {
      this.logger.warn(`Cannot close position ${position.id}: entry quantity is 0`);
      position.status = ListingPositionStatus.CLOSED;
      return this.positionRepo.save(position);
    }

    const signal: TradeSignalWithExit = {
      userId: position.userId,
      action: 'SELL',
      symbol: order.symbol,
      quantity,
      exchangeKeyId: order.exchangeKeyId
    };

    try {
      await this.tradeExecutionService.executeTradeSignal(signal);
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to close listing position ${position.id} (${reason}): ${err.message}`, err.stack);
      return null;
    }

    position.status = nextStatus;
    position.metadata = { ...(position.metadata ?? {}), closedReason: reason, closedAt: new Date().toISOString() };
    return this.positionRepo.save(position);
  }

  /**
   * Count active listing positions for a user in a given strategy mode.
   */
  async countActivePositions(userId: string, strategyType: ListingStrategyType): Promise<number> {
    return this.positionRepo.count({
      where: { userId, strategyType, status: ListingPositionStatus.OPEN }
    });
  }

  /**
   * Check whether the user already has an OPEN position for this coin.
   */
  async hasOpenPositionForCoin(userId: string, coinId: string): Promise<boolean> {
    const existing = await this.positionRepo.count({
      where: { userId, coinId, status: ListingPositionStatus.OPEN }
    });
    return existing > 0;
  }

  private async calculatePortfolioValue(user: User): Promise<number> {
    try {
      const balances = await this.balanceService.getCurrentBalances(user);
      return balances.reduce((sum, exchange) => sum + (exchange.totalUsdValue ?? 0), 0);
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to fetch portfolio value for user ${user.id}: ${err.message}`);
      return 0;
    }
  }

  /**
   * Translate a risk-level listing config into the shared `ExitConfig` shape.
   * Uses the first take-profit rung as the primary TP; deeper rungs can be
   * added in a future iteration via partial-fill ladder orders.
   */
  private buildExitConfig(config: ListingStrategyConfig): Partial<ExitConfig> {
    const firstTp = config.takeProfitLadder[0] ?? 0;
    return {
      enableStopLoss: true,
      stopLossType: StopLossType.PERCENTAGE,
      stopLossValue: config.stopLossPct,
      enableTakeProfit: firstTp > 0,
      takeProfitType: TakeProfitType.PERCENTAGE,
      takeProfitValue: firstTp,
      enableTrailingStop: true,
      trailingType: TrailingType.PERCENTAGE,
      trailingValue: config.trailingStopPct,
      trailingActivation: TrailingActivationType.PERCENTAGE,
      trailingActivationValue: config.trailingStopActivationPct,
      useOco: true
    };
  }
}
