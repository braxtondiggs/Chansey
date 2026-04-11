import { Injectable, Logger } from '@nestjs/common';

import { CoinSelectionService } from '../../coin-selection/coin-selection.service';
import { OHLCService, PriceRange } from '../../ohlc/ohlc.service';
import { toErrorInfo } from '../../shared/error.util';
import { Algorithm } from '../algorithm.entity';
import { AlgorithmContext } from '../interfaces';

/** Maps a number of days to the closest PriceRange accepted by OHLCService. */
function daysToRange(days: number): PriceRange {
  if (days <= 1) return PriceRange['1d'];
  if (days <= 7) return PriceRange['7d'];
  if (days <= 14) return PriceRange['14d'];
  if (days <= 30) return PriceRange['30d'];
  if (days <= 90) return PriceRange['90d'];
  if (days <= 180) return PriceRange['180d'];
  if (days <= 365) return PriceRange['1y'];
  if (days <= 1825) return PriceRange['5y'];
  return PriceRange['all'];
}

/**
 * Service responsible for building algorithm execution context
 * Gathers all necessary data for algorithm execution
 */
@Injectable()
export class AlgorithmContextBuilder {
  private readonly logger = new Logger(AlgorithmContextBuilder.name);

  constructor(
    private readonly coinSelectionService: CoinSelectionService,
    private readonly ohlcService: OHLCService
  ) {}

  /**
   * Build execution context for an algorithm
   */
  async buildContext(
    algorithm: Algorithm,
    options: {
      includePriceHistory?: boolean;
      priceHistoryDays?: number;
    } = {}
  ): Promise<AlgorithmContext> {
    const { includePriceHistory = true, priceHistoryDays = 30 } = options;

    try {
      this.logger.debug(`Building context for algorithm: ${algorithm.name}`);

      // Get portfolio coins
      const coins = await this.coinSelectionService.getCoinSelectionCoins();

      // Get price data if requested
      let priceData = {};
      if (includePriceHistory && coins.length > 0) {
        const range = daysToRange(priceHistoryDays);
        priceData = await this.ohlcService.findAllByDay(
          coins.map((coin) => coin.id),
          range
        );
      }

      // Parse algorithm configuration
      const config = this.parseAlgorithmConfig(algorithm);

      const context: AlgorithmContext = {
        coins,
        priceData,
        timestamp: new Date(),
        config,
        metadata: {
          algorithmId: algorithm.id,
          algorithmName: algorithm.name,
          priceHistoryDays,
          contextBuiltAt: new Date().toISOString()
        }
      };

      this.logger.debug(`Context built successfully for algorithm: ${algorithm.name}`);
      return context;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to build context for algorithm ${algorithm.name}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Build minimal context for testing or lightweight operations
   */
  async buildMinimalContext(algorithm: Algorithm): Promise<AlgorithmContext> {
    return this.buildContext(algorithm, {
      includePriceHistory: true,
      priceHistoryDays: 7
    });
  }

  /**
   * Parse algorithm configuration from various sources
   */
  private parseAlgorithmConfig(algorithm: Algorithm): Record<string, unknown> {
    return {
      weight: algorithm.weight || 5,
      enabled: algorithm.status,
      evaluate: algorithm.evaluate,
      cron: algorithm.cron
    };
  }

  /**
   * Validate context has minimum required data
   */
  validateContext(context: AlgorithmContext): boolean {
    if (!context.coins || context.coins.length === 0) {
      this.logger.warn('Context validation failed: No coins available');
      return false;
    }

    if (!context.priceData || Object.keys(context.priceData).length === 0) {
      this.logger.warn('Context validation failed: No price data available');
      return false;
    }

    return true;
  }
}
