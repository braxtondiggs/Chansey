import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { Role } from '@chansey/api-interfaces';

import { User } from '../users/users.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService
  ) {}

  async refreshAccessToken(
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken: string; rememberMe: boolean }> {
    try {
      // Verify refresh token
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        algorithms: ['HS512']
      });

      // Get user data with auth profile (includes roles)
      const baseUser = await this.usersService.getById(payload.sub);
      if (!baseUser) {
        throw new UnauthorizedException('User not found');
      }

      // Get user with full profile including roles
      const user = await this.usersService.getProfile(baseUser);

      // Check if this was a "remember me" token by looking at its expiration
      const currentTime = Math.floor(Date.now() / 1000);
      const timeUntilExpiry = payload.exp - currentTime;
      const rememberMe = timeUntilExpiry > 14 * 24 * 60 * 60; // If more than 14 days remaining, it was a remember me token

      // Generate new tokens with same remember me preference and preserved roles
      const newAccessToken = await this.generateAccessToken(user);
      const newRefreshToken = await this.generateRefreshToken(user, rememberMe);

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        rememberMe: rememberMe
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async generateAccessToken(user: User): Promise<string> {
    const payload = {
      sub: user.id,
      email: user.email,
      roles: user.roles || [Role.USER], // Default to 'user' role if none assigned
      type: 'access'
    };

    return this.jwtService.signAsync(payload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: this.configService.get('JWT_EXPIRATION_TIME', '15m'), // Short-lived access token
      algorithm: 'HS512'
    });
  }

  async generateRefreshToken(user: User, rememberMe = false): Promise<string> {
    const payload = {
      sub: user.id,
      type: 'refresh',
      roles: user.roles || [Role.USER] // Include roles in refresh token to preserve them
    };

    // Use longer expiration for remember me
    const expiresIn = rememberMe ? '30d' : this.configService.get('JWT_REFRESH_EXPIRATION_TIME', '7d');

    return this.jwtService.signAsync(payload, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: expiresIn,
      algorithm: 'HS512'
    });
  }

  getCookieWithTokens(accessToken: string, refreshToken: string, rememberMe = false): string[] {
    const accessExpiration = 15 * 60; // 15 minutes for access token
    const refreshExpiration = rememberMe ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60; // 30 days if remember me, else 7 days

    const isProduction = this.configService.get('NODE_ENV') === 'production';
    const domain = isProduction ? '.cymbit.com' : 'localhost';
    const secure = isProduction ? 'Secure; ' : '';

    return [
      `chansey_access=${accessToken}; Max-Age=${accessExpiration}; Path=/; HttpOnly; ${secure}SameSite=Strict; Domain=${domain};`,
      `chansey_refresh=${refreshToken}; Max-Age=${refreshExpiration}; Path=/; HttpOnly; ${secure}SameSite=Strict; Domain=${domain};`
    ];
  }

  getCookiesForLogOut(): string[] {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    const domain = isProduction ? '.cymbit.com' : 'localhost';
    const secure = isProduction ? 'Secure; ' : '';

    return [
      `chansey_access=; Max-Age=0; Path=/; HttpOnly; ${secure}SameSite=Strict; Domain=${domain};`,
      `chansey_refresh=; Max-Age=0; Path=/; HttpOnly; ${secure}SameSite=Strict; Domain=${domain};`
    ];
  }
}
