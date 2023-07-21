import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CoinController } from './coin.controller';
import { Coin } from './coin.entity';
import { CoinService } from './coin.service';
import User from '../users/users.entity';
import UsersService from '../users/users.service';

@Module({
  controllers: [CoinController],
  exports: [CoinService],
  imports: [ConfigModule, TypeOrmModule.forFeature([Coin, User])],
  providers: [CoinService, UsersService]
})
export class CoinModule {}
