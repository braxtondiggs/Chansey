import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { CreateExchangeDto, UpdateExchangeDto } from './dto';
import { Exchange } from './exchange.entity';

@Injectable()
export class ExchangeService {
  constructor(@InjectRepository(Exchange) private readonly exchange: Repository<Exchange>) {}

  async getExchanges(): Promise<Exchange[]> {
    const exchanges = await this.exchange.find();
    return exchanges.map((exchange) => {
      Object.keys(exchange).forEach((key) => exchange[key] === null && delete exchange[key]);
      return exchange;
    });
  }

  async getExchangeById(exchangeId: string): Promise<Exchange> {
    return await this.exchange.findOne({ where: { id: exchangeId } });
  }

  async createExchange(Exchange: CreateExchangeDto): Promise<Exchange> {
    const coin = await this.exchange.findOne({ where: { name: ILike(`%${Exchange.name}%`) } });
    return coin ?? ((await this.exchange.insert(Exchange)).generatedMaps[0] as Exchange);
  }

  async updateExchange(exchangeId: string, dto: UpdateExchangeDto): Promise<Exchange> {
    const data = this.getExchangeById(exchangeId);
    return await this.exchange.save(new Exchange({ ...data, ...dto }));
  }

  async deleteExchange(exchangeId: string) {
    return await this.exchange.delete(exchangeId);
  }
}
