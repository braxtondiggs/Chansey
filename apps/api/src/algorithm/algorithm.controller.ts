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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DeleteResult } from 'typeorm';

import { Algorithm } from './algorithm.entity';
import { AlgorithmService } from './algorithm.service';
import { CreateAlgorithmDto, UpdateAlgorithmDto } from './dto';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import FindOneParams from '../utils/findOneParams';

@ApiTags('Algorithm')
@ApiBearerAuth('token')
@Controller('algorithm')
export class AlgorithmController {
  constructor(private readonly algorithm: AlgorithmService) {}

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
}
