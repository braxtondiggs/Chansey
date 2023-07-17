import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

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
  @ApiOperation({})
  async getAlgorithms() {
    return this.algorithm.getAlgorithms();
  }

  @Get(':id')
  @UseGuards(JwtAuthenticationGuard)
  getAlgorithmById(@Param() { id }: FindOneParams) {
    return this.algorithm.getAlgorithmById(id);
  }

  @Post()
  @UseGuards(JwtAuthenticationGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async createAlgorithm(@Body() dto: CreateAlgorithmDto) {
    return this.algorithm.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthenticationGuard)
  async updateAlgorithm(@Param() { id }: FindOneParams, @Body() dto: UpdateAlgorithmDto) {
    return this.algorithm.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthenticationGuard)
  async removeAlgorithm(@Param() { id }: FindOneParams) {
    return this.algorithm.remove(id);
  }
}
