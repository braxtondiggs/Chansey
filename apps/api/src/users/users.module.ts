import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserController } from './users.controller';
import User from './users.entity';
import UsersService from './users.service';

@Module({
  controllers: [UserController],
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService],
  exports: [UsersService]
})
export class UsersModule {}
