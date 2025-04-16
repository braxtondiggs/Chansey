import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository } from 'typeorm';

import { NotFoundCustomException } from '../utils/filters/not-found.exception';
import { CreateExchangeDto, UpdateExchangeDto } from './dto';
import { Exchange } from './exchange.entity';

@Injectable()
export class ExchangeService {
  constructor(@InjectRepository(Exchange) private readonly exchange: Repository<Exchange>) {}

  async getExchanges({ supported = false } = {}): Promise<Exchange[]> {
    const exchanges = await this.exchange.find({ where: { supported } });
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

  async createMany(exchanges: Exchange[]): Promise<Exchange[]> {
    const existingExchanges = await this.exchange.find({
      where: exchanges.map((ex) => ({ slug: ex.slug }))
    });

    const newExchanges = exchanges.filter((ex) => !existingExchanges.find((existing) => existing.slug === ex.slug));

    if (newExchanges.length === 0) return [];

    return await this.exchange.save(newExchanges);
  }

  async removeMany(exchangeIds: string[]): Promise<void> {
    await this.exchange.delete({ id: In(exchangeIds) });
  }

  async updateMany(exchanges: Exchange[]): Promise<Exchange[]> {
    const existingExchanges = await this.exchange.find({
      where: exchanges.map((ex) => ({ slug: ex.slug }))
    });

    if (existingExchanges.length === 0) return [];

    const updatesWithIds = exchanges.map((ex) => {
      const existing = existingExchanges.find((e) => e.slug === ex.slug);
      return { ...ex, id: existing?.id };
    });

    return await this.exchange.save(updatesWithIds);
  }
}
