import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { CreateExchangeDto, UpdateExchangeDto } from './dto';
import { ExchangeKeyService } from './exchange-key/exchange-key.service';
import { Exchange } from './exchange.entity';

import { NotFoundCustomException } from '../utils/filters/not-found.exception';

@Injectable()
export class ExchangeService {
  constructor(
    @InjectRepository(Exchange) private readonly exchange: Repository<Exchange>,
    @Inject(forwardRef(() => ExchangeKeyService))
    private readonly exchangeKeyService: ExchangeKeyService
  ) {}

  async findOne(id: string): Promise<Exchange> {
    const exchange = await this.exchange.findOne({ where: { id } });
    if (!exchange) throw new NotFoundCustomException('Exchange', { id });
    return exchange;
  }

  async findBySlug(slug: string): Promise<Exchange> {
    const exchange = await this.exchange.findOne({ where: { slug } });
    if (!exchange) throw new NotFoundCustomException('Exchange', { slug });
    return exchange;
  }

  async getExchanges({ supported }: { supported?: boolean } = {}): Promise<Exchange[]> {
    const where = supported !== undefined ? { supported } : {};
    const exchanges = await this.exchange.find({ where, order: { name: 'ASC' } });
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
    const exchange = await this.exchange.findOne({ where: { name } });
    if (!exchange) throw new NotFoundCustomException('Exchange', { name });
    return exchange;
  }

  async createExchange(Exchange: CreateExchangeDto): Promise<Exchange> {
    const exchange = await this.exchange.findOne({ where: { name: Exchange.name } });
    return exchange ?? ((await this.exchange.insert(Exchange)).generatedMaps[0] as Exchange);
  }

  async updateExchange(exchangeSlug: string, dto: UpdateExchangeDto): Promise<Exchange> {
    const data = await this.getExchangeById(exchangeSlug);
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

  /**
   * Find all exchanges that the user has active API keys for
   * @param userId The user ID to find exchanges for
   * @returns An array of exchanges with active API keys
   */
  async findAllWithUserKeys(userId: string): Promise<Exchange[]> {
    // Get all supported exchanges
    const exchanges = await this.getExchanges({ supported: true });

    // Filter to ones where the user has API keys
    const exchangesWithKeys: Exchange[] = [];

    for (const exchange of exchanges) {
      try {
        const keys = await this.exchangeKeyService.findByExchange(exchange.id, userId);
        if (keys && keys.length > 0 && keys.some((key) => key.isActive)) {
          exchangesWithKeys.push(exchange);
        }
      } catch (error) {
        // Continue if there's an error finding keys for this exchange
      }
    }

    return exchangesWithKeys;
  }
}
