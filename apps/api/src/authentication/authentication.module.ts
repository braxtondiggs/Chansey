import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthenticationController } from './authentication.controller';
import { AuthenticationService } from './authentication.service';
import { RolesGuard } from './guard/roles.guard';
import { RefreshTokenService } from './refresh-token.service';
import { ApiKeyStrategy } from './strategy/api.strategy';
import { JwtStrategy } from './strategy/jwt.strategy';
import { LocalStrategy } from './strategy/local.strategy';

import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    ConfigModule,
    JwtModule.register({}) // Empty config, will use service-level config
  ],
  providers: [ApiKeyStrategy, AuthenticationService, LocalStrategy, JwtStrategy, RolesGuard, RefreshTokenService],
  controllers: [AuthenticationController],
  exports: [RolesGuard, RefreshTokenService]
})
export class AuthenticationModule {}
