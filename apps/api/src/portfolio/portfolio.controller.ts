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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CreatePortfolioDto, PortfolioResponseDto, UpdatePortfolioDto } from './dto';
import { PortfolioService } from './portfolio.service';
import GetUser from '../authentication/decorator/get-user.decorator';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import { User } from '../users/users.entity';

@ApiTags('Portfolio')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all portfolio items',
    description: 'Retrieves all portfolio items belonging to the authenticated user.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of portfolio items retrieved successfully.',
    type: [PortfolioResponseDto]
  })
  async getPortfolio(@GetUser() user: User) {
    return this.portfolio.getPortfolioByUser(user);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get portfolio item by ID',
    description: 'Retrieves a specific portfolio item by its ID for the authenticated user.'
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the portfolio item',
    type: String,
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Portfolio item retrieved successfully.',
    type: PortfolioResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Portfolio item not found.'
  })
  getPortfolioById(@Param('id', new ParseUUIDPipe()) id: string, @GetUser() user: User) {
    return this.portfolio.getPortfolioById(id, user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create portfolio item',
    description: 'Creates a new portfolio item for the authenticated user.'
  })
  @ApiBody({
    type: CreatePortfolioDto,
    description: 'Data required to create a new portfolio item.'
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Portfolio item created successfully.',
    type: PortfolioResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid data provided.'
  })
  async createPortfolioItem(@Body() dto: CreatePortfolioDto, @GetUser() user: User) {
    return this.portfolio.createPortfolioItem(dto, user);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update portfolio item',
    description: 'Updates an existing portfolio item by its ID for the authenticated user.'
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the portfolio item to update',
    type: String,
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @ApiBody({
    type: UpdatePortfolioDto,
    description: 'Data required to update the portfolio item.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Portfolio item updated successfully.',
    type: PortfolioResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Portfolio item not found.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid data provided.'
  })
  async updatePortfolioItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePortfolioDto,
    @GetUser() user: User
  ) {
    return this.portfolio.updatePortfolioItem(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete portfolio item',
    description: 'Deletes a portfolio item by its ID for the authenticated user.'
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the portfolio item to delete',
    type: String,
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Portfolio item deleted successfully.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Portfolio item not found.'
  })
  async deletePortfolioItem(@Param('id', new ParseUUIDPipe()) id: string, @GetUser() user: User) {
    return this.portfolio.deletePortfolioItem(id, user.id);
  }
}
