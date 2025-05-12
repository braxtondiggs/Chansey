import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpStatus,
  Patch,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { UpdateUserDto, UserResponseDto } from './dto';
import { User } from './users.entity';
import { UsersService } from './users.service';

import GetUser from '../authentication/decorator/get-user.decorator';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import { BinanceUSService } from '../exchange/binance/binance-us.service';

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
    private readonly binance: BinanceUSService,
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

      return userWithProfile;
    } catch (error) {
      console.error('Error fetching complete user profile:', error);
      // Fall back to the basic user data if Authorizer fetch fails
      return user;
    }
  }
}
