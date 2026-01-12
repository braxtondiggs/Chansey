import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: 'backtests', cors: true })
export class BacktestGateway {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(BacktestGateway.name);

  @SubscribeMessage('subscribe')
  handleSubscribe(@ConnectedSocket() client: Socket, @MessageBody() payload: { backtestId: string }) {
    if (!payload?.backtestId) {
      client.emit('error', { message: 'Backtest ID is required' });
      return;
    }

    client.join(this.room(payload.backtestId));
    this.logger.debug(`Client ${client.id} subscribed to backtest ${payload.backtestId}`);
    client.emit('subscribed', { backtestId: payload.backtestId });
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(@ConnectedSocket() client: Socket, @MessageBody() payload: { backtestId: string }) {
    if (!payload?.backtestId) {
      client.emit('error', { message: 'Backtest ID is required' });
      return;
    }
    client.leave(this.room(payload.backtestId));
    this.logger.debug(`Client ${client.id} unsubscribed from backtest ${payload.backtestId}`);
    client.emit('unsubscribed', { backtestId: payload.backtestId });
  }

  emit(runId: string, event: string, data: unknown) {
    this.server?.to(this.room(runId)).emit(event, data);
  }

  private room(runId: string): string {
    return `backtest:${runId}`;
  }
}
