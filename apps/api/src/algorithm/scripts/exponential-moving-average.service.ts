import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ChartData } from 'chart.js';
import { CronJob } from 'cron';
import * as dayjs from 'dayjs';

import { TestnetService } from '../../order/testnet/testnet.service';
import { PortfolioService } from '../../portfolio/portfolio.service';
import { PriceSummary, PriceSummaryByDay } from '../../price/price.entity';
import { PriceService } from '../../price/price.service';
import { Algorithm } from '../algorithm.entity';

@Injectable()
export class ExponentialMovingAverageService {
  readonly id = '3916f8b1-23f5-4d17-a839-6cdecb13588f';
  private lastFetch: Date;
  private algorithm: Algorithm;
  private prices: PriceSummaryByDay;
  private readonly logger = new Logger(ExponentialMovingAverageService.name);
  constructor(
    private readonly portfolio: PortfolioService,
    private readonly price: PriceService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly testnet: TestnetService
  ) {}

  async onInit(algorithm: Algorithm) {
    if (process.env.NODE_ENV !== 'production') return;
    this.logger.log(`${algorithm.name}: Running Successfully!`);
    this.algorithm = algorithm;
    this.addCronJob();
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
    const period = 12;
    const coins = await this.portfolio.getPortfolioCoins();
    // if prices is empty or last fetch is more than 15 minute ago
    if (!this.prices || this.lastFetch.getTime() - new Date().getTime() > 900000) {
      this.prices = await this.price.findAllByDay(coins.map(({ id }) => id));
      this.lastFetch = new Date();
    }
    for (const coin of coins) {
      const { price: latestPrice } = await this.price.latest(coin);
      const ema = this.calculateEMA(this.prices[coin.id], period).pop();
      console.log(ema);
    }
  }

  private SMAStrategy = {
    shortTerm: {
      fma: 8,
      sma: 20
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

  private calculateEMA(prices: PriceSummary[], period: number): number[] {
    if (prices.length < period) {
      throw new Error('The length of the prices array must be at least as long as the period specified.');
    }

    let sma = 0; // Simple Moving Average for the first period data
    for (let i = 0; i < period; i++) {
      sma += prices[i].avg;
    }
    sma /= period;

    const multiplier = 2 / (period + 1);
    let ema = sma;

    const emaValues = [];
    for (let i = 0; i < period - 1; i++) {
      emaValues.push(null); // Filling with nulls up to the period
    }
    emaValues.push(ema); // Push the initial EMA value

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i].avg - ema) * multiplier + ema;
      emaValues.push(ema);
    }

    return emaValues.reverse();
  }

  getChartData(prices: PriceSummary[]): ChartData {
    const ema = [...new Array(12).fill(NaN), ...this.calculateEMA(prices, 12)];
    const labels = prices.map(({ date }) => dayjs(date).format('MM/DD/YYYY')).reverse();
    const data = prices.map(({ avg }) => avg).reverse();
    return {
      labels: labels,
      datasets: [
        {
          label: 'Prices',
          data,
          borderColor: 'rgb(75, 192, 192)'
        },
        {
          label: 'EMA',
          data: ema,
          borderColor: 'rgb(255, 99, 132)'
        }
      ]
    };
  }
}
