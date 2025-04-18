import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  ValidationPipe
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { DeleteResult } from 'typeorm';

import { TestnetDto, TestnetSummaryDto } from './dto';
import { Testnet } from './testnet.entity';
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
    description: 'Creates a simulated buy order without actual execution on the exchange'
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: Testnet })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid order parameters' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized access' })
  async createTestBuyOrder(@Body(new ValidationPipe({ transform: true })) dto: TestnetDto) {
    return this.testnet.createOrder(OrderSide.BUY, dto);
  }

  @Post('sell')
  @ApiOperation({
    summary: 'Create a test sell order',
    description: 'Creates a simulated sell order without actual execution on the exchange'
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: Testnet })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid order parameters' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized access' })
  async createTestSellOrder(@Body(new ValidationPipe({ transform: true })) dto: TestnetDto) {
    return this.testnet.createOrder(OrderSide.SELL, dto);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Get all test orders' })
  @ApiResponse({ status: HttpStatus.OK, type: [Testnet] })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized access' })
  async getTestOrders() {
    return this.testnet.getOrders();
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Get a specific test order' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: Testnet })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Order not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized access' })
  async getTestOrder(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.testnet.getOrder(id);
  }

  @Get('summary/:duration?')
  @ApiOperation({ summary: 'Get test order summary' })
  @ApiParam({ name: 'duration', required: false, enum: ['1h', '1d', '7d', '30d'] })
  @ApiResponse({ status: HttpStatus.OK, description: 'Summary of test orders' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid duration parameter' })
  async getTestOrderSummary(@Param(new ValidationPipe({ transform: true })) params: TestnetSummaryDto) {
    return this.testnet.getOrderSummary(params.duration);
  }

  @Delete('orders/:algoId')
  @ApiOperation({ summary: 'Delete test orders by algorithm ID' })
  @ApiParam({ name: 'algoId', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: DeleteResult })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No orders found for algorithm' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized access' })
  async deleteTestOrders(@Param('algoId', new ParseUUIDPipe({ version: '4' })) algoId: string) {
    return this.testnet.deleteOrders(algoId);
  }
}
