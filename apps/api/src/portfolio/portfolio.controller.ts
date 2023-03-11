import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CreatePortfolioDto, UpdatePortfolioDto } from './dto';
import { PortfolioService } from './portfolio.service';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import RequestWithUser from '../authentication/interface/requestWithUser.interface';
import FindOneParams from '../utils/findOneParams';

@ApiTags('Portfolio')
@ApiBearerAuth('token')
@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get()
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({})
  async getPortfolio(@Req() { user }: RequestWithUser) {
    return this.portfolio.getPortfolioByUser(user);
  }

  @Get(':id')
  @UseGuards(JwtAuthenticationGuard)
  getPortfolioById(@Param() { id }: FindOneParams, @Req() { user }: RequestWithUser) {
    return this.portfolio.getPortfolioById(id, user.id);
  }

  @Post()
  @UseGuards(JwtAuthenticationGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async createPortfolioItem(@Body() dto: CreatePortfolioDto, @Req() { user }: RequestWithUser) {
    return this.portfolio.createPortfolioItem(dto, user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthenticationGuard)
  async updatePortfolioItem(
    @Param() { id }: FindOneParams,
    @Body() dto: UpdatePortfolioDto,
    @Req() { user }: RequestWithUser
  ) {
    return this.portfolio.updatePortfolioItem(id, user.id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthenticationGuard)
  async deletePortfolioItem(@Param() { id }: FindOneParams, @Req() { user }: RequestWithUser) {
    return this.portfolio.deletePortfolioItem(id, user.id);
  }
}
