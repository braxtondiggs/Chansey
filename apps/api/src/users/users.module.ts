import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { UserController } from './users.controller';
import User from './users.entity';
import UsersService from './users.service';

@Module({
  controllers: [UserController],
  imports: [MikroOrmModule.forFeature([User])],
  providers: [UsersService],
  exports: [UsersService]
})
export class UsersModule {}
