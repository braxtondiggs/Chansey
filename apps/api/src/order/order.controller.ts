import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { OrderBinanceResponseDto, OrderDto } from './dto';
import { OrderSide } from './order.entity';
import { OrderService } from './order.service';
import GetUser from '../authentication/decorator/get-user.decorator';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import { User } from '../users/users.entity';

@ApiTags('Order')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@Controller('order')
export class OrderController {
  constructor(private readonly order: OrderService) {}

  @Get()
  @ApiOperation({ summary: 'Retrieve all orders' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of all orders for the user.',
    type: [OrderDto]
  })
  async getOrders(@GetUser() user: User) {
    return this.order.getOrders(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a single order by ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the portfolio item',
    type: String,
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Details of the specified order.',
    type: OrderDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Order not found.'
  })
  getOrder(@Param('id', new ParseUUIDPipe()) id: string, @GetUser() user: User) {
    return this.order.getOrder(user, +id);
  }

  @Get('open')
  @ApiOperation({ summary: 'Retrieve all open orders' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of all open orders for the user.',
    type: [OrderDto]
  })
  async getOpenOrders(@GetUser() user: User) {
    return this.order.getOpenOrders(user);
  }

  @Post('buy')
  @ApiOperation({ summary: 'Create a new buy order' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The buy order has been successfully created.',
    type: OrderBinanceResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data.'
  })
  async createBuyOrder(@Body() dto: OrderDto, @GetUser() user: User) {
    return this.order.createOrder(OrderSide.BUY, dto, user);
  }

  @Post('sell')
  @ApiOperation({ summary: 'Create a new sell order' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The sell order has been successfully created.',
    type: OrderBinanceResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data.'
  })
  async createSellOrder(@Body() dto: OrderDto, @GetUser() user: User) {
    return this.order.createOrder(OrderSide.SELL, dto, user);
  }
}
