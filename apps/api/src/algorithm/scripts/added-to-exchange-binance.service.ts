import { Injectable, Logger } from '@nestjs/common';

import { BinanceService } from '../../exchange/binance/binance.service';

@Injectable()
export class AddedtoExchangeBinanceService {
  private readonly logger = new Logger(AddedtoExchangeBinanceService.name);
  private readonly client: Binance;
  private readonly USDT_AMOUNT = 100; // Amount to purchase in USDT

  constructor(private readonly binance: BinanceService) {}

  async startMonitoring() {
    this.logger.log('Starting Binance listing monitor');

    // Watch for new symbol listings
    this.client.ws.allTickers((tickers) => {
      tickers.forEach(async (ticker) => {
        if (this.isNewListing(ticker.symbol)) {
          await this.executePurchase(ticker.symbol);
        }
      });
    });
  }

  private isNewListing(symbol: string): boolean {
    // Implement your logic to detect if this is a new listing
    // Could check against a database of known symbols or use timestamp
    return false; // placeholder
  }

  private async executePurchase(symbol: string) {
    try {
      // Get current market price
      const ticker = await this.client.prices({ symbol });
      const price = parseFloat(ticker[symbol]);

      // Calculate quantity based on USDT amount
      const quantity = this.USDT_AMOUNT / price;

      // Place market buy order
      const order = await this.client.order({
        symbol: symbol,
        side: 'BUY',
        type: 'MARKET',
        quoteOrderQty: this.USDT_AMOUNT.toString()
      });

      this.logger.log(`Purchase executed for ${symbol}: ${JSON.stringify(order)}`);
    } catch (error) {
      this.logger.error(`Failed to execute purchase for ${symbol}: ${error.message}`);
    }
  }
}
