import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CoinGeckoClient } from 'coingecko-api-v3';

import { BinanceService } from '../../exchange/binance/binance.service';
import { CoinService } from '../coin.service';
import { TickerPairStatus, TickerPairs } from './ticker-pairs.entity';
import { TickerPairService } from './ticker-pairs.service';
import { ExchangeService } from '../../exchange/exchange.service';

@Injectable()
export class TickerPairTask {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(TickerPairTask.name);
  constructor(
    private readonly binance: BinanceService,
    private readonly coin: CoinService,
    private readonly exchange: ExchangeService,
    private readonly tickerPair: TickerPairService
  ) {}

  @Cron(CronExpression.EVERY_WEEK)
  async getTickerPairs() {
    try {
      this.logger.log('Starting ticker pairs synchronization');

      // Get Binance exchange info first
      const binance = this.binance.getBinanceClient();
      const { symbols } = await binance.exchangeInfo();

      // Create a map for quick lookup of Binance pair data
      const binancePairMap = new Map(
        symbols.map((symbol) => [
          `${symbol.baseAsset}${symbol.quoteAsset}`.toUpperCase(),
          {
            status: symbol.status as TickerPairStatus,
            isSpotTradingAllowed: symbol.isSpotTradingAllowed,
            isMarginTradingAllowed: symbol.isMarginTradingAllowed
          }
        ])
      );

      const existingPairs = await this.tickerPair.getTickerPairs();

      const coins = await this.coin.getCoins();
      const exchanges = await this.exchange.getExchanges({ supported: true });
      const newPairs: TickerPairs[] = [];

      for (const exchange_slug of exchanges) {
        try {
          let page = 1;
          const exchangePairs = new Set<string>();

          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { tickers } = await this.gecko.exchangeIdTickers({
              id: exchange_slug.slug,
              page
            });

            if (tickers.length === 0) break;

            for (const ticker of tickers) {
              const baseCoin = coins.find((c) => c.slug.toLowerCase() === ticker.coin_id.toLowerCase());
              const quoteCoin = coins.find((c) => c.slug.toLowerCase() === ticker.target_coin_id?.toLowerCase());
              const exchange = exchanges.find((e) => e.slug.toLowerCase() === ticker.market?.identifier?.toLowerCase());

              if (!baseCoin || !quoteCoin || !exchange) continue;

              const pairKey = `${baseCoin.id}-${quoteCoin.id}-${exchange.id}`;
              exchangePairs.add(pairKey);

              const existingPair = existingPairs.find(
                (p) =>
                  p.baseAsset.id === baseCoin.id && p.quoteAsset.id === quoteCoin.id && p.exchange.id === exchange.id
              );

              const pairSymbol = `${baseCoin.symbol}${quoteCoin.symbol}`.toUpperCase();
              const binanceData = binancePairMap.get(pairSymbol);

              if (!existingPair) {
                newPairs.push(
                  await this.tickerPair.createTickerPair({
                    baseAsset: baseCoin,
                    quoteAsset: quoteCoin,
                    exchange,
                    volume: ticker.volume || 0,
                    tradeUrl: ticker.trade_url,
                    spreadPercentage: ticker.bid_ask_spread_percentage || 0,
                    lastTraded: ticker.last_traded_at,
                    fetchAt: new Date(),
                    // Use Binance data if available, otherwise use defaults
                    status: binanceData?.status || TickerPairStatus.TRADING,
                    isSpotTradingAllowed: binanceData?.isSpotTradingAllowed ?? true,
                    isMarginTradingAllowed: binanceData?.isMarginTradingAllowed ?? false
                  })
                );
              } else {
                // Update existing pair
                Object.assign(existingPair, {
                  volume: ticker.volume || existingPair.volume,
                  tradeUrl: ticker.trade_url || existingPair.tradeUrl,
                  spreadPercentage: ticker.bid_ask_spread_percentage || existingPair.spreadPercentage,
                  lastTraded: ticker.last_traded_at,
                  fetchAt: new Date(),
                  ...(binanceData && {
                    status: binanceData.status,
                    isSpotTradingAllowed: binanceData.isSpotTradingAllowed,
                    isMarginTradingAllowed: binanceData.isMarginTradingAllowed
                  })
                });
              }
            }

            this.logger.log(`Processed page ${page} for ${exchange_slug}`);
            await new Promise((r) => setTimeout(r, 1000)); // Rate limiting
            page++;
          }

          // Find pairs to remove
          const pairsToRemove = existingPairs.filter((pair) => {
            const pairKey = `${pair.baseAsset.id}-${pair.quoteAsset.id}-${pair.exchange.id}`;
            return !exchangePairs.has(pairKey);
          });

          if (pairsToRemove.length > 0) {
            await this.tickerPair.removeTickerPair(pairsToRemove);
            this.logger.log(`Removed ${pairsToRemove.length} deprecated pairs for ${exchange_slug}`);
          }
        } catch (exchangeError) {
          this.logger.error(`Error processing exchange ${exchange_slug}:`, exchangeError);
          continue; // Continue with next exchange
        }
      }

      // Save new pairs and updates
      if (newPairs.length > 0) {
        await this.tickerPair.saveTickerPair(newPairs);
        this.logger.log(`Added ${newPairs.length} new pairs`);
      }

      await this.tickerPair.saveTickerPair(existingPairs);
      this.logger.log('Ticker pairs synchronization completed');
    } catch (error) {
      this.logger.error('Failed to synchronize ticker pairs:', error);
      throw error;
    }
  }
}
