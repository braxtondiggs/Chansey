import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UpdateTickerDto } from './dto';
import { Ticker } from './ticker.entity';
import { CoinService } from '../../coin/coin.service';
import { NotFoundCustomException } from '../../utils/filters/not-found.exception';
import { ExchangeService } from '../exchange.service';

@Injectable()
export class TickerService {
  constructor(
    @InjectRepository(Ticker) private readonly ticker: Repository<Ticker>,
    private readonly coin: CoinService,
    private readonly exchange: ExchangeService
  ) {}

  async getTickerByCoin(base: string, target?: string, exchange?: string): Promise<Ticker> {
    if (!exchange) {
      const defaultExchange = await this.exchange.getExchangeBySlug('binance_us');
      exchange = defaultExchange.id;
    }

    if (!target) {
      const defaultTarget = await this.coin.getCoinBySymbol('usdt');
      target = defaultTarget.id;
    }
    const ticker = await this.ticker.findOne({
      where: {
        coin: {
          id: base
        },
        target: {
          id: target
        },
        exchange: {
          id: exchange
        }
      }
    });
    if (!ticker) throw new NotFoundCustomException('Ticker', { coinId: base, targetId: target, exchangeId: exchange });
    return ticker;
  }

  async saveTicker(dto: UpdateTickerDto): Promise<Ticker> {
    const ticker = await this.getTickerByCoin(dto.coin.id, dto.target.id, dto.exchange.id);
    return await this.ticker.save(new Ticker({ ...ticker, ...dto }));
  }

  async deleteTicker(tickerId: string) {
    const response = await this.ticker.delete(tickerId);
    if (!response.affected) throw new NotFoundCustomException('Ticker', { id: tickerId });
    return response;
  }
}
