import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UpdateTickerDto } from './dto';
import { Ticker } from './ticker.entity';

@Injectable()
export class TickerService {
  constructor(@InjectRepository(Ticker) private readonly ticker: Repository<Ticker>) {}

  async getTickerByCoin(base: string, target: string, exchange: string): Promise<Ticker> {
    return await this.ticker.findOne({
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
  }

  async saveTicker(dto: UpdateTickerDto): Promise<Ticker> {
    const ticker = await this.getTickerByCoin(dto.coin.id, dto.target.id, dto.exchange.id);
    return await this.ticker.save(new Ticker({ ...ticker, ...dto }));
  }

  async deleteTicker(tickerId: string) {
    return await this.ticker.delete(tickerId);
  }
}
