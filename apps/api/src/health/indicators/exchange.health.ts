import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { toErrorInfo } from '../../shared/error.util';

type ExchangeStatus = 'healthy' | 'slow' | 'unhealthy';

interface ExchangeHealthResult {
  latencyMs: number;
  status: ExchangeStatus;
  error?: string;
}

/**
 * Health indicator that monitors exchange connectivity and latency.
 * Uses ExchangeManagerService.getPublicClient() to check each exchange.
 * Fails if all exchanges are unhealthy; warns if latency > 2000ms.
 */
@Injectable()
export class ExchangeHealthIndicator {
  private readonly logger = new Logger(ExchangeHealthIndicator.name);
  private readonly LATENCY_WARN_THRESHOLD_MS = 2000;
  private readonly TIMEOUT_MS = 10000;

  // Exchanges to monitor with their trading pairs
  private readonly exchanges = [
    { slug: 'binance_us', pair: 'BTC/USD' },
    { slug: 'coinbase', pair: 'BTC/USD' },
    { slug: 'kraken', pair: 'BTC/USD' }
  ];

  constructor(
    private readonly exchangeManager: ExchangeManagerService,
    private readonly healthIndicatorService: HealthIndicatorService
  ) {}

  /**
   * Check exchange connectivity and latency
   * Fails if all exchanges are unhealthy
   * Runs all exchange checks in parallel to avoid sequential timeout accumulation
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    // Run all exchange checks in parallel to avoid 30+ second timeouts
    const checkPromises = this.exchanges.map(async ({ slug, pair }) => {
      try {
        return { slug, result: await this.checkExchange(slug, pair) };
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.warn(`Exchange ${slug} health check failed: ${err.message}`);
        return {
          slug,
          result: { latencyMs: -1, status: 'unhealthy' as ExchangeStatus, error: err.message }
        };
      }
    });

    const settledResults = await Promise.all(checkPromises);

    const results: Record<string, ExchangeHealthResult> = {};
    let healthyCount = 0;
    for (const { slug, result } of settledResults) {
      results[slug] = result;
      if (result.status !== 'unhealthy') {
        healthyCount++;
      }
    }

    // Fail only if ALL exchanges are unhealthy
    if (healthyCount === 0) {
      return indicator.down({ ...results, message: 'All monitored exchanges are unavailable' });
    }

    return indicator.up(results);
  }

  private async checkExchange(slug: string, pair: string): Promise<ExchangeHealthResult> {
    const startTime = Date.now();
    let timeoutId: NodeJS.Timeout | undefined;

    try {
      const client = await this.exchangeManager.getPublicClient(slug);

      // Set a timeout for the fetch operation
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Exchange request timeout')), this.TIMEOUT_MS);
      });

      // Race between the actual fetch and the timeout
      await Promise.race([client.fetchTicker(pair), timeoutPromise]);

      // Clear timeout on success to prevent memory leak
      if (timeoutId) clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;

      let status: ExchangeStatus;
      if (latencyMs <= this.LATENCY_WARN_THRESHOLD_MS) {
        status = 'healthy';
      } else {
        status = 'slow';
      }

      return { latencyMs, status };
    } catch (error: unknown) {
      // Clear timeout on error to prevent memory leak
      if (timeoutId) clearTimeout(timeoutId);

      const err = toErrorInfo(error);
      const latencyMs = Date.now() - startTime;
      return {
        latencyMs,
        status: 'unhealthy',
        error: err.message
      };
    }
  }
}
