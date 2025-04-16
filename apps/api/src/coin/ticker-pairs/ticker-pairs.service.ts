import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BinanceService } from '../../exchange/binance/binance.service';
import { CoinService } from '../coin.service';
import { TickerPairs } from './ticker-pairs.entity';
import { CreateTickerDto } from './dto';

@Injectable()
export class TickerPairService {
  constructor(
    @InjectRepository(TickerPairs)
    private readonly pairs: Repository<TickerPairs>,
    private readonly binance: BinanceService,
    private readonly coin: CoinService
  ) {}

  async getTickerPairs() {
    return this.pairs.find({
      relations: ['baseAsset', 'quoteAsset', 'exchange']
    });
  }

  async getTickerPairsByExchange(exchangeId: string) {
    return this.pairs.find({
      where: { exchange: { id: exchangeId } }
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

  async getBasePairsById(id: string): Promise<TickerPairs> {
    return this.pairs.findOne({
      where: { id },
      relations: ['baseAsset', 'quoteAsset']
    });
  }

  async createTickerPair(data: CreateTickerDto): Promise<TickerPairs> {
    return await this.pairs.create(data);
  }

  async removeTickerPair(data: TickerPairs | TickerPairs[]): Promise<void> {
    const items = Array.isArray(data) ? data : [data];
    const ids = items.map((item) => item.id);
    await this.pairs.delete(ids);
  }

  async saveTickerPair(data: TickerPairs[]): Promise<TickerPairs[]> {
    return this.pairs.save(data);
  }
}
