import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CoinSelectionType } from './coin-selection-type.enum';
import { CoinSelectionRelations } from './coin-selection.entity';
import { CoinSelectionService } from './coin-selection.service';
import { CoinSelectionResponseDto, CreateCoinSelectionDto, UpdateCoinSelectionDto } from './dto';

import GetUser from '../authentication/decorator/get-user.decorator';
import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
import { User } from '../users/users.entity';

@ApiTags('Coin Selection')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
@Controller('coin-selections')
export class CoinSelectionController {
  constructor(private readonly coinSelection: CoinSelectionService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all coin selection items',
    description: 'Retrieves all coin selection items belonging to the authenticated user.'
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: CoinSelectionType,
    description: 'Filter coin selection items by type (MANUAL or AUTOMATIC)',
    example: CoinSelectionType.MANUAL
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of coin selection items retrieved successfully.',
    type: [CoinSelectionResponseDto]
  })
  async getCoinSelections(
    @GetUser() user: User,
    @Query('type', new ParseEnumPipe(CoinSelectionType, { optional: true })) type?: CoinSelectionType
  ) {
    return this.coinSelection.getCoinSelectionsByUser(user, [CoinSelectionRelations.COIN], type);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get coin selection item by ID',
    description: 'Retrieves a specific coin selection item by its ID for the authenticated user.'
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the coin selection item',
    type: String,
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Coin selection item retrieved successfully.',
    type: CoinSelectionResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Coin selection item not found.'
  })
  getCoinSelectionById(@Param('id', new ParseUUIDPipe()) id: string, @GetUser() user: User) {
    return this.coinSelection.getCoinSelectionById(id, user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create coin selection item',
    description: 'Creates a new coin selection item for the authenticated user.'
  })
  @ApiBody({
    type: CreateCoinSelectionDto,
    description: 'Data required to create a new coin selection item.'
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Coin selection item created successfully.',
    type: CoinSelectionResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid data provided.'
  })
  async createCoinSelectionItem(@Body() dto: CreateCoinSelectionDto, @GetUser() user: User) {
    return this.coinSelection.createCoinSelectionItem(dto, user);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update coin selection item',
    description: 'Updates an existing coin selection item by its ID for the authenticated user.'
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the coin selection item to update',
    type: String,
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @ApiBody({
    type: UpdateCoinSelectionDto,
    description: 'Data required to update the coin selection item.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Coin selection item updated successfully.',
    type: CoinSelectionResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Coin selection item not found.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid data provided.'
  })
  async updateCoinSelectionItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCoinSelectionDto,
    @GetUser() user: User
  ) {
    return this.coinSelection.updateCoinSelectionItem(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete coin selection item',
    description: 'Deletes a coin selection item by its ID for the authenticated user.'
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the coin selection item to delete',
    type: String,
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Coin selection item deleted successfully.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Coin selection item not found.'
  })
  async deleteCoinSelectionItem(@Param('id', new ParseUUIDPipe()) id: string, @GetUser() user: User) {
    return this.coinSelection.deleteCoinSelectionItem(id, user.id);
  }
}
