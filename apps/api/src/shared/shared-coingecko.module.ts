import { Global, Module } from '@nestjs/common';

import { CoinGeckoClientService } from './coingecko-client.service';

@Global()
@Module({
  providers: [CoinGeckoClientService],
  exports: [CoinGeckoClientService]
})
export class SharedCoinGeckoModule {}
