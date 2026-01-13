import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { CronJob } from 'cron';

import { OHLCCandle } from '../../ohlc/ohlc-candle.entity';
import { OHLCService, PriceRange } from '../../ohlc/ohlc.service';
import { PortfolioService } from '../../portfolio/portfolio.service';
import { Algorithm } from '../algorithm.entity';

// Time period constants for volatility calculation
enum PeriodMs {
  '30m' = 30 * 60 * 1000,
  '1h' = 60 * 60 * 1000,
  '6h' = 6 * 60 * 60 * 1000,
  '12h' = 12 * 60 * 60 * 1000,
  '1d' = 24 * 60 * 60 * 1000,
  '7d' = 7 * 24 * 60 * 60 * 1000,
  '14d' = 14 * 24 * 60 * 60 * 1000,
  '30d' = 30 * 24 * 60 * 60 * 1000
}

@Injectable()
export class MeanReversionService {
  readonly id = 'f206b716-6be3-499f-8186-2581e9755a98';
  private algorithm: Algorithm;
  private candles: OHLCCandle[];
  private readonly threshold = {
    LOW: 1.5,
    MEDIUM: 2,
    HIGH: 3
  };
  private readonly logger = new Logger(MeanReversionService.name);
  constructor(
    private readonly ohlcService: OHLCService,
    private readonly portfolio: PortfolioService,
    private readonly schedulerRegistry: SchedulerRegistry
  ) {}

  async onInit(algorithm: Algorithm) {
    // if (process.env.NODE_ENV !== 'production') return;
    this.logger.log(`${algorithm.name}: Running Successfully!`);
    this.algorithm = algorithm;
    // this.addCronJob();
  }

  private addCronJob() {
    const job = new CronJob(this.algorithm.cron, this.cronJob.bind(this), null, true, 'America/New_York');

    this.schedulerRegistry.addCronJob(`${this.algorithm.name} Service`, job);
    setTimeout(
      () => {
        job.start();
        this.cronJob();
      },
      process.env.NODE_ENV === 'production' ? 300000 : 0
    );
  }

  private async cronJob() {
    const coins = await this.portfolio.getPortfolioCoins();
    const coinIds = coins.map(({ id }) => id);
    const [candles, todaysCandles] = await Promise.all([
      this.ohlcService.getCandlesByDateRange(coinIds, new Date(Date.now() - PeriodMs['14d']), new Date()),
      this.ohlcService.getCandlesByDateRange(coinIds, new Date(Date.now() - PeriodMs['1d']), new Date())
    ]);
    this.candles = candles;
    for (const coin of coins) {
      const prices = this.candles.filter((c) => c.coinId === coin.id).map((c) => c.close);
      const todayPrices = todaysCandles.filter((c) => c.coinId === coin.id).map((c) => c.close);
      if (prices.length === 0 || todayPrices.length === 0) continue;

      const mean = this.calculateMean(prices);
      const stdDev = this.calculateStandardDeviation(prices, mean);
      const volatility = this.calculateVolatility(todayPrices, PriceRange['1d']);
      const threshold = this.getThreshold(volatility);
      const currentPrice = prices[prices.length - 1];
      const lowerBand = mean - threshold * stdDev;
      const upperBand = mean + threshold * stdDev;

      this.logger.debug(
        `${coin.symbol}: price=${currentPrice.toFixed(2)} mean=${mean.toFixed(2)} ` +
          `bands=[${lowerBand.toFixed(2)}, ${upperBand.toFixed(2)}] volatility=${volatility.toFixed(2)}`
      );
    }
  }

  private calculateMean(prices: number[]) {
    return prices.reduce((sum, price) => sum + price, 0) / prices.length;
  }

  private calculateStandardDeviation(prices: number[], mean: number) {
    const squareDiffs = prices.map((price) => Math.pow(price - mean, 2));
    const avgSquareDiff = this.calculateMean(squareDiffs);
    return Math.sqrt(avgSquareDiff);
  }

  private calculateVolatility(prices: number[], range: PriceRange) {
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / returns.length;

    return (Math.sqrt(variance) * PeriodMs[range]) / 6000;
  }

  private getThreshold(volatility: number) {
    if (volatility < 15) {
      return this.threshold['LOW'];
    } else if (volatility < 50) {
      return this.threshold['MEDIUM'];
    } else {
      return this.threshold['HIGH'];
    }
  }
}
