import { Injectable, Logger } from '@nestjs/common';

import { OHLCService } from '../../ohlc/ohlc.service';
import { PortfolioService } from '../../portfolio/portfolio.service';
import { toErrorInfo } from '../../shared/error.util';
import { Algorithm } from '../algorithm.entity';
import { AlgorithmContext } from '../interfaces';

/**
 * Service responsible for building algorithm execution context
 * Gathers all necessary data for algorithm execution
 */
@Injectable()
export class AlgorithmContextBuilder {
  private readonly logger = new Logger(AlgorithmContextBuilder.name);

  constructor(
    private readonly portfolioService: PortfolioService,
    private readonly ohlcService: OHLCService
  ) {}

  /**
   * Build execution context for an algorithm
   */
  async buildContext(
    algorithm: Algorithm,
    options: {
      includePriceHistory?: boolean;
      includePositions?: boolean;
      priceHistoryDays?: number;
    } = {}
  ): Promise<AlgorithmContext> {
    const { includePriceHistory = true, includePositions = true, priceHistoryDays = 30 } = options;

    try {
      this.logger.debug(`Building context for algorithm: ${algorithm.name}`);

      // Get portfolio coins
      const coins = await this.portfolioService.getPortfolioCoins();

      // Get price data if requested
      let priceData = {};
      if (includePriceHistory && coins.length > 0) {
        priceData = await this.ohlcService.findAllByDay(coins.map((coin) => coin.id));
      }

      // Get current positions if requested - simplified
      let positions = undefined;
      if (includePositions) {
        const portfolio = await this.portfolioService.getPortfolio();
        positions = portfolio.reduce(
          (acc, item) => {
            if (item.coin?.id) {
              // For now, just track that we have a position in this coin
              acc[item.coin.id] = 1;
            }
            return acc;
          },
          {} as Record<string, number>
        );
      }

      // Parse algorithm configuration
      const config = this.parseAlgorithmConfig(algorithm);

      const context: AlgorithmContext = {
        coins,
        priceData,
        timestamp: new Date(),
        config,
        positions,
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
      includePositions: false,
      priceHistoryDays: 7
    });
  }

  /**
   * Parse algorithm configuration from various sources
   */
  private parseAlgorithmConfig(algorithm: Algorithm): Record<string, unknown> {
    return {
      weight: algorithm.weight || 1.0,
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
