import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SecurityAuditLog, SecurityAuditService } from './audit';
import { AuthenticationController } from './authentication.controller';
import { AuthenticationService } from './authentication.service';
import { RolesGuard } from './guard/roles.guard';
import { WsJwtAuthenticationGuard } from './guard/ws-jwt-authentication.guard';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';
import { ApiKeyStrategy } from './strategy/api.strategy';
import { JwtStrategy } from './strategy/jwt.strategy';
import { LocalStrategy } from './strategy/local.strategy';

import { EmailModule } from '../email/email.module';
import { User } from '../users/users.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    EmailModule,
    TypeOrmModule.forFeature([User, SecurityAuditLog]),
    JwtModule.register({}) // Empty config, will use service-level config
  ],
  providers: [
    ApiKeyStrategy,
    AuthenticationService,
    LocalStrategy,
    JwtStrategy,
    RolesGuard,
    WsJwtAuthenticationGuard,
    RefreshTokenService,
    PasswordService,
    SecurityAuditService
  ],
  controllers: [AuthenticationController],
  exports: [JwtModule, RolesGuard, WsJwtAuthenticationGuard, RefreshTokenService, PasswordService, SecurityAuditService]
})
export class AuthenticationModule {}
