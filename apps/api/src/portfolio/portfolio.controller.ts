import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DeleteResult } from 'typeorm';

import { CreatePortfolioDto, UpdatePortfolioDto } from './dto';
import { Portfolio } from './portfolio.entity';
import { PortfolioService } from './portfolio.service';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import RequestWithUser from '../authentication/interface/requestWithUser.interface';
import FindOneParams from '../utils/findOneParams';

@ApiTags('Portfolio')
@ApiBearerAuth('token')
@ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get()
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({
    summary: 'Get all portfolio items',
    description: 'This endpoint is used to get all portfolio items.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'The portfolio items records', type: Portfolio, isArray: true })
  async getPortfolio(@Req() { user }: RequestWithUser) {
    return this.portfolio.getPortfolioByUser(user);
  }

  @Get(':id')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({
    summary: 'Get portfolio item by id',
    description: 'This endpoint is used to get a portfolio item by id.'
  })
  @ApiParam({ name: 'id', required: true, description: 'The id of the portfolio item', type: String })
  @ApiResponse({ status: HttpStatus.OK, description: 'The portfolio item record', type: Portfolio, isArray: false })
  getPortfolioById(@Param() { id }: FindOneParams, @Req() { user }: RequestWithUser) {
    return this.portfolio.getPortfolioById(id, user.id);
  }

  @Post()
  @UseGuards(JwtAuthenticationGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'Create portfolio item', description: 'This endpoint is used to create a portfolio item.' })
  @ApiBody({ type: CreatePortfolioDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The portfolio item has been successfully created.',
    type: Portfolio
  })
  async createPortfolioItem(@Body() dto: CreatePortfolioDto, @Req() { user }: RequestWithUser) {
    return this.portfolio.createPortfolioItem(dto, user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({ summary: 'Update portfolio item', description: 'This endpoint is used to update a portfolio item.' })
  @ApiParam({ name: 'id', required: true, description: 'The id of the portfolio item', type: String })
  @ApiBody({ type: UpdatePortfolioDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The portfolio item has been successfully updated.',
    type: Portfolio
  })
  async updatePortfolioItem(
    @Param() { id }: FindOneParams,
    @Body() dto: UpdatePortfolioDto,
    @Req() { user }: RequestWithUser
  ) {
    return this.portfolio.updatePortfolioItem(id, user.id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({ summary: 'Delete portfolio item', description: 'This endpoint is used to delete a portfolio item.' })
  @ApiParam({ name: 'id', required: true, description: 'The id of the portfolio item', type: String })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The portfolio item has been successfully deleted.',
    type: DeleteResult
  })
  async deletePortfolioItem(@Param() { id }: FindOneParams, @Req() { user }: RequestWithUser) {
    return this.portfolio.deletePortfolioItem(id, user.id);
  }
}
