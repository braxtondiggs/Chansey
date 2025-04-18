import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpStatus,
  Patch,
  Query,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { BalanceDto, UpdateUserDto, UserBinanceResponseDto, UserResponseDto } from './dto';
import { User } from './users.entity';
import { UsersService } from './users.service';

import GetUser from '../authentication/decorator/get-user.decorator';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import { BinanceService } from '../exchange/binance/binance.service';

@ApiTags('User')
@ApiBearerAuth('token')
@ApiResponse({
  status: HttpStatus.UNAUTHORIZED,
  description: 'Invalid credentials'
})
@Controller('user')
@UseGuards(JwtAuthenticationGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class UserController {
  constructor(
    private readonly binance: BinanceService,
    private readonly user: UsersService
  ) {}

  @Patch()
  @ApiOperation({
    summary: 'Update user',
    description: "Updates the authenticated user's information."
  })
  @ApiOkResponse({
    description: 'The user has been successfully updated.',
    type: UserResponseDto
  })
  async updateUser(@Body() dto: UpdateUserDto, @GetUser() user: User) {
    return this.user.update(dto, user);
  }

  @Get()
  @ApiOperation({
    summary: 'Get user info with Authorizer profile',
    description: 'Retrieves information about the authenticated user, including Authorizer profile information.'
  })
  @ApiOkResponse({
    description: 'User information retrieved successfully.',
    type: UserResponseDto
  })
  async get(@GetUser() user: User) {
    // Get a fresh copy of the user profile from Authorizer
    try {
      // Get user with full Authorizer profile
      const userWithProfile = await this.user.getWithAuthorizerProfile(user);

      // Remove sensitive data
      delete userWithProfile.binance;
      delete userWithProfile.binanceSecret;

      return userWithProfile;
    } catch (error) {
      console.error('Error fetching complete user profile:', error);
      // Fall back to the basic user data if Authorizer fetch fails
      return user;
    }
  }

  @Get('/binance/info')
  @ApiOperation({
    summary: 'Get detailed user info from binance',
    description: 'Retrieves detailed information about the authenticated user.'
  })
  @ApiOkResponse({
    description: 'Detailed user information retrieved successfully.',
    type: UserBinanceResponseDto
  })
  info(@GetUser() user: User) {
    return this.binance.getBinanceAccountInfo(user);
  }

  @Get('/balance')
  @ApiOperation({
    summary: 'Get user balance',
    description: 'Retrieves the balance of the authenticated user. Use type=all to get all non-zero balances.'
  })
  @ApiOkResponse({
    description: 'User balance retrieved successfully.',
    type: BalanceDto
  })
  @ApiQuery({
    name: 'type',
    description: 'The type of balance to retrieve.',
    enum: ['BTC', 'ALL'],
    required: false
  })
  balance(@GetUser() user: User, @Query('type') type = 'ALL') {
    return this.binance.getBalance(user, type);
  }
}
