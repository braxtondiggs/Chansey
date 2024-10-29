import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CreateExchangeDto, ExchangeResponseDto, UpdateExchangeDto } from './dto';
import { ExchangeService } from './exchange.service';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';

@ApiTags('Exchange')
@Controller('exchange')
export class ExchangeController {
  constructor(private readonly exchange: ExchangeService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all exchanges',
    description: 'Retrieves a list of all exchanges.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of exchange items retrieved successfully.',
    type: [ExchangeResponseDto]
  })
  async getExchanges() {
    return this.exchange.getExchanges();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get exchange by ID',
    description: 'Retrieves a specific exchange by its unique identifier.'
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the exchange item',
    type: String,
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Exchange item retrieved successfully.',
    type: ExchangeResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Exchange item not found.'
  })
  getExchangeById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.exchange.getExchangeById(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create exchange',
    description: 'Creates a new exchange.'
  })
  @ApiBody({
    type: CreateExchangeDto,
    description: 'Data required to create a new exchange.'
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Exchange item created successfully.',
    type: ExchangeResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid data provided.'
  })
  async createExchangeItem(@Body() dto: CreateExchangeDto) {
    return this.exchange.createExchange(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({
    summary: 'Update exchange',
    description: 'Updates an existing exchange by its unique identifier.'
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the exchange item to update',
    type: String,
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @ApiBody({
    type: UpdateExchangeDto,
    description: 'Data required to update the exchange.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Exchange item updated successfully.',
    type: ExchangeResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Exchange item not found.'
  })
  async updateExchangeItem(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateExchangeDto) {
    return this.exchange.updateExchange(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({
    summary: 'Delete exchange',
    description: 'Deletes an exchange by its unique identifier.'
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the exchange item to delete',
    type: String,
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Exchange item deleted successfully.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Exchange item not found.'
  })
  async deleteExchangeItem(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.exchange.deleteExchange(id);
  }
}
