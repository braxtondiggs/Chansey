import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cache } from 'cache-manager';
import { CoinGeckoClient } from 'coingecko-api-v3';
import { Between, Repository } from 'typeorm';

import { TestnetDto, TestnetSummaryDuration } from './dto';
import { Testnet, TestnetStatus } from './testnet.entity';
import { AlgorithmService } from '../../algorithm/algorithm.service';
import { TickerPairService } from '../../coin/ticker-pairs/ticker-pairs.service';
import { BinanceService } from '../../exchange/binance/binance.service';
import { NotFoundCustomException } from '../../utils/filters/not-found.exception';
import { OrderSide, OrderType } from '../order.entity';
import { OrderService } from '../order.service';

@Injectable()
export class TestnetService {
  private readonly logger = new Logger(TestnetService.name);
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });

  constructor(
    private readonly algorithm: AlgorithmService,
    private readonly binance: BinanceService,
    private readonly order: OrderService,
    private readonly tickerPair: TickerPairService,
    @InjectRepository(Testnet) private readonly testnet: Repository<Testnet>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache
  ) {}

  async createOrder(side: OrderSide, order: TestnetDto) {
    try {
      const binance = this.binance.getBinanceClient();
      const ticker = await this.tickerPair.getBasePairsById(order.coinId);

      const [{ quantity }, algorithm, response] = await Promise.all([
        this.order.isExchangeValid(order, OrderType.MARKET, ticker.symbol),
        this.algorithm.getAlgorithmById(order.algorithm),
        this.gecko.simplePrice({
          ids: ticker.baseAsset.slug,
          vs_currencies: 'usd'
        })
      ]);
      const price = response[ticker.baseAsset.slug]?.usd;

      const testOrder = await binance.orderTest({
        quantity,
        side,
        symbol: ticker.symbol,
        type: OrderType.MARKET as any
      });

      return (
        await this.testnet.insert({
          algorithm,
          coin: ticker.baseAsset,
          price,
          quantity: Number(quantity),
          side,
          symbol: ticker.symbol,
          orderId: testOrder.orderId?.toString(),
          status: TestnetStatus.FILLED,
          fee: 0, // Testnet orders don't have real fees
          commission: 0,
          updatedAt: new Date()
        })
      ).generatedMaps[0] as Testnet;
    } catch (error) {
      this.logger.error(`Failed to create testnet order: ${error.message}`);
      throw error;
    }
  }

  async updateOrderStatus(orderId: string, status: TestnetStatus) {
    const order = await this.testnet.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundCustomException('Testnet', { id: orderId });

    await this.testnet.update(orderId, {
      status,
      updatedAt: new Date()
    });

    return this.getOrder(orderId);
  }

  async getOrders() {
    const orders = await this.testnet.find();
    return orders.map((order) => {
      Object.keys(order).forEach((key) => order[key] === null && delete order[key]);
      return order;
    });
  }

  async getOrder(orderId: string) {
    const order = await this.testnet.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundCustomException('Testnet', { id: orderId });
    return order;
  }

  async deleteOrders(algoId: string) {
    const response = await this.testnet.delete({ algorithm: { id: algoId } });
    if (!response.affected) throw new NotFoundCustomException('Testnet', { algorithm: algoId });
    return response;
  }

  async getOrderSummary(type = '1d') {
    const cacheKey = `testnet_summary_${type}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    const time = TestnetSummaryDuration[type];
    const orders = await this.testnet.find({
      where: { createdAt: Between(new Date(Date.now() - time), new Date()) },
      order: { createdAt: 'ASC' },
      relations: ['coin'],
      select: ['quantity', 'side', 'price', 'coin']
    });

    const coins = [...new Set(orders.map((order) => order.coin.slug))];
    const prices = await this.getPrices(coins);

    const summary = this.calculateSummary(orders, prices);
    await this.cacheManager.set(cacheKey, summary, 60000); // Cache for 1 minute
    return summary;
  }

  private calculateSummary(orders: Testnet[], prices: Record<string, number>) {
    return orders.reduce((acc, { coin, quantity, side, price, fee, commission }) => {
      const currentPrice = prices[coin.slug] || price;
      const profit =
        side === OrderSide.BUY
          ? (currentPrice - price) * quantity - (fee + commission)
          : (price - currentPrice) * quantity - (fee + commission);

      if (!acc[coin.slug]) {
        acc[coin.slug] = { profitLoss: 0, percentage: 0, trades: 0 };
      }

      acc[coin.slug].profitLoss += profit;
      acc[coin.slug].percentage += (profit / (price * quantity)) * 100;
      acc[coin.slug].trades += 1;

      return acc;
    }, {} as Record<string, { profitLoss: number; percentage: number; trades: number }>);
  }

  private async getPrices(coins: string[]): Promise<Record<string, number>> {
    const response = await this.gecko.simplePrice({
      ids: coins.join(','),
      vs_currencies: 'usd'
    });

    return Object.fromEntries(Object.entries(response).map(([key, { usd }]) => [key, usd]));
  }
}
