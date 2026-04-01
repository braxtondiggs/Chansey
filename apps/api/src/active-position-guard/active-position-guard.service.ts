import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { SignalStatus } from '@chansey/api-interfaces';

import { Coin } from '../coin/coin.entity';
import { PositionExit } from '../order/entities/position-exit.entity';
import { PositionExitStatus } from '../order/interfaces/exit-config.interface';
import { Order, OrderStatus } from '../order/order.entity';
import { PaperTradingOrder, PaperTradingOrderStatus } from '../order/paper-trading/entities/paper-trading-order.entity';
import { PaperTradingStatus } from '../order/paper-trading/entities/paper-trading-session.entity';
import { LiveTradingSignal } from '../strategy/entities/live-trading-signal.entity';
import { UserStrategyPosition } from '../strategy/entities/user-strategy-position.entity';

@Injectable()
export class ActivePositionGuardService {
  private readonly logger = new Logger(ActivePositionGuardService.name);

  constructor(
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(PaperTradingOrder) private readonly paperOrderRepo: Repository<PaperTradingOrder>,
    @InjectRepository(PositionExit) private readonly positionExitRepo: Repository<PositionExit>,
    @InjectRepository(UserStrategyPosition) private readonly userStrategyPositionRepo: Repository<UserStrategyPosition>,
    @InjectRepository(LiveTradingSignal) private readonly liveTradingSignalRepo: Repository<LiveTradingSignal>,
    @InjectRepository(Coin) private readonly coinRepo: Repository<Coin>
  ) {}

  async getActivePositionCoinIds(userId: string): Promise<Set<string>> {
    const [orderCoinIds, paperCoinIds, exitCoinIds, positionCoinIds, signalCoinIds] = await Promise.all([
      this.getOpenOrderCoinIds(userId),
      this.getActivePaperTradingCoinIds(userId),
      this.getActivePositionExitCoinIds(userId),
      this.getActiveStrategyPositionCoinIds(userId),
      this.getPendingSignalCoinIds(userId)
    ]);

    const all = new Set<string>([
      ...orderCoinIds,
      ...paperCoinIds,
      ...exitCoinIds,
      ...positionCoinIds,
      ...signalCoinIds
    ]);

    if (all.size > 0) {
      this.logger.debug(`User ${userId} has ${all.size} guarded coin(s) from active positions`);
    }

    return all;
  }

  private async getOpenOrderCoinIds(userId: string): Promise<string[]> {
    const orders = await this.orderRepo.find({
      where: {
        user: { id: userId },
        status: In([OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED])
      },
      relations: ['baseCoin'],
      select: { id: true, baseCoin: { id: true } }
    });

    return orders.map((o) => o.baseCoin?.id).filter((id): id is string => !!id);
  }

  private async getActivePaperTradingCoinIds(userId: string): Promise<string[]> {
    const orders = await this.paperOrderRepo
      .createQueryBuilder('pto')
      .select('DISTINCT pto.baseCurrency', 'baseCurrency')
      .innerJoin('pto.session', 'pts')
      .where('pts.userId = :userId', { userId })
      .andWhere('pts.status = :sessionStatus', { sessionStatus: PaperTradingStatus.ACTIVE })
      .andWhere('pto.status IN (:...statuses)', {
        statuses: [PaperTradingOrderStatus.PENDING, PaperTradingOrderStatus.PARTIAL]
      })
      .getRawMany<{ baseCurrency: string }>();

    const symbols = orders.map((o) => o.baseCurrency);
    return this.resolveSymbolsToCoinIds(symbols);
  }

  private async getActivePositionExitCoinIds(userId: string): Promise<string[]> {
    const exits = await this.positionExitRepo.find({
      where: { user: { id: userId }, status: PositionExitStatus.ACTIVE },
      select: { id: true, symbol: true }
    });

    const symbols = exits.map((e) => this.extractBaseSymbol(e.symbol));
    return this.resolveSymbolsToCoinIds(symbols);
  }

  private async getActiveStrategyPositionCoinIds(userId: string): Promise<string[]> {
    const positions = await this.userStrategyPositionRepo
      .createQueryBuilder('usp')
      .select('DISTINCT usp.symbol', 'symbol')
      .where('usp.userId = :userId', { userId })
      .andWhere('usp.quantity > 0')
      .getRawMany<{ symbol: string }>();

    const symbols = positions.map((p) => this.extractBaseSymbol(p.symbol));
    return this.resolveSymbolsToCoinIds(symbols);
  }

  private async getPendingSignalCoinIds(userId: string): Promise<string[]> {
    const signals = await this.liveTradingSignalRepo.find({
      where: {
        user: { id: userId },
        status: In([SignalStatus.PENDING, SignalStatus.PLACED])
      },
      select: { id: true, symbol: true }
    });

    const symbols = signals.map((s) => this.extractBaseSymbol(s.symbol));
    return this.resolveSymbolsToCoinIds(symbols);
  }

  private extractBaseSymbol(tradingPair: string): string {
    if (tradingPair.includes('/')) {
      return tradingPair.split('/')[0];
    }
    return tradingPair;
  }

  private async resolveSymbolsToCoinIds(symbols: string[]): Promise<string[]> {
    const unique = [...new Set(symbols.filter(Boolean))];
    if (unique.length === 0) return [];

    const upperSymbols = unique.map((s) => s.toUpperCase());
    const coins = await this.coinRepo
      .createQueryBuilder('coin')
      .select(['coin.id', 'coin.symbol'])
      .where('coin.symbol IN (:...symbols)', {
        symbols: upperSymbols
      })
      .getMany();

    const symbolMap = new Map(coins.map((c) => [c.symbol.toUpperCase(), c.id]));
    const resolved: string[] = [];

    for (const sym of unique) {
      const coinId = symbolMap.get(sym.toUpperCase());
      if (coinId) {
        resolved.push(coinId);
      } else {
        this.logger.warn(`Could not resolve symbol "${sym}" to a coin ID — skipping`);
      }
    }

    return resolved;
  }
}
