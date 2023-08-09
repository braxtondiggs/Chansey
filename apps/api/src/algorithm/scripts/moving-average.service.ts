import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { PortfolioService } from './../../portfolio/portfolio.service';
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
  }

  private async cronJob() {
    const coins = await this.portfolio.getPortfolioCoins();
    // if prices is empty or last fetch is more than 15 minute ago
    if (!this.prices || this.lastFetch.getTime() - new Date().getTime() > 900000) {
      this.prices = await this.price.findAllByDay(coins.map(({ id }) => id));
      this.lastFetch = new Date();
    }
    for (const coin of coins) {
      const term = this.SMAStrategy.shortTerm; // TODO: Add a strategy selector
      const fastMA = this.calculateMovingAverage(this.prices[coin.id].slice(0, term.fma));
      const slowMA = this.calculateMovingAverage(this.prices[coin.id].slice(term.fma, term.sma));
      if (!Number.isInteger(fastMA) || !Number.isInteger(slowMA)) continue;
      // TODO: Add a threshold
      if (fastMA > slowMA) {
        // TODO: Buy
      } else {
        // TODO: Sell
      }
    }
  }

  private calculateMovingAverage(prices: PriceSummary[]): number {
    return +(prices.reduce((acc, { avg }) => acc + avg, 0) / prices.length).toFixed(2);
  }

  private SMAStrategy = {
    shortTerm: {
      fma: 5,
      sma: 20
    },
    mediumTerm: {
      fma: 50,
      sma: 100
    },
    longTerm: {
      fma: 100,
      sma: 250
    }
  };
}
