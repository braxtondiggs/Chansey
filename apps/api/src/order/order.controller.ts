import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { OrderDto } from './dto/order.dto';
import { OrderService } from './order.service';
import { TestnetService } from './testnet/testnet.service';
import { APIAuthenticationGuard } from '../authentication/guard/api-authentication.guard';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import RequestWithUser from '../authentication/interface/requestWithUser.interface';
import FindOneParams from '../utils/findOneParams';

@ApiTags('Order')
@ApiBearerAuth('token')
@Controller('order')
export class OrderController {
  constructor(private readonly order: OrderService, private readonly testnet: TestnetService) {}

  @Get()
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({})
  async getOrders(@Req() { user }: RequestWithUser) {
    return this.order.getOrders(user);
  }

  @Get(':id')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({})
  getOrder(@Param() { id }: FindOneParams, @Req() { user }: RequestWithUser) {
    return this.order.getOrder(user, +id);
  }

  @Get('open')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({})
  async getOpenOrders(@Req() { user }: RequestWithUser) {
    return this.order.getOpenOrders(user);
  }

  @Post('buy')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({})
  async createBuyOrder(@Body() dto: OrderDto, @Req() { user }: RequestWithUser) {
    return this.order.createOrder('BUY', dto, user);
  }

  @Post('sell')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({})
  async createSellOrder(@Body() dto: OrderDto, @Req() { user }: RequestWithUser) {
    return this.order.createOrder('SELL', dto, user);
  }

  @Post('buy/test')
  @UseGuards(APIAuthenticationGuard)
  @ApiOperation({
    summary: 'Create a test buy order',
    description: 'This endpoint is used to create a test buy order. It will not be executed on the exchange.'
  })
  async createTestBuyOrder(@Body() dto: OrderDto) {
    return this.testnet.createOrder('BUY', dto);
  }

  @Post('sell/test')
  @UseGuards(APIAuthenticationGuard)
  @ApiOperation({
    summary: 'Create a test sell order',
    description: 'This endpoint is used to create a test sell order. It will not be executed on the exchange.'
  })
  async createTestSellOrder(@Body() dto: OrderDto) {
    return 'Sup'; // this.testnet.createOrder('SELL', dto, user);
  }
}
