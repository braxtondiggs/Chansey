import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DeleteResult } from 'typeorm';

import { CreateExchangeDto, UpdateExchangeDto } from './dto';
import { Exchange } from './exchange.entity';
import { ExchangeService } from './exchange.service';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import FindOneParams from '../utils/findOneParams';

@ApiTags('Exchange')
@Controller('exchange')
export class ExchangeController {
  constructor(private readonly exchange: ExchangeService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all exchanges',
    description: 'This endpoint is used to get all exchanges.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'The exchange items records', type: Exchange, isArray: true })
  async getExchanges() {
    return this.exchange.getExchanges();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get exchange item by id',
    description: 'This endpoint is used to get a exchange item by id.'
  })
  @ApiParam({ name: 'id', required: true, description: 'The id of the exchange item', type: String })
  @ApiResponse({ status: HttpStatus.OK, description: 'The exchange item record', type: Exchange, isArray: false })
  getExchangeById(@Param() { id }: FindOneParams) {
    return this.exchange.getExchangeById(id);
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'Create exchange item', description: 'This endpoint is used to create a exchange item.' })
  @ApiBody({ type: CreateExchangeDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The exchange item has been successfully created.',
    type: Exchange
  })
  async createExchangeItem(@Body() dto: CreateExchangeDto) {
    return this.exchange.createExchange(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({ summary: 'Update exchange item', description: 'This endpoint is used to update a exchange item.' })
  @ApiParam({ name: 'id', required: true, description: 'The id of the exchange item', type: String })
  @ApiBody({ type: UpdateExchangeDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The exchange item has been successfully updated.',
    type: Exchange
  })
  async updateExchangeItem(@Param() { id }: FindOneParams, @Body() dto: UpdateExchangeDto) {
    return this.exchange.updateExchange(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({ summary: 'Delete exchange item', description: 'This endpoint is used to delete a exchange item.' })
  @ApiParam({ name: 'id', required: true, description: 'The id of the exchange item', type: String })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The exchange item has been successfully deleted.',
    type: DeleteResult
  })
  async deleteExchangeItem(@Param() { id }: FindOneParams) {
    return this.exchange.deleteExchange(id);
  }
}
