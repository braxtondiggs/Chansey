import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { OrderBinanceResponseDto, OrderDto, OrderResponseDto } from './dto';
import { OrderService } from './order.service';

import GetUser from '../authentication/decorator/get-user.decorator';
import { Roles } from '../authentication/decorator/roles.decorator';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import { RolesGuard } from '../authentication/guard/roles.guard';
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
    type: [OrderResponseDto]
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
    type: OrderResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Order not found.'
  })
  getOrder(@Param('id', new ParseUUIDPipe()) id: string, @GetUser() user: User) {
    return this.order.getOrder(user, id);
  }

  @Get('open')
  @ApiOperation({ summary: 'Retrieve all open orders' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of all open orders for the user.',
    type: [OrderResponseDto]
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
    return this.order.createBuyOrder(dto, user);
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
    return this.order.createSellOrder(dto, user);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Synchronize orders from connected exchanges' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Orders have been synchronized successfully.',
    schema: {
      properties: {
        message: { type: 'string', example: 'Orders synchronized successfully' },
        count: { type: 'number', example: 5 }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Failed to synchronize orders.'
  })
  async syncOrders(@GetUser() user: User) {
    const count = await this.order.syncOrdersForUser(user);
    return {
      message: `Orders synchronized successfully. Found ${count} new orders.`,
      count
    };
  }

  @Post('sync/all')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Synchronize orders for all users (admin only)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Orders have been synchronized for all users successfully.',
    schema: {
      properties: {
        message: { type: 'string', example: 'Orders synchronized for all users successfully' },
        count: { type: 'number', example: 25 }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Access denied. Admin role required.'
  })
  async syncAllOrders() {
    const count = await this.order.syncOrdersForAllUsers();
    return {
      message: `Orders synchronized for all users successfully. Found ${count} new orders.`,
      count
    };
  }

  @Get('sync/status')
  @ApiOperation({ summary: 'Get order synchronization status' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order synchronization status retrieved successfully.',
    schema: {
      properties: {
        totalOrders: { type: 'number', example: 25 },
        ordersByStatus: {
          type: 'object',
          example: {
            FILLED: 20,
            CANCELED: 3,
            NEW: 2
          }
        },
        lastSyncTime: { type: 'string', format: 'date-time', example: '2025-05-16T10:30:00Z' },
        hasActiveExchangeKeys: { type: 'boolean', example: true }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Failed to retrieve synchronization status.'
  })
  async getSyncStatus(@GetUser() user: User) {
    return this.order.getSyncStatus(user);
  }
}
