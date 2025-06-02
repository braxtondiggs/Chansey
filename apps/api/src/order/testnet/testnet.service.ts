import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { CoinGeckoClient } from 'coingecko-api-v3';
import { Between, Repository } from 'typeorm';

import { TestnetDto, TestnetSummaryDuration } from './dto';
import { Testnet, TestnetStatus } from './testnet.entity';

import { AlgorithmService } from '../../algorithm/algorithm.service';
import { CoinService } from '../../coin/coin.service';
import { TickerPairService } from '../../coin/ticker-pairs/ticker-pairs.service';
import { BinanceUSService } from '../../exchange/binance/binance-us.service';
import { NotFoundCustomException } from '../../utils/filters/not-found.exception';
import { OrderSide, OrderType } from '../order.entity';
import { OrderService } from '../order.service';

@Injectable()
export class TestnetService {
  private readonly logger = new Logger(TestnetService.name);
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });

  constructor(
    private readonly algorithm: AlgorithmService,
    private readonly binance: BinanceUSService,
    private readonly coin: CoinService,
    private readonly order: OrderService,
    private readonly tickerPair: TickerPairService,
    @InjectRepository(Testnet) private readonly testnet: Repository<Testnet>
  ) {}

  async createOrder(side: OrderSide, order: TestnetDto) {
    try {
      // Get the base and quote coins
      const [baseCoin, quoteCoin] = await Promise.all([
        this.coin.getCoinById(order.baseCoinId),
        order.quoteCoinId ? this.coin.getCoinById(order.quoteCoinId) : this.coin.getCoinBySymbol('USDT')
      ]);

      if (!baseCoin) {
        throw new Error(`Base coin with ID ${order.baseCoinId} not found`);
      }

      if (!quoteCoin) {
        throw new Error(`Quote coin not found or USDT not available`);
      }

      // Find the ticker pair for this trading pair
      const tickerPair = await this.tickerPair.getTickerPairBySymbol(baseCoin.symbol, quoteCoin.symbol);

      if (!tickerPair) {
        throw new Error(`No ticker pair found for ${baseCoin.symbol}/${quoteCoin.symbol}`);
      }

      const [algorithm, response] = await Promise.all([
        // this.order.isExchangeValid(order, OrderType.MARKET, tickerPair.symbol),
        this.algorithm.getAlgorithmById(order.algorithm),
        this.gecko.simplePrice({
          ids: baseCoin.slug,
          vs_currencies: 'usd'
        })
      ]);
      const price = response[baseCoin.slug]?.usd;

      /*const binance = await this.binance.getBinanceClient();
      const testOrder = await binance.orderTest({
        quantity,
        side,
        symbol: tickerPair.symbol,
        type: OrderType.MARKET as any
      });

      return (
        await this.testnet.insert({
          algorithm,
          baseCoin,
          quoteCoin,
          price,
          quantity: Number(quantity),
          side,
          symbol: tickerPair.symbol,
          orderId: testOrder.orderId?.toString(),
          status: TestnetStatus.FILLED,
          fee: 0, // Testnet orders don't have real fees
          commission: 0,
          updatedAt: new Date()
        })
      ).generatedMaps[0] as Testnet;*/
      return; // TODO: Remove this line when the test order is implemented
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
    const time = TestnetSummaryDuration[type];
    const orders = await this.testnet.find({
      where: { createdAt: Between(new Date(Date.now() - time), new Date()) },
      order: { createdAt: 'ASC' },
      relations: ['baseCoin', 'quoteCoin'],
      select: ['quantity', 'side', 'price', 'baseCoin', 'quoteCoin']
    });

    const coins = [...new Set(orders.map((order) => order.baseCoin.slug))];
    const prices = await this.getPrices(coins);

    const summary = this.calculateSummary(orders, prices);
    return summary;
  }

  private calculateSummary(orders: Testnet[], prices: Record<string, number>) {
    return orders.reduce(
      (acc, { baseCoin, quantity, side, price, fee, commission }) => {
        const currentPrice = prices[baseCoin.slug] || price;
        const profit =
          side === OrderSide.BUY
            ? (currentPrice - price) * quantity - (fee + commission)
            : (price - currentPrice) * quantity - (fee + commission);

        if (!acc[baseCoin.slug]) {
          acc[baseCoin.slug] = { profitLoss: 0, percentage: 0, trades: 0 };
        }

        acc[baseCoin.slug].profitLoss += profit;
        acc[baseCoin.slug].percentage += (profit / (price * quantity)) * 100;
        acc[baseCoin.slug].trades += 1;

        return acc;
      },
      {} as Record<string, { profitLoss: number; percentage: number; trades: number }>
    );
  }

  private async getPrices(coins: string[]): Promise<Record<string, number>> {
    const response = await this.gecko.simplePrice({
      ids: coins.join(','),
      vs_currencies: 'usd'
    });

    return Object.fromEntries(Object.entries(response).map(([key, { usd }]) => [key, usd]));
  }
}
