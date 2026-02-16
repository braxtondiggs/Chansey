import { Injectable, Logger } from '@nestjs/common';

import * as ccxt from 'ccxt';

import { BinanceUSService } from '../../exchange/binance/binance-us.service';
import { toErrorInfo } from '../../shared/error.util';

@Injectable()
export class AddedtoExchangeBinanceService {
  private readonly logger = new Logger(AddedtoExchangeBinanceService.name);
  private client: ccxt.binanceus;
  private readonly USDT_AMOUNT = 100; // Amount to purchase in USDT

  constructor(private readonly binance: BinanceUSService) {}

  async startMonitoring() {
    this.logger.log('Starting Binance listing monitor');

    // Initialize the client
    this.client = await this.binance.getBinanceClient();

    // CCXT doesn't have built-in websocket support for ticker streams like binance-api-node
    // We'll need to poll for new symbols periodically
    setInterval(async () => {
      try {
        await this.checkForNewListings();
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Error checking for new listings: ${err.message}`);
      }
    }, 60000); // Check every minute
  }

  private async checkForNewListings() {
    // Get all current markets
    const markets = await this.client.fetchMarkets();
    const currentSymbols = markets.flatMap((market) => (market?.symbol ? [market.symbol] : []));

    // Compare with previously known symbols (you'd need to store this somewhere)
    // For demonstration, we'll simulate finding a new symbol
    const knownSymbols = this.getKnownSymbols();

    // Find new symbols
    const newSymbols = currentSymbols.filter((symbol) => !knownSymbols.includes(symbol));

    // Process any new symbols
    for (const symbol of newSymbols) {
      this.logger.log(`New listing detected: ${symbol}`);
      await this.executePurchase(symbol);

      // Update known symbols
      this.saveKnownSymbol(symbol);
    }
  }

  private getKnownSymbols(): string[] {
    // In a real implementation, you would retrieve this from a database
    // For demo purposes, we'll return an empty array to simulate all symbols are new
    return [];
  }

  private saveKnownSymbol(symbol: string): void {
    // In a real implementation, you would save this to a database
    this.logger.log(`Saving ${symbol} to known symbols`);
  }

  private async executePurchase(symbol: string) {
    try {
      // Format the symbol correctly for CCXT (e.g., "BTC/USDT" instead of "BTCUSDT")
      const formattedSymbol = symbol.includes('/') ? symbol : symbol.replace(/([A-Z0-9]{3,})([A-Z0-9]{3,})$/, '$1/$2');

      // Get current market price
      const ticker = await this.client.fetchTicker(formattedSymbol);
      const price = ticker.last ?? 0;

      // Calculate quantity based on USDT amount
      const quantity = this.USDT_AMOUNT / price;

      // Place market buy order using CCXT
      const order = await this.client.createOrder(
        formattedSymbol,
        'market',
        'buy',
        quantity,
        undefined, // price not needed for market orders
        {
          // For Binance US, we can specify quoteOrderQty as cost
          cost: this.USDT_AMOUNT
        }
      );

      this.logger.log(`Purchase executed for ${formattedSymbol}: ${JSON.stringify(order)}`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to execute purchase for ${symbol}: ${err.message}`);
    }
  }
}
