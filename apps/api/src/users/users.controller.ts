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
import UsersService from './users.service';
import GetUser from '../authentication/decorator/get-user.decorator';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';

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
  constructor(private readonly user: UsersService) {}

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
    summary: 'Get basic user info',
    description: 'Retrieves basic information about the authenticated user.'
  })
  @ApiOkResponse({
    description: 'Basic user information retrieved successfully.',
    type: UserResponseDto
  })
  get(@GetUser() user: User) {
    return user;
  }

  @Get('info')
  @ApiOperation({
    summary: 'Get detailed user info',
    description: 'Retrieves detailed information about the authenticated user.'
  })
  @ApiOkResponse({
    description: 'Detailed user information retrieved successfully.',
    type: UserResponseDto
  })
  info(@GetUser() user: User) {
    return this.user.getBinanceInfo(user);
  }
}
