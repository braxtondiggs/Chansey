import { Logger, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';

import { isUUID } from 'class-validator';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';

import { PaperTradingSession } from './entities';

import { WsJwtAuthenticationGuard } from '../../authentication/guard/ws-jwt-authentication.guard';
import { User } from '../../users/users.entity';

/**
 * Dynamic CORS configuration based on environment.
 * In production, CORS origins must be explicitly configured via PAPER_TRADING_CORS_ORIGINS.
 * In development, localhost origins are allowed by default.
 */
const getCorsConfig = () => {
  const origins = process.env.PAPER_TRADING_CORS_ORIGINS;
  if (origins) {
    return {
      origin: origins
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      credentials: process.env.PAPER_TRADING_CORS_CREDENTIALS !== 'false'
    };
  }
  // In development, allow localhost origins
  if (process.env.NODE_ENV !== 'production') {
    return {
      origin: ['http://localhost:4200', 'http://localhost:3000', 'http://127.0.0.1:4200'],
      credentials: true
    };
  }
  // In production, require explicit CORS configuration - deny all by default
  return {
    origin: false,
    credentials: false
  };
};

@WebSocketGateway({ namespace: 'paper-trading', cors: getCorsConfig() })
export class PaperTradingGateway {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(PaperTradingGateway.name);

  constructor(
    @InjectRepository(PaperTradingSession)
    private readonly sessionRepository: Repository<PaperTradingSession>
  ) {}

  @UseGuards(WsJwtAuthenticationGuard)
  @SubscribeMessage('subscribe')
  async handleSubscribe(@ConnectedSocket() client: Socket, @MessageBody() payload: { sessionId: string }) {
    // Validate session ID format
    if (!payload?.sessionId || !isUUID(payload.sessionId, '4')) {
      client.emit('error', { message: 'Valid session ID (UUID v4) is required' });
      return;
    }

    // Get authenticated user from socket data
    const user = client.data.user as User;
    if (!user) {
      client.emit('error', { message: 'Authentication required' });
      return;
    }

    // Verify user owns this session
    const session = await this.sessionRepository.findOne({
      where: { id: payload.sessionId, user: { id: user.id } }
    });

    if (!session) {
      client.emit('error', { message: 'Session not found or access denied' });
      return;
    }

    client.join(this.room(payload.sessionId));
    this.logger.debug(
      `Client ${client.id} (user: ${user.id}) subscribed to paper trading session ${payload.sessionId}`
    );
    client.emit('subscribed', { sessionId: payload.sessionId });
  }

  @UseGuards(WsJwtAuthenticationGuard)
  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(@ConnectedSocket() client: Socket, @MessageBody() payload: { sessionId: string }) {
    // Validate session ID format
    if (!payload?.sessionId || !isUUID(payload.sessionId, '4')) {
      client.emit('error', { message: 'Valid session ID (UUID v4) is required' });
      return;
    }

    client.leave(this.room(payload.sessionId));
    this.logger.debug(`Client ${client.id} unsubscribed from paper trading session ${payload.sessionId}`);
    client.emit('unsubscribed', { sessionId: payload.sessionId });
  }

  emit(sessionId: string, event: string, data: unknown) {
    this.server?.to(this.room(sessionId)).emit(event, data);
  }

  private room(sessionId: string): string {
    return `paper-trading:${sessionId}`;
  }
}
