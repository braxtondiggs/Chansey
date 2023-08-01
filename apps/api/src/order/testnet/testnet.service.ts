import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CoinGeckoClient } from 'coingecko-api-v3';
import { Between, Repository } from 'typeorm';

import { TestnetDto, TestnetSummaryDuration } from './dto';
import { Testnet } from './testnet.entity';
import { AlgorithmService } from '../../algorithm/algorithm.service';
import { TickerService } from '../../exchange/ticker/ticker.service';
import UsersService from '../../users/users.service';
import { OrderSide, OrderType } from '../order.entity';
import { OrderService } from '../order.service';

@Injectable()
export class TestnetService {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  constructor(
    private readonly algorithm: AlgorithmService,
    private readonly order: OrderService,
    private readonly ticker: TickerService,
    private readonly user: UsersService,
    @InjectRepository(Testnet) private readonly testnet: Repository<Testnet>
  ) {}

  async createOrder(side: OrderSide, order: TestnetDto) {
    const binance = this.user.getDefaultBinance();
    const ticker = await this.ticker.getTickerByCoin(order.symbol, '0e968a4f-88c3-4dbf-8ff6-4420d248a2e0'); // NOTE: USDT
    order.symbol = ticker.symbol;

    const [{ quantity }, algorithm, response] = await Promise.all([
      this.order.isExchangeValid(order, OrderType.MARKET),
      this.algorithm.getAlgorithmById(order.algorithm),
      this.gecko.simplePrice({
        ids: ticker.coin.slug,
        vs_currencies: 'usd'
      })
    ]);
    const price = response[ticker.coin.slug]?.usd;

    await binance.orderTest({
      quantity,
      side,
      symbol: order.symbol,
      type: OrderType.MARKET as any
    });

    return (
      await this.testnet.insert({
        quantity: Number(quantity),
        side,
        price,
        algorithm,
        coin: ticker.coin
      })
    ).generatedMaps[0] as Testnet;
  }

  async getOrders() {
    const orders = await this.testnet.find();
    return orders.map((order) => {
      Object.keys(order).forEach((key) => order[key] === null && delete order[key]);
      return order;
    });
  }

  async getOrder(orderId: string) {
    return await this.testnet.findOne({ where: { id: orderId } });
  }

  async deleteOrders(algoId: string) {
    return await this.testnet.delete({ algorithm: { id: algoId } });
  }

  async getOrderSummary(type = '1d') {
    const time = TestnetSummaryDuration[type];

    const orders = await this.testnet.find({
      where: { createdAt: Between(new Date(Date.now() - time), new Date()) },
      order: { createdAt: 'ASC' },
      relations: ['coin']
    });

    const coins = new Set();

    orders.forEach((order) => {
      const { coin } = order;
      coins.add(coin.slug);
    });

    const response = await this.gecko.simplePrice({
      ids: Array.from(coins).join(','),
      vs_currencies: 'usd'
    });

    const prices = Object.entries(response).map(([key, { usd }]) => ({ [key]: usd }));

    // calculate profit/loss for each coin
    const summary = orders.reduce(
      (acc, order) => {
        const { coin, quantity, side, price } = order;
        const { slug } = coin;

        const coinPrice = prices.find((price) => price[slug])?.[slug];
        const profit = side === OrderSide.BUY ? (coinPrice - price) * quantity : (price - coinPrice) * quantity;

        acc[slug].profitLoss += profit;
        acc[slug].percentage += (profit / (price * quantity)) * 100;

        return acc;
      },
      Object.fromEntries(
        Array.from(coins).map((coin) => [
          coin,
          {
            profitLoss: 0,
            percentage: 0
          }
        ])
      )
    );
    return summary;
  }
}
