import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { Socket } from 'socket.io';

import { toErrorInfo } from '../../shared/error.util';
import { UsersService } from '../../users/users.service';

interface AccessTokenPayload {
  sub: string;
  email: string;
  roles: string[];
  type: string;
  exp: number;
  iat: number;
}

@Injectable()
export class WsJwtAuthenticationGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtAuthenticationGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient();

    try {
      const token = this.extractToken(client);
      if (!token) {
        this.logger.debug('No token found in WebSocket connection');
        client.emit('error', { message: 'Authentication required' });
        return false;
      }

      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.configService.get('JWT_SECRET'),
        algorithms: ['HS512']
      });

      if (payload.type !== 'access') {
        this.logger.debug('Invalid token type for WebSocket connection');
        client.emit('error', { message: 'Authentication failed' });
        return false;
      }

      const user = await this.usersService.getById(payload.sub, false);
      if (!user) {
        this.logger.debug(`User ${payload.sub} not found`);
        client.emit('error', { message: 'Authentication failed' });
        return false;
      }

      // Attach user to socket data for later use
      client.data.user = user;
      return true;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.debug(`WebSocket authentication failed: ${err.message}`);
      client.emit('error', { message: 'Authentication failed' });
      return false;
    }
  }

  private extractToken(client: Socket): string | null {
    // Try to get token from handshake auth (preferred method)
    const authToken = client.handshake.auth?.token;
    if (authToken) {
      return authToken;
    }

    // Try to get token from handshake headers (Authorization: Bearer <token>)
    const authHeader = client.handshake.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // Try to get token from cookies (secure method)
    const cookies = client.handshake.headers?.cookie;
    if (cookies) {
      const tokenCookie = cookies.split(';').find((c) => c.trim().startsWith('chansey_access='));
      if (tokenCookie) {
        return tokenCookie.split('=')[1]?.trim();
      }
    }

    // SECURITY WARNING: Query string tokens are logged by servers/proxies and can leak in referrer headers.
    // This method is provided only for WebSocket clients that cannot set headers or cookies.
    // In production, prefer auth handshake, Authorization header, or secure cookies.
    const queryToken = client.handshake.query?.token;
    if (queryToken && typeof queryToken === 'string') {
      this.logger.warn(
        `WebSocket client ${client.id} using query string token authentication. ` +
          'This method is less secure - tokens may be logged or leaked. ' +
          'Consider using handshake auth or cookies instead.'
      );
      return queryToken;
    }

    return null;
  }
}
