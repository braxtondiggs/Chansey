import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { TestnetService } from './../../order/testnet/testnet.service';
import { OrderSide } from '../../order/order.entity';
import {
  TestnetSummary as PriceRange,
  TestnetSummaryDuration as PriceSummary
} from '../../order/testnet/dto/testnet-summary.dto';
import { PortfolioService } from '../../portfolio/portfolio.service';
import { Price } from '../../price/price.entity';
import { PriceService } from '../../price/price.service';
import { Algorithm } from '../algorithm.entity';

@Injectable()
export class MeanReversionService {
  readonly id = 'f206b716-6be3-499f-8186-2581e9755a98';
  private algorithm: Algorithm;
  private prices: Price[];
  private readonly threshold = {
    LOW: 1.5,
    MEDIUM: 2,
    HIGH: 3
  };
  private readonly logger = new Logger(MeanReversionService.name);
  constructor(
    private readonly price: PriceService,
    private readonly portfolio: PortfolioService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly testnet: TestnetService
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
    const [prices, todaysCoinPrices] = await Promise.all([
      this.price.findAll(
        coins.map(({ id }) => id),
        PriceRange['14d']
      ),
      this.price.findAll(
        coins.map(({ id }) => id),
        PriceRange['1d']
      )
    ]);
    this.prices = prices;
    for (const coin of coins) {
      const prices = this.prices.filter(({ coinId }) => coinId === coin.id).map(({ price }) => price);
      const todayPrices = todaysCoinPrices.filter(({ coinId }) => coinId === coin.id).map(({ price }) => price);
      const mean = this.calculateMean(prices);
      const standardDeviation = this.calculateStandardDeviation(prices, mean);
      const volatility = this.calculateVolatility(todayPrices, PriceRange['1d']);
      const threshold = this.getThreshold(volatility);
      const currentPrice = prices[prices.length - 1];
      try {
        if (currentPrice < mean - threshold * standardDeviation) {
          await this.testnet.createOrder(OrderSide.BUY, { coinId: coin.id, quantity: '1', algorithm: this.id });
        } else if (currentPrice > mean + threshold * standardDeviation) {
          // TODO: Calculate if can sell
          await this.testnet.createOrder(OrderSide.SELL, { coinId: coin.id, quantity: '1', algorithm: this.id });
        }
      } catch (e) {
        console.log(e);
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

  private calculateVolatility(prices: number[], range: PriceRange) {
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / returns.length;

    return (Math.sqrt(variance) * PriceSummary[range]) / 6000;
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
