import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';

import { AuthenticationController } from './authentication.controller';
import { AuthenticationService } from './authentication.service';
import { RolesGuard } from './guard/roles.guard';
import { ApiKeyStrategy } from './strategy/api.strategy';
import { JwtStrategy } from './strategy/jwt.strategy';
import { LocalStrategy } from './strategy/local.strategy';

import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule, PassportModule, ConfigModule],
  providers: [ApiKeyStrategy, AuthenticationService, LocalStrategy, JwtStrategy, RolesGuard],
  controllers: [AuthenticationController],
  exports: [RolesGuard]
})
export class AuthenticationModule {}
