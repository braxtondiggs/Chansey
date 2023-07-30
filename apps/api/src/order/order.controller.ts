import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { OrderDto } from './dto/order.dto';
import { OrderSide } from './order.entity';
import { OrderService } from './order.service';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import RequestWithUser from '../authentication/interface/requestWithUser.interface';
import FindOneParams from '../utils/findOneParams';

@ApiTags('Order')
@ApiBearerAuth('token')
@Controller('order')
export class OrderController {
  constructor(private readonly order: OrderService) {}

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
    return this.order.createOrder(OrderSide.BUY, dto, user);
  }

  @Post('sell')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({})
  async createSellOrder(@Body() dto: OrderDto, @Req() { user }: RequestWithUser) {
    return this.order.createOrder(OrderSide.SELL, dto, user);
  }
}
