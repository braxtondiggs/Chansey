import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

import { AppService } from './app.service';
import { CoinService } from './coin/coin.service';
import { OrderSide, OrderType } from './order/order.entity';
import { TestnetService } from './order/testnet/testnet.service';
import { Message } from '@chansey/api-interfaces';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly testnet: TestnetService,
    private readonly coin: CoinService
  ) {}

  @Get('hello')
  @ApiExcludeEndpoint()
  getData(): Message {
    return this.appService.getData();
  }

  @Post('webhook/cca')
  async CCAWebhook(
    @Body() body: { currency: string; percent: string; window: string; exchange: string; message: string }
  ) {
    if (body.message?.includes('Confirmation')) return { message: 'Confirming the Confirmation ;)' };
    const action = +body.percent > 0 ? OrderSide.BUY : OrderSide.SELL;
    const coin = await this.coin.getCoinBySymbol(body.currency);
    if (!coin && coin.id) throw new Error('Coin not found'); // TODO: Need to create a way to notify on failure
    return await this.testnet.createOrder(action, {
      algorithm: 'facb28ad-5ed7-4615-a2fb-f825e53008a2',
      coinId: coin.id,
      quantity: '1',
      type: OrderType.MARKET
    });
  }
}
