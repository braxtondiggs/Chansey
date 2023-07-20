import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateTickerDto, UpdateTickerDto } from './dto';
import { Ticker } from './ticker.entity';

@Injectable()
export class TickerService {
  constructor(@InjectRepository(Ticker) private readonly ticker: Repository<Ticker>) {}

  async getTickerById(tickerId: string): Promise<Ticker> {
    return await this.ticker.findOne({ where: { id: tickerId } });
  }

  async createTicker(Ticker: CreateTickerDto): Promise<Ticker> {
    const ticker = await this.ticker.findOne({
      where: {
        exchange: {
          id: Ticker.exchange.id
        },
        coin: {
          id: Ticker.coin.id
        },
        target: {
          id: Ticker.target.id
        }
      }
    });
    return ticker ?? ((await this.ticker.insert(Ticker)).generatedMaps[0] as Ticker);
  }

  async updateTicker(tickerId: string, dto: UpdateTickerDto): Promise<Ticker> {
    const data = this.getTickerById(tickerId);
    return await this.ticker.save(new Ticker({ ...data, ...dto }));
  }

  async deleteTicker(tickerId: string) {
    return await this.ticker.delete(tickerId);
  }
}
