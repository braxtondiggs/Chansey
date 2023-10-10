import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChartConfiguration, ChartData } from 'chart.js';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { FastifyReply } from 'fastify';
import { DeleteResult } from 'typeorm';

import { Algorithm } from './algorithm.entity';
import { AlgorithmService } from './algorithm.service';
import { CreateAlgorithmDto, UpdateAlgorithmDto } from './dto';
import * as DynamicAlgorithmServices from './scripts';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import { TestnetSummary } from '../order/testnet/dto';
import { PriceService } from '../price/price.service';
import FindOneParams from '../utils/findOneParams';

@ApiTags('Algorithm')
@ApiBearerAuth('token')
@Controller('algorithm')
export class AlgorithmController {
  constructor(
    private readonly algorithm: AlgorithmService,
    private readonly moduleRef: ModuleRef,
    private readonly price: PriceService
  ) {}

  @Get()
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({
    summary: 'Get all algorithms',
    description: 'This endpoint is used to get all algorithms.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'The portfolio items records', type: Algorithm, isArray: true })
  async getAlgorithms() {
    return this.algorithm.getAlgorithms();
  }

  @Get(':id')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({
    summary: 'Get algorithm by id',
    description: 'This endpoint is used to get a algorithm by id.'
  })
  @ApiParam({ name: 'id', required: true, description: 'The id of the algorithm item', type: String })
  @ApiResponse({ status: HttpStatus.OK, description: 'The algorithm record', type: Algorithm, isArray: false })
  getAlgorithmById(@Param() { id }: FindOneParams) {
    return this.algorithm.getAlgorithmById(id);
  }

  @Post()
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({ summary: 'Create algorithm', description: 'This endpoint is used to create a algorithm.' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The algorithm record',
    type: Algorithm,
    isArray: false
  })
  @UsePipes(new ValidationPipe({ transform: true }))
  async createAlgorithm(@Body() dto: CreateAlgorithmDto) {
    return this.algorithm.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({ summary: 'Update algorithm by id', description: 'This endpoint is used to update a algorithm.' })
  @ApiParam({ name: 'id', required: true, description: 'The id of the algorithm item', type: String })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The algorithm record',
    type: Algorithm,
    isArray: false
  })
  async updateAlgorithm(@Param() { id }: FindOneParams, @Body() dto: UpdateAlgorithmDto) {
    return this.algorithm.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({ summary: 'Remove algorithm by id', description: 'This endpoint is used to remove a algorithm.' })
  @ApiParam({ name: 'id', required: true, description: 'The id of the algorithm item', type: String })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The algorithm record',
    type: DeleteResult,
    isArray: false
  })
  async removeAlgorithm(@Param() { id }: FindOneParams) {
    return this.algorithm.remove(id);
  }

  @Get('chart/:algorithmId/:coinId')
  @ApiParam({
    name: 'coinId',
    required: false,
    description: 'The id of the coin',
    type: String,
    example: '7a8a03ab-07fe-4c8a-9b5a-50fdfeb9828f'
  })
  @ApiParam({
    name: 'algorithmId',
    required: true,
    description: 'The id of the algorithm',
    type: String,
    example: '100c1721-7b0b-4d96-a18e-40904c0cc36b'
  })
  @ApiProduces('image/png')
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The algorithm chart',
    schema: {
      type: 'file',
      format: 'binary'
    }
  })
  async chart(@Param() { algorithmId, coinId = '7a8a03ab-07fe-4c8a-9b5a-50fdfeb9828f' }, @Res() res: FastifyReply) {
    const width = 800; //px
    const height = 800; //px
    const prices = await this.price.findAllByDay(coinId, TestnetSummary['90d']);
    const algorithms = await this.algorithm.getAlgorithmsForTesting();
    let data: ChartData;
    for (const cls of Object.values(DynamicAlgorithmServices)) {
      const provider = this.moduleRef.get(cls, { strict: false });
      const algorithm = algorithms.find(({ id }) => id === algorithmId);
      if (provider && algorithm && typeof provider.getChartData === 'function')
        data = provider?.getChartData(prices[coinId]);
    }

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
