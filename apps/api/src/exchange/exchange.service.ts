import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { CreateExchangeDto, UpdateExchangeDto } from './dto';
import { Exchange } from './exchange.entity';
import { NotFoundCustomException } from '../utils/filters/not-found.exception';

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
    const exchange = await this.exchange.findOne({ where: { id: exchangeId } });
    if (!exchange) throw new NotFoundCustomException('Exchange', { id: exchangeId });
    return exchange;
  }

  async getExchangeByName(name: string): Promise<Exchange> {
    const exchange = await this.exchange.findOne({ where: { name: ILike(`%${name}%`) } });
    if (!exchange) throw new NotFoundCustomException('Exchange', { name });
    return exchange;
  }

  async getExchangeBySlug(slug: string): Promise<Exchange> {
    const exchange = await this.exchange.findOne({ where: { slug } });
    if (!exchange) throw new NotFoundCustomException('Exchange', { slug });
    return exchange;
  }

  async createExchange(Exchange: CreateExchangeDto): Promise<Exchange> {
    const exchange = await this.exchange.findOne({ where: { name: ILike(`%${Exchange.name}%`) } });
    return exchange ?? ((await this.exchange.insert(Exchange)).generatedMaps[0] as Exchange);
  }

  async updateExchange(exchangeSlug: string, dto: UpdateExchangeDto): Promise<Exchange> {
    const data = await this.getExchangeBySlug(exchangeSlug);
    if (!data) throw new NotFoundCustomException('Exchange', { slug: exchangeSlug });
    return await this.exchange.save(new Exchange({ ...data, ...dto }));
  }

  async deleteExchange(exchangeId: string) {
    const response = await this.exchange.delete(exchangeId);
    if (!response.affected) throw new NotFoundCustomException('Exchange', { id: exchangeId });
    return response;
  }
}
