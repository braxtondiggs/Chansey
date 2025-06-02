import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { CoinGeckoClient } from 'coingecko-api-v3';
import { In, IsNull, Not, Repository } from 'typeorm';

import { Coin, CoinRelations } from './coin.entity';
import { CreateCoinDto, UpdateCoinDto } from './dto/';

import { User } from '../users/users.entity';
import { NotFoundCustomException } from '../utils/filters/not-found.exception';

interface HistoricalDataPoint {
  timestamp: number;
  price: number;
  volume: number;
  marketCap?: number;
}

@Injectable()
export class CoinService {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });

  constructor(@InjectRepository(Coin) private readonly coin: Repository<Coin>) {}

  async getCoins() {
    const coins = await this.coin.find({ order: { name: 'ASC' } });
    return coins.map((coin) => {
      Object.keys(coin).forEach((key) => coin[key] === null && delete coin[key]);
      return coin;
    });
  }

  async getCoinById(coinId: string, relations?: CoinRelations[]): Promise<Coin> {
    const coin = await this.coin.findOne({ where: { id: coinId }, relations });
    if (!coin) throw new NotFoundCustomException('Coin', { id: coinId });
    Object.keys(coin).forEach((key) => coin[key] === null && delete coin[key]);
    return coin;
  }

  async getCoinBySymbol(symbol: string, relations?: CoinRelations[], fail = true): Promise<Coin> {
    // Handle USD as a special case
    if (symbol.toLowerCase() === 'usd') {
      // Create a virtual USD coin
      const usdCoin = new Coin({
        id: 'USD-virtual',
        slug: 'usd',
        name: 'US Dollar',
        symbol: 'USD',
        image: 'https://flagcdn.com/w80/us.png', // American flag as requested
        description:
          'The United States dollar is the official currency of the United States and several other countries.',
        totalSupply: null,
        circulatingSupply: null,
        maxSupply: null,
        marketCap: null,
        priceChangePercentage24h: null
        // Add other properties as needed
      });
      return usdCoin;
    }

    // Handle other coins normally
    const coin = await this.coin.findOne({
      where: { symbol: symbol.toLowerCase() },
      relations
    });
    if (!coin && fail) throw new NotFoundCustomException('Coin', { symbol });
    Object.keys(coin).forEach((key) => coin[key] === null && delete coin[key]);
    return coin;
  }

  /**
   * Get multiple coins by their symbols
   * @param symbols Array of coin symbols to retrieve
   * @param relations Optional coin relations to include
   * @returns Array of coin entities that were found matching the provided symbols.
   * If some symbols don't exist, they're silently ignored (with a warning log).
   */
  async getMultipleCoinsBySymbol(symbols: string[], relations?: CoinRelations[]): Promise<Coin[]> {
    // Convert all symbols to lowercase for case-insensitive comparison
    const lowercaseSymbols = symbols.map((symbol) => symbol.toLowerCase());

    // Check if USD is requested
    const usdIndex = lowercaseSymbols.indexOf('usd');
    const needsUsd = usdIndex !== -1;

    // Remove USD from the search if it's included as it's a special case
    const symbolsToSearch = needsUsd ? lowercaseSymbols.filter((symbol) => symbol !== 'usd') : lowercaseSymbols;

    // Only query the database if we have actual coin symbols to search for
    const coins =
      symbolsToSearch.length > 0
        ? await this.coin.find({
            where: {
              symbol: In(symbolsToSearch)
            },
            relations,
            order: { name: 'ASC' }
          })
        : [];

    // Create a virtual USD coin when requested
    if (needsUsd) {
      const usdCoin = new Coin({
        id: 'USD-virtual',
        slug: 'usd',
        name: 'US Dollar',
        symbol: 'USD',
        image: 'https://flagcdn.com/w80/us.png', // American flag as requested
        description:
          'The United States dollar is the official currency of the United States and several other countries.',
        totalSupply: null,
        circulatingSupply: null,
        maxSupply: null,
        marketCap: null
        // Add other properties as needed
      });
      coins.push(usdCoin);
    }

    // No need to throw error for missing symbols, just return what we found
    // For logging purposes, we can still detect missing symbols
    const foundSymbols = coins.map((coin) => coin.symbol.toLowerCase());
    const missingSymbols = lowercaseSymbols.filter(
      (symbol) => !foundSymbols.includes(symbol) && symbol !== 'usd' // Don't log USD as missing since we handle it specially
    );

    if (missingSymbols.length > 0) {
      console.log(`Warning: Some requested coin symbols were not found: ${missingSymbols.join(', ')}`);
    }

    // Clean null values from all coins
    return coins.map((coin) => {
      Object.keys(coin).forEach((key) => coin[key] === null && delete coin[key]);
      return coin;
    });
  }

  async create(Coin: CreateCoinDto): Promise<Coin> {
    const coin = await this.coin.findOne({ where: { slug: Coin.slug } });
    return coin ?? ((await this.coin.insert(Coin)).generatedMaps[0] as Coin);
  }

  async createMany(coins: CreateCoinDto[]): Promise<Coin[]> {
    const existingCoins = await this.coin.find({
      where: coins.map((coin) => ({ slug: coin.slug }))
    });

    const newCoins = coins.filter((coin) => !existingCoins.find((existing) => existing.slug === coin.slug));

    if (newCoins.length === 0) return [];

    const result = await this.coin.insert(newCoins);
    return result.generatedMaps as Coin[];
  }

  async update(coinId: string, coin: UpdateCoinDto) {
    const data = await this.getCoinById(coinId);
    if (!data) new NotFoundCustomException('Coin', { id: coinId });
    return await this.coin.save(new Coin({ ...data, ...coin }));
  }

  async updateCurrentPrice(coinId: string, price: number): Promise<void> {
    await this.coin.update(coinId, { currentPrice: price });
  }

  async clearRank() {
    await this.coin.createQueryBuilder().update().set({ geckoRank: null }).execute();
  }

  async remove(coinId: string) {
    const response = await this.coin.delete(coinId);
    if (!response.affected) new NotFoundCustomException('Coin', { id: coinId });
    return response;
  }

  async removeMany(coinIds: string[]): Promise<void> {
    await this.coin.delete({ id: In(coinIds) });
  }

  async getCoinHistoricalData(coinId: string): Promise<HistoricalDataPoint[]> {
    const coin = await this.getCoinById(coinId);

    try {
      const geckoData = await this.gecko.coinIdMarketChart({
        id: coin.slug,
        vs_currency: 'usd',
        days: 365, // !NOTE: Max value w/o paying money
        interval: 'daily'
      });

      if (geckoData?.prices?.length > 0) {
        return geckoData.prices.map((point: [number, number], index: number) => ({
          timestamp: point[0],
          price: point[1],
          volume: geckoData.total_volumes[index]?.[1] || 0,
          marketCap: geckoData.market_caps[index]?.[1] || 0
        }));
      }
    } catch (error) {
      throw new NotFoundCustomException('Historical data', {
        id: coinId,
        message: error
      });
    }
  }

  async getCoinsWithCurrentPrices() {
    return this.coin.find({
      select: ['id', 'slug', 'name', 'symbol', 'image', 'currentPrice'],
      order: { name: 'ASC' }
    });
  }

  async getCoinBySlug(slug: string) {
    return this.coin.findOne({ where: { slug } });
  }

  async getCoinsByRiskLevel({ risk }: User, take = 10) {
    const { level: riskLevel } = risk;

    if (riskLevel === 1) {
      return await this.coin.find({
        where: {
          totalVolume: Not(IsNull())
        },
        order: {
          totalVolume: 'DESC'
        },
        take
      });
    }

    if (riskLevel === 5) {
      return await this.coin.find({
        where: {
          geckoRank: Not(IsNull())
        },
        order: {
          geckoRank: 'ASC'
        },
        take
      });
    }

    // For risk levels 2-4
    return await this.coin
      .createQueryBuilder('coin')
      .where('coin.totalVolume IS NOT NULL')
      .andWhere('coin.geckoRank IS NOT NULL')
      .andWhere('coin.marketCap IS NOT NULL')
      .orderBy(
        `(
          COALESCE(LN(coin."totalVolume" + 1), 0) * ${(5 - riskLevel) / 4} +
          COALESCE(LN(coin."marketCap" + 1), 0) * ${(5 - riskLevel) / 4} -
          COALESCE(coin."geckoRank", 0) * ${(riskLevel - 1) / 4}
        )`,
        'DESC'
      )
      .take(take)
      .getMany();
  }
}
