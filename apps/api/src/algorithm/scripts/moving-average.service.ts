import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { PortfolioService } from './../../portfolio/portfolio.service';
import { OrderSide } from '../../order/order.entity';
import { TestnetService } from '../../order/testnet/testnet.service';
import { PriceSummary, PriceSummaryByDay } from '../../price/price.entity';
import { PriceService } from '../../price/price.service';
import { Algorithm } from '../algorithm.entity';

@Injectable()
export class MovingAverageService {
  readonly id = '100c1721-7b0b-4d96-a18e-40904c0cc36b';
  private lastFetch: Date;
  private algorithm: Algorithm;
  private prices: PriceSummaryByDay;
  private readonly logger = new Logger(MovingAverageService.name);
  constructor(
    private readonly portfolio: PortfolioService,
    private readonly price: PriceService,
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
  }

  private async cronJob() {
    const coins = await this.portfolio.getPortfolioCoins();
    // if prices is empty or last fetch is more than 15 minute ago
    if (!this.prices || this.lastFetch.getTime() - new Date().getTime() > 900000) {
      this.prices = await this.price.findAllByDay(coins.map(({ id }) => id));
      this.lastFetch = new Date();
    }
    for (const coin of coins) {
      const { price: latestPrice } = await this.price.latest(coin);
      for (const term of Object.values(this.SMAStrategy)) {
        if (this.prices[coin.id].length < term.sma) continue;
        const fastMA = this.calculateMovingAverage(this.prices[coin.id].slice(0, term.fma));
        const slowMA = this.calculateMovingAverage(this.prices[coin.id].slice(0, term.sma));
        if (typeof fastMA !== 'number' || typeof slowMA !== 'number') continue;

        const threshold = (fastMA / slowMA) * 100;
        if (Math.abs(fastMA - slowMA) >= threshold) continue;
        if (latestPrice < fastMA) {
          // TODO: fast & slow average minus actual coin price. You can figure out the quality or quantity of the trade. Bigger difference means bigger trade.
          // TODO: once more data is considered maybe should only trade best SMAStrategy vs all
          await this.testnet.createOrder(OrderSide.BUY, { coinId: coin.id, quantity: '1', algorithm: this.id });
        } else if (latestPrice > fastMA) {
          await this.testnet.createOrder(OrderSide.SELL, { coinId: coin.id, quantity: '1', algorithm: this.id });
        }
      }
    }
  }

  private calculateMovingAverage(prices: PriceSummary[]): number {
    return +(prices.reduce((acc, { avg }) => acc + avg, 0) / prices.length).toFixed(2);
  }

  private SMAStrategy = {
    shortTerm: {
      fma: 5,
      sma: 40 // NOTE: SMA might be too low due to lack of data
    },
    mediumTerm: {
      fma: 10,
      sma: 100
    },
    longTerm: {
      fma: 25,
      sma: 200
    }
  };
}
