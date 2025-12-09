import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { CapitalAllocationService } from './capital-allocation.service';
import { PositionTrackingService } from './position-tracking.service';
import { RiskPoolMappingService } from './risk-pool-mapping.service';
import { StrategyExecutorService, TradingSignal } from './strategy-executor.service';

import { BalanceService } from '../balance/balance.service';
import { OrderService } from '../order/order.service';
import { User } from '../users/users.entity';

/**
 * Orchestrates live trading for all enrolled robo-advisor users.
 * Runs strategies every 2 minutes and places orders on user exchanges.
 */
@Injectable()
export class LiveTradingService {
  private readonly logger = new Logger(LiveTradingService.name);
  private isRunning = false;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly riskPoolMapping: RiskPoolMappingService,
    private readonly capitalAllocation: CapitalAllocationService,
    private readonly positionTracking: PositionTrackingService,
    private readonly strategyExecutor: StrategyExecutorService,
    private readonly orderService: OrderService,
    private readonly balanceService: BalanceService
  ) {}

  @Cron('*/2 * * * *')
  async executeLiveTrading(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Live trading already running, skipping this cycle');
      return;
    }

    this.isRunning = true;

    try {
      const enrolledUsers = await this.userRepo.find({
        where: { algoTradingEnabled: true },
        relations: ['risk']
      });

      if (enrolledUsers.length === 0) {
        this.logger.debug('No users enrolled in algo trading');
        this.isRunning = false;
        return;
      }

      this.logger.log(`Executing strategies for ${enrolledUsers.length} enrolled users`);

      for (const user of enrolledUsers) {
        try {
          await this.executeUserStrategies(user);
        } catch (error) {
          this.logger.error(`Failed to execute strategies for user ${user.id}: ${error.message}`);
          await this.handleUserError(user, error);
        }
      }
    } catch (error) {
      this.logger.error(`Live trading cycle failed: ${error.message}`, error.stack);
    } finally {
      this.isRunning = false;
    }
  }

  private async executeUserStrategies(user: User): Promise<void> {
    if (!user.algoCapitalAllocationPercentage || user.algoCapitalAllocationPercentage <= 0) {
      this.logger.warn(`User ${user.id} has no capital allocation percentage set`);
      return;
    }

    if (!user.exchanges || user.exchanges.length === 0) {
      this.logger.warn(`User ${user.id} has no exchange keys configured`);
      return;
    }

    // Fetch user's free balance from exchange
    const balances = await this.balanceService.getUserBalances(user, false);
    const totalFreeUsdValue = this.calculateFreeUsdValue(balances.current);

    if (totalFreeUsdValue <= 0) {
      this.logger.warn(`User ${user.id} has no free balance available`);
      return;
    }

    // Calculate actual capital from percentage
    const actualCapital = (totalFreeUsdValue * Number(user.algoCapitalAllocationPercentage)) / 100;

    this.logger.debug(
      `User ${user.id}: Free balance $${totalFreeUsdValue.toFixed(2)}, ` +
        `${user.algoCapitalAllocationPercentage}% = $${actualCapital.toFixed(2)} for algo trading`
    );

    const strategies = await this.riskPoolMapping.getActiveStrategiesForUser(user);

    if (strategies.length === 0) {
      this.logger.debug(`No active strategies for user ${user.id} (risk level ${user.risk?.level})`);
      return;
    }

    const capitalMap = await this.capitalAllocation.allocateCapitalByPerformance(actualCapital, strategies);

    const userPositions = await this.positionTracking.getPositions(user.id);

    const marketData = await this.fetchMarketData();

    for (const strategy of strategies) {
      try {
        const allocatedCapital = capitalMap.get(strategy.id) || 0;
        const strategyPositions = userPositions.filter((p) => p.strategyConfigId === strategy.id);

        const signal = await this.strategyExecutor.executeStrategy(
          strategy,
          marketData,
          strategyPositions,
          allocatedCapital
        );

        if (signal && signal.action !== 'hold') {
          const validation = this.strategyExecutor.validateSignal(signal, allocatedCapital);
          if (!validation.valid) {
            this.logger.warn(`Invalid signal for user ${user.id}, strategy ${strategy.id}: ${validation.reason}`);
            continue;
          }

          await this.placeOrder(user, strategy.id, signal);
        }
      } catch (error) {
        this.logger.error(`Strategy ${strategy.id} execution failed for user ${user.id}: ${error.message}`);
      }
    }
  }

  private async placeOrder(user: User, strategyConfigId: string, signal: TradingSignal): Promise<void> {
    try {
      const exchangeKey = user.exchanges[0];
      if (!exchangeKey) {
        this.logger.error(`No exchange key found for user ${user.id}`);
        return;
      }

      // Type guard: signal.action is guaranteed to be 'buy' | 'sell' by caller check
      const orderSignal = {
        action: signal.action as 'buy' | 'sell',
        symbol: signal.symbol,
        quantity: signal.quantity,
        price: signal.price
      };

      const order = await this.orderService.placeAlgorithmicOrder(
        user.id,
        strategyConfigId,
        orderSignal,
        exchangeKey.id
      );

      this.logger.log(
        `Order placed for user ${user.id}: ${signal.action} ${signal.quantity} ${signal.symbol} (Order ID: ${order.id})`
      );

      await this.positionTracking.updatePosition(
        user.id,
        strategyConfigId,
        signal.symbol,
        signal.quantity,
        signal.price,
        signal.action === 'buy' ? 'buy' : 'sell'
      );
    } catch (error) {
      this.logger.error(`Failed to place order for user ${user.id}: ${error.message}`);
      throw error;
    }
  }

  private async fetchMarketData(): Promise<any[]> {
    return [];
  }

  private async handleUserError(user: User, error: Error): Promise<void> {
    this.logger.error(`Pausing algo trading for user ${user.id} due to error: ${error.message}`);

    try {
      user.algoTradingEnabled = false;
      await this.userRepo.save(user);
    } catch (saveError) {
      this.logger.error(`Failed to pause algo trading for user ${user.id}: ${saveError.message}`);
    }
  }

  /**
   * Calculate total free (available) USD value across all exchanges.
   * Free balance = balance.free (not locked in orders).
   */
  private calculateFreeUsdValue(exchanges: any[]): number {
    let totalFree = 0;

    for (const exchange of exchanges) {
      for (const balance of exchange.balances || []) {
        const freeAmount = parseFloat(balance.free || '0');
        const usdValue = balance.usdValue || 0;

        // Calculate free portion of USD value
        const totalAmount = parseFloat(balance.free || '0') + parseFloat(balance.locked || '0');
        if (totalAmount > 0) {
          const freePercentage = freeAmount / totalAmount;
          totalFree += usdValue * freePercentage;
        }
      }
    }

    return totalFree;
  }

  async getStatus(): Promise<{ running: boolean; enrolledUsers: number }> {
    const enrolledCount = await this.userRepo.count({
      where: { algoTradingEnabled: true }
    });

    return {
      running: this.isRunning,
      enrolledUsers: enrolledCount
    };
  }
}
