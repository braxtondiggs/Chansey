import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BinanceService } from './../exchange/binance/binance.service';
import { Risk } from './risk.entity';
import { UserController } from './users.controller';
import { User } from './users.entity';
import UsersService from './users.service';

@Module({
  controllers: [UserController],
  imports: [ConfigModule, TypeOrmModule.forFeature([Risk, User])],
  providers: [BinanceService, UsersService],
  exports: [UsersService]
})
export class UsersModule {}
