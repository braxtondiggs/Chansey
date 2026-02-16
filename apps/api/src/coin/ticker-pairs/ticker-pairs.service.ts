import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { CreateTickerDto } from './dto';
import { TickerPairs } from './ticker-pairs.entity';

import { CoinService } from '../coin.service';

@Injectable()
export class TickerPairService {
  constructor(
    @InjectRepository(TickerPairs)
    private readonly pairs: Repository<TickerPairs>,
    private readonly coin: CoinService
  ) {}

  async getTickerPairs() {
    return this.pairs.find({
      relations: ['baseAsset', 'quoteAsset', 'exchange']
    });
  }

  async getTickerPairsByExchange(exchangeId: string) {
    return this.pairs.find({
      where: { exchange: { id: exchangeId } },
      relations: ['baseAsset', 'quoteAsset', 'exchange']
    });
  }

  async getTickerPairBySymbol(baseAsset: string, quoteAsset: string) {
    return this.pairs.findOne({
      where: { symbol: `${baseAsset.toUpperCase()}${quoteAsset.toUpperCase()}` },
      relations: ['baseAsset', 'quoteAsset']
    });
  }

  async getBasePairsBySymbol(symbol: string): Promise<TickerPairs[]> {
    const coin = await this.coin.getCoinBySymbol(symbol);
    if (!coin) throw new NotFoundException(`Coin with symbol ${symbol} not found`);

    return this.pairs.find({
      where: { baseAsset: coin },
      relations: ['baseAsset', 'quoteAsset']
    });
  }

  async getQuotePairsBySymbol(symbol: string): Promise<TickerPairs[]> {
    const coin = await this.coin.getCoinBySymbol(symbol);
    if (!coin) throw new NotFoundException(`Coin with symbol ${symbol} not found`);

    return this.pairs.find({
      where: { quoteAsset: coin },
      relations: ['baseAsset', 'quoteAsset']
    });
  }

  async getBasePairsById(id: string): Promise<TickerPairs | null> {
    return this.pairs.findOne({
      where: { id },
      relations: ['baseAsset', 'quoteAsset']
    });
  }

  async createTickerPair(data: CreateTickerDto): Promise<TickerPairs> {
    return this.pairs.create(data);
  }

  async removeTickerPair(data: TickerPairs | TickerPairs[]): Promise<void> {
    const items = Array.isArray(data) ? data : [data];
    const ids = items.map((item) => item.id);
    await this.pairs.delete(ids);
  }

  async saveTickerPair(data: TickerPairs[]): Promise<TickerPairs[]> {
    return this.pairs.save(data);
  }

  async getTickerPairsCountByExchange(): Promise<{ exchangeId: string; count: number }[]> {
    const result = await this.pairs
      .createQueryBuilder('ticker')
      .select('ticker.exchangeId', 'exchangeId')
      .addSelect('COUNT(ticker.id)', 'count')
      .groupBy('ticker.exchangeId')
      .getRawMany();

    return result.map(({ exchangeId, count }) => ({
      exchangeId,
      count: parseInt(count) || 0
    }));
  }
}
