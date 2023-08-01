import { Body, Controller, Delete, Get, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { DeleteResult } from 'typeorm';

import { AlgoIdParams, TestnetDto, TestnetSummaryDto } from './dto';
import { Testnet } from './testnet.entity';
import { TestnetService } from './testnet.service';
import { APIAuthenticationGuard } from '../../authentication/guard/api-authentication.guard';
import FindOneParams from '../../utils/findOneParams';
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
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The test buy order has been successfully created.',
    type: Testnet
  })
  async createTestBuyOrder(@Body() dto: TestnetDto) {
    return this.testnet.createOrder(OrderSide.BUY, dto);
  }

  @Post('sell')
  @ApiOperation({
    summary: 'Create a test sell order',
    description: 'This endpoint is used to create a test sell order. It will not be executed on the exchange.'
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The test sell order has been successfully created.',
    type: Testnet
  })
  async createTestSellOrder(@Body() dto: TestnetDto) {
    return this.testnet.createOrder(OrderSide.SELL, dto);
  }

  @Get('orders')
  @ApiOperation({
    summary: 'Get test orders',
    description: 'This endpoint is used to get all test orders.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'The test order records', type: Testnet, isArray: true })
  async getTestOrders() {
    return this.testnet.getOrders();
  }

  @Get('orders/:id')
  @ApiOperation({
    summary: 'Get test order',
    description: 'This endpoint is used to get a test order.'
  })
  @ApiParam({ name: 'id', required: true, description: 'The id of the test order', type: String })
  @ApiResponse({ status: HttpStatus.OK, description: 'The test order record', type: Testnet, isArray: false })
  async getTestOrder(@Param() { id }: FindOneParams) {
    return this.testnet.getOrder(id);
  }

  @Get('summary/:duration')
  @Get('summary')
  @ApiOperation({
    summary: 'Get test order summary',
    description: 'This endpoint is used to get a test  order summary.'
  })
  async getTestOrderSummary(@Param() { duration }: TestnetSummaryDto) {
    return this.testnet.getOrderSummary(duration);
  }

  @Delete('orders/:algoId')
  @ApiOperation({
    summary: 'Delete test orders by algoId',
    description: 'This endpoint is used to delete test orders by algoId.'
  })
  @ApiParam({ name: 'algoId', required: true, description: 'The algoId of the test orders', type: String })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The test orders have been successfully deleted.',
    type: DeleteResult
  })
  async deleteTestOrders(@Param() { algoId }: AlgoIdParams) {
    return this.testnet.deleteOrders(algoId);
  }
}
