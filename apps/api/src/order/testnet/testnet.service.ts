import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CoinGeckoClient } from 'coingecko-api-v3';
import { Repository } from 'typeorm';

import { TestnetDto } from './dto/testnet.dto';
import { Testnet } from './testnet.entity';
import { AlgorithmService } from '../../algorithm/algorithm.service';
import { TickerService } from '../../exchange/ticker/ticker.service';
import User from '../../users/users.entity';
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

    return (
      await this.testnet.insert({
        quantity,
        side,
        price,
        algorithm,
        coin: ticker.coin
      })
    ).generatedMaps[0] as Testnet;
  }

  private async validateOrder(side: OrderSide, order: TestnetDto, user: User) {
    const binance = this.user.getBinance(user);
    return await binance.orderTest({
      symbol: order.symbol,
      side,
      quantity: order.quantity,
      type: OrderType.MARKET as any
    });
  }
}
