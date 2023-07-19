import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpStatus,
  Patch,
  Req,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';

import { UpdateUserDto } from './dto/update-user.dto';
import User from './users.entity';
import UsersService from './users.service';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import RequestWithUser from '../authentication/interface/requestWithUser.interface';

@ApiTags('User')
@ApiResponse({
  status: HttpStatus.UNAUTHORIZED,
  description: 'Invalid credentials'
})
@ApiBearerAuth('token')
@Controller('user')
@UseInterceptors(ClassSerializerInterceptor)
export class UserController {
  constructor(private readonly user: UsersService) {}

  @Patch()
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({
    summary: 'Update user',
    description: 'This endpoint is used to update the user.'
  })
  @ApiOkResponse({
    description: 'The user has been successfully updated.',
    type: User,
    isArray: false
  })
  async updateUser(@Body() dto: UpdateUserDto, @Req() { user }: RequestWithUser) {
    return this.user.update(dto, user);
  }

  @UseGuards(JwtAuthenticationGuard)
  @Get()
  @ApiOperation({
    summary: 'Get basic user info',
    description: 'This endpoint is used to get the user.'
  })
  @ApiOkResponse({
    description: 'The user records',
    type: User,
    isArray: false
  })
  get(@Req() { user }: RequestWithUser) {
    return user;
  }

  @UseGuards(JwtAuthenticationGuard)
  @Get('info')
  @ApiOperation({
    summary: 'Get detailed user info',
    description: 'This endpoint is used to get the user.'
  })
  info(@Req() { user }: RequestWithUser) {
    return this.user.getBinanceInfo(user);
  }
}
