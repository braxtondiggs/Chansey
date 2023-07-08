import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { OrderService } from './order.service';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';

@ApiTags('Order')
@ApiBearerAuth('token')
@Controller('order')
export class OrderController {
  constructor(private readonly order: OrderService) {}

  @Get()
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({})
  async getOrders() {
    // return this.order.getOrders();
    return 'hello';
  }
}
