import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { TestnetSummary as PriceRange } from '../../order/testnet/dto/testnet-summary.dto';
import { PortfolioService } from '../../portfolio/portfolio.service';
import { Price } from '../../price/price.entity';
import { PriceService } from '../../price/price.service';
import { Algorithm } from '../algorithm.entity';
import { AlgorithmService } from '../algorithm.service';
import { CoinGeckoClient } from 'coingecko-api-v3';

@Injectable()
export class MeanReversionService {
  readonly id = 'f206b716-6be3-499f-8186-2581e9755a98';
  private algorithm: Algorithm;
  private prices: Price[];
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(MeanReversionService.name);
  constructor(
    private readonly algorithmService: AlgorithmService,
    private readonly price: PriceService,
    private readonly portfolio: PortfolioService,
    private readonly schedulerRegistry: SchedulerRegistry
  ) {}

  async onInit(algorithm: Algorithm) {
    this.logger.log(`${algorithm.name}: Running Successfully!`);
    this.algorithm = algorithm;
    this.addCronJob();
  }

  private addCronJob() {
    const job = new CronJob(this.algorithm.cron, this.cronJob.bind(this), null, true, 'America/New_York');

    this.schedulerRegistry.addCronJob(`${this.algorithm.name} Service`, job);
    job.start();
    this.cronJob();
  }

  private async cronJob() {
    const coins = await this.portfolio.getPortfolioCoins();
    this.prices = await this.price.findAll(
      coins.map(({ id }) => id),
      PriceRange['30d']
    );
    for (const coin of coins) {
      const prices = this.prices.filter(({ coinId }) => coinId === coin.id).map(({ price }) => price);
      const mean = this.calculateMean(prices);
      const standardDeviation = this.calculateStandardDeviation(prices, mean);
      const threshold = mean + standardDeviation;
      const currentPrice = prices[prices.length - 1];
      if (currentPrice > threshold) {
        console.log('buy');
      } else {
        console.log('sell');
      }
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
}
