import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CoinPairs, PairStatus } from './pairs.entity';
import { BinanceService } from '../../exchange/binance/binance.service';
import { Coin } from '../coin.entity';

@Injectable()
export class CoinPairsService {
  private readonly logger = new Logger(CoinPairsService.name);

  constructor(
    @InjectRepository(CoinPairs)
    private readonly pairs: Repository<CoinPairs>,
    @InjectRepository(Coin)
    private readonly coin: Repository<Coin>,
    private readonly binance: BinanceService
  ) {}

  async getBasePairsBySymbol(symbol: string): Promise<CoinPairs[]> {
    const coin = await this.findCoin(symbol);
    if (!coin) throw new NotFoundException(`Coin with symbol ${symbol} not found`);

    return this.pairs.find({
      where: { baseAsset: coin },
      relations: ['baseAsset', 'quoteAsset']
    });
  }

  async getQuotePairsBySymbol(symbol: string): Promise<CoinPairs[]> {
    const coin = await this.findCoin(symbol);
    if (!coin) throw new NotFoundException(`Coin with symbol ${symbol} not found`);

    return this.pairs.find({
      where: { quoteAsset: coin },
      relations: ['baseAsset', 'quoteAsset']
    });
  }

  private async findCoin(symbol: string): Promise<Coin | null> {
    return this.coin.findOne({
      where: { symbol: symbol.toLowerCase() },
      cache: true // Cache frequently accessed coins
    });
  }

  @Cron(CronExpression.EVERY_WEEK)
  async getAllPairs(): Promise<CoinPairs[]> {
    try {
      const binance = this.binance.getBinanceClient();
      const { symbols } = await binance.exchangeInfo();

      await this.pairs.clear();

      const pairsToSave = (
        await Promise.all(
          symbols.map(async (symbol) => {
            const [baseAsset, quoteAsset] = await Promise.all([
              this.findCoin(symbol.baseAsset),
              this.findCoin(symbol.quoteAsset)
            ]);

            if (!baseAsset || !quoteAsset) return null;

            return this.pairs.create({
              baseAsset,
              quoteAsset,
              symbol: symbol.symbol,
              status: symbol.status as PairStatus,
              isSpotTradingAllowed: symbol.isSpotTradingAllowed,
              isMarginTradingAllowed: symbol.isMarginTradingAllowed
            });
          })
        )
      ).filter((pair) => pair !== null);

      await this.pairs.save(pairsToSave);
      this.logger.log(`Successfully updated ${pairsToSave.length} trading pairs`);
      return pairsToSave;
    } catch (error) {
      this.logger.error('Failed to update trading pairs:', error);
      throw error;
    }
  }
}
