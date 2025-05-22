import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BinanceUSService } from './binance/binance-us.service';
import { CoinbaseService } from './coinbase/coinbase.service';
import { ExchangeKeyModule } from './exchange-key/exchange-key.module';
import { ExchangeController } from './exchange.controller';
import { Exchange } from './exchange.entity';
import { ExchangeService } from './exchange.service';
import { ExchangeSyncTask } from './tasks/exchange-sync.task';

import { AppModule } from '../app.module';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';

@Module({
  controllers: [ExchangeController],
  imports: [
    forwardRef(() => AppModule),
    TypeOrmModule.forFeature([Coin, Exchange]),
    forwardRef(() => ExchangeKeyModule),
    BullModule.registerQueue({ name: 'exchange-queue' })
  ],
  providers: [BinanceUSService, CoinbaseService, CoinService, ExchangeService, ExchangeSyncTask],
  exports: [ExchangeService, BinanceUSService, CoinbaseService]
})
export class ExchangeModule {}
