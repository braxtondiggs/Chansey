import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { OrderDto, OrderResponseDto } from './dto';
import { OrderPreviewRequestDto } from './dto/order-preview-request.dto';
import { OrderPreviewDto } from './dto/order-preview.dto';
import { PlaceManualOrderDto } from './dto/place-manual-order.dto';
import { OrderSide, OrderStatus, OrderType } from './order.entity';
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
  @ApiQuery({
    name: 'status',
    enum: OrderStatus,
    required: false,
    description: 'Filter by order status. Accepts comma-separated values (e.g., NEW,PARTIALLY_FILLED)'
  })
  @ApiQuery({
    name: 'side',
    enum: OrderSide,
    required: false,
    description: 'Filter by order side (BUY/SELL). Accepts comma-separated values'
  })
  @ApiQuery({
    name: 'orderType',
    enum: OrderType,
    required: false,
    description: 'Filter by order type (market, limit, etc.). Accepts comma-separated values'
  })
  @ApiQuery({
    name: 'isManual',
    type: Boolean,
    required: false,
    description: 'Filter by manual (true) vs automated (false) orders'
  })
  @ApiQuery({ name: 'limit', type: Number, required: false, description: 'Number of orders to return (default: 50)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of orders for the user',
    type: [OrderResponseDto]
  })
  async getOrders(
    @GetUser() user: User,
    @Query('status') status?: OrderStatus | string,
    @Query('side') side?: OrderSide | string,
    @Query('orderType') orderType?: OrderType | string,
    @Query('isManual') isManual?: boolean,
    @Query('limit') limit = 50
  ) {
    return this.orderService.getOrders(user, { status, side, orderType, isManual, limit });
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

  @Post('preview')
  @ApiOperation({ summary: 'Preview an order to calculate fees and validate parameters' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order preview with fee calculations and validation',
    type: OrderPreviewDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid order data or exchange connection error'
  })
  async previewOrder(@Body() orderDto: OrderDto, @GetUser() user: User) {
    console.log('Previewing order:', orderDto);
    return this.orderService.previewOrder(orderDto, user);
  }

  @Post('manual')
  @ApiOperation({
    summary: 'Place a manual order on the exchange',
    description:
      'Create and execute a manual order with support for 7 order types: Market, Limit, Stop Loss, Stop Limit, Trailing Stop, Take Profit, and OCO'
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Manual order created successfully',
    type: OrderResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid order parameters or validation failed'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Exchange key not found'
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Exchange API unavailable'
  })
  async placeManualOrder(@Body() dto: PlaceManualOrderDto, @GetUser() user: User) {
    return this.orderService.placeManualOrder(dto, user);
  }

  @Post('manual/preview')
  @ApiOperation({
    summary: 'Preview a manual order to calculate costs and warnings',
    description: 'Get cost estimates, fee calculations, and validation warnings before placing an order'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order preview with cost breakdown and warnings',
    type: OrderPreviewDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid order parameters'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Exchange key or trading pair not found'
  })
  async previewManualOrder(@Body() dto: OrderPreviewRequestDto, @GetUser() user: User) {
    return this.orderService.previewManualOrder(dto, user);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Cancel an open order',
    description:
      'Cancel an open or partially filled order on the exchange. For OCO orders, both linked orders will be canceled.'
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the order to cancel',
    type: String
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order canceled successfully',
    type: OrderResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Order not found'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Order cannot be canceled (already filled, canceled, rejected, or expired)'
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User does not own this order'
  })
  async cancelOrder(@Param('id', new ParseUUIDPipe()) id: string, @GetUser() user: User) {
    return this.orderService.cancelManualOrder(id, user);
  }
}
