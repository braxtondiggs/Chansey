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
  Res,
  UseGuards
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags
} from '@nestjs/swagger';
import { ChartConfiguration, ChartData } from 'chart.js';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { FastifyReply } from 'fastify';

import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import { TestnetSummary } from '../order/testnet/dto';
import { PriceService } from '../price/price.service';
import { AlgorithmService } from './algorithm.service';
import {
  AlgorithmResponseDto,
  CreateAlgorithmDto,
  DeleteResponseDto,
  UpdateAlgorithmDto
} from './dto';
import * as DynamicAlgorithmServices from './scripts';

@ApiTags('Algorithm')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@Controller('algorithm')
export class AlgorithmController {
  constructor(
    private readonly algorithm: AlgorithmService,
    private readonly moduleRef: ModuleRef,
    private readonly price: PriceService
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get all algorithms',
    description: 'Retrieve a list of all available algorithms.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of algorithms retrieved successfully.',
    type: AlgorithmResponseDto,
    isArray: true
  })
  async getAlgorithms() {
    return this.algorithm.getAlgorithms();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get algorithm by ID',
    description: 'Retrieve a single algorithm by its unique identifier.'
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the algorithm',
    type: String,
    example: '100c1721-7b0b-4d96-a18e-40904c0cc36b'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Algorithm retrieved successfully.',
    type: AlgorithmResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Algorithm not found.'
  })
  getAlgorithmById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.algorithm.getAlgorithmById(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new algorithm',
    description: 'Create a new algorithm with the provided details.'
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Algorithm created successfully.',
    type: AlgorithmResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data.'
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Algorithm with the same name already exists.'
  })
  async createAlgorithm(@Body() dto: CreateAlgorithmDto) {
    return this.algorithm.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update an algorithm',
    description: 'Update the details of an existing algorithm by its ID.'
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the algorithm to update',
    type: String,
    example: '100c1721-7b0b-4d96-a18e-40904c0cc36b'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Algorithm updated successfully.',
    type: AlgorithmResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Algorithm not found.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data.'
  })
  async updateAlgorithm(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAlgorithmDto
  ) {
    return this.algorithm.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete an algorithm',
    description: 'Remove an existing algorithm by its ID.'
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the algorithm to delete',
    type: String,
    example: '100c1721-7b0b-4d96-a18e-40904c0cc36b'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Algorithm deleted successfully.',
    type: DeleteResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Algorithm not found.'
  })
  async removeAlgorithm(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.algorithm.remove(id);
  }

  @Get('chart/:algorithmId/:coinId')
  @ApiOperation({
    summary: 'Generate algorithm chart',
    description: 'Generate a chart image for a specific algorithm and coin.'
  })
  @ApiParam({
    name: 'algorithmId',
    required: true,
    description: 'UUID of the algorithm',
    type: String,
    example: '100c1721-7b0b-4d96-a18e-40904c0cc36b'
  })
  @ApiParam({
    name: 'coinId',
    required: true,
    description: 'UUID of the coin',
    type: String,
    example: '7a8a03ab-07fe-4c8a-9b5a-50fdfeb9828f'
  })
  @ApiProduces('image/png')
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Algorithm chart generated successfully.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Algorithm or Coin not found.'
  })
  async chart(
    @Param() { algorithmId, coinId = '7a8a03ab-07fe-4c8a-9b5a-50fdfeb9828f' },
    @Res() res: FastifyReply
  ) {
    const width = 800; //px
    const height = 800; //px
    const prices = await this.price.findAllByDay(coinId, TestnetSummary['90d']);
    const algorithms = await this.algorithm.getAlgorithmsForTesting();
    const algorithm = algorithms.find(({ id }) => id === algorithmId);
    const provider = this.moduleRef.get(algorithm.service, { strict: false });
    let data: ChartData;

    if (provider && algorithm) data = provider?.getChartData?.(prices[coinId]);

    const configuration: ChartConfiguration = {
      type: 'line',
      options: {
        elements: {
          point: {
            radius: 0
          }
        }
      },
      data
    };
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });
    const image = await chartJSNodeCanvas.renderToBuffer(configuration);
    res.header('Content-Type', 'image/png');
    res.send(image);
  }
}
