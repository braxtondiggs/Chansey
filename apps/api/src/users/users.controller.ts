import { AuthToken } from '@authorizerdev/authorizer-js';
import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { UpdateUserDto } from './dto/update-user.dto';
import User from './users.entity';
import UsersService from './users.service';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';

@ApiTags('User')
@ApiBearerAuth('token')
@Controller('user')
@UseInterceptors(ClassSerializerInterceptor)
export class UserController {
  constructor(private readonly user: UsersService) {}

  @Patch()
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({})
  async updateUser(@Body() dto: UpdateUserDto, @Req() { user }: { user: User }) {
    return this.user.update(dto, user);
  }

  @UseGuards(JwtAuthenticationGuard)
  @Get()
  @ApiOperation({})
  @ApiOkResponse({
    description: 'The user records',
    type: User,
    isArray: false
  })
  authenticate(@Req() { user }: AuthToken) {
    return new User(user);
  }
}
