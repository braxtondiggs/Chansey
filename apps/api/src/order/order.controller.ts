import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';

import { OrderDto, OrderResponseDto } from './dto';
import { OrderSide, OrderStatus } from './order.entity';
import { OrderService } from './order.service';

import GetUser from '../authentication/decorator/get-user.decorator';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import { User } from '../users/users.entity';

@ApiTags('Order')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@Controller('order')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @ApiOperation({ summary: 'Get user orders with optional filtering' })
  @ApiQuery({ name: 'status', enum: OrderStatus, required: false, description: 'Filter by order status' })
  @ApiQuery({ name: 'side', enum: OrderSide, required: false, description: 'Filter by order side (BUY/SELL)' })
  @ApiQuery({ name: 'limit', type: Number, required: false, description: 'Number of orders to return (default: 50)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of orders for the user',
    type: [OrderResponseDto]
  })
  async getOrders(
    @GetUser() user: User,
    @Query('status') status?: OrderStatus,
    @Query('side') side?: OrderSide,
    @Query('limit') limit = 50
  ) {
    return this.orderService.getOrders(user, { status, side, limit });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific order by ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the order',
    type: String,
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order details',
    type: OrderResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Order not found'
  })
  getOrder(@Param('id', new ParseUUIDPipe()) id: string, @GetUser() user: User) {
    return this.orderService.getOrder(user, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new order (buy or sell)' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Order created successfully',
    type: OrderResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid order data or insufficient funds'
  })
  async createOrder(@Body() orderDto: OrderDto, @GetUser() user: User) {
    return this.orderService.createOrder(orderDto, user);
  }
}
