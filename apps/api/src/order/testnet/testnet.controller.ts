import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { TestnetDto } from './dto/testnet.dto';
import { TestnetService } from './testnet.service';
import { APIAuthenticationGuard } from '../../authentication/guard/api-authentication.guard';
import { OrderSide } from '../order.entity';

@ApiTags('Order')
@UseGuards(APIAuthenticationGuard)
@ApiSecurity('api-key')
@Controller('testnet')
export class TestnetController {
  constructor(private readonly testnet: TestnetService) {}

  @Post('buy')
  @ApiOperation({
    summary: 'Create a test buy order',
    description: 'This endpoint is used to create a test buy order. It will not be executed on the exchange.'
  })
  async createTestBuyOrder(@Body() dto: TestnetDto) {
    return this.testnet.createOrder(OrderSide.BUY, dto);
  }

  @Post('sell')
  @ApiOperation({
    summary: 'Create a test sell order',
    description: 'This endpoint is used to create a test sell order. It will not be executed on the exchange.'
  })
  async createTestSellOrder(@Body() dto: TestnetDto) {
    return this.testnet.createOrder(OrderSide.SELL, dto);
  }
}
