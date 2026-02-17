import { Injectable, Logger } from '@nestjs/common';

import { StrategyConfig } from './entities/strategy-config.entity';
import { UserStrategyPosition } from './entities/user-strategy-position.entity';

import { AlgorithmRegistry } from '../algorithm/registry/algorithm-registry.service';
import { toErrorInfo } from '../shared/error.util';

export interface TradingSignal {
  action: 'buy' | 'sell' | 'hold';
  symbol: string;
  quantity: number;
  price: number;
  reason?: string;
}

export interface MarketData {
  symbol: string;
  price: number;
  timestamp: Date;
  volume?: number;
}

/**
 * Executes trading strategies and generates buy/sell signals.
 * Wraps AlgorithmRegistry to run strategy logic with market data and positions.
 */
@Injectable()
export class StrategyExecutorService {
  private readonly logger = new Logger(StrategyExecutorService.name);

  constructor(private readonly algorithmRegistry: AlgorithmRegistry) {}

  async executeStrategy(
    strategy: StrategyConfig,
    marketData: MarketData[],
    positions: UserStrategyPosition[],
    availableCapital: number
  ): Promise<TradingSignal | null> {
    try {
      const algorithm = await this.algorithmRegistry.getStrategyForAlgorithm(strategy.algorithm.id);
      if (!algorithm) {
        this.logger.warn(`Algorithm ${strategy.algorithm.id} not found for strategy ${strategy.id}`);
        return null;
      }

      // TODO: This needs to be updated to use algorithm.execute() with proper AlgorithmContext
      // For now, return null as this integration is incomplete
      this.logger.warn(`Strategy executor needs refactoring to use algorithm.execute() instead of generateSignal()`);

      return null;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error executing strategy ${strategy.id}: ${err.message}`);
      return null;
    }
  }

  async executeMultipleStrategies(
    strategies: StrategyConfig[],
    marketData: MarketData[],
    positions: UserStrategyPosition[],
    capitalPerStrategy: Map<string, number>
  ): Promise<Map<string, TradingSignal | null>> {
    const signals = new Map<string, TradingSignal | null>();

    for (const strategy of strategies) {
      const capital = capitalPerStrategy.get(strategy.id) || 0;
      const strategyPositions = positions.filter((p) => p.strategyConfigId === strategy.id);

      const signal = await this.executeStrategy(strategy, marketData, strategyPositions, capital);
      signals.set(strategy.id, signal);
    }

    return signals;
  }

  validateSignal(signal: TradingSignal, availableCapital: number): { valid: boolean; reason?: string } {
    if (!signal) {
      return { valid: false, reason: 'No signal provided' };
    }

    if (signal.action === 'hold') {
      return { valid: true };
    }

    if (signal.quantity <= 0) {
      return { valid: false, reason: 'Quantity must be greater than 0' };
    }

    if (signal.price <= 0) {
      return { valid: false, reason: 'Price must be greater than 0' };
    }

    if (signal.action === 'buy') {
      const requiredCapital = signal.quantity * signal.price;
      if (requiredCapital > availableCapital) {
        return {
          valid: false,
          reason: `Insufficient capital: need ${requiredCapital.toFixed(2)}, have ${availableCapital.toFixed(2)}`
        };
      }
    }

    return { valid: true };
  }
}
