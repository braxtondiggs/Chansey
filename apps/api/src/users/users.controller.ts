import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { UpdateUserDto } from './dto/update-user.dto';
import User from './users.entity';
import UsersService from './users.service';
import JwtAuthenticationGuard from '../authentication/jwt-authentication.guard';
import RequestWithUser from '../authentication/requestWithUser.interface';

@ApiTags('User')
@ApiBearerAuth('token')
@Controller('user')
export class UserController {
  constructor(private readonly user: UsersService) {}

  @Patch()
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({})
  async updateUser(@Body() dto: UpdateUserDto, @Req() { user }: RequestWithUser) {
    return this.user.updateUser(dto, user);
  }

  @UseGuards(JwtAuthenticationGuard)
  @Get()
  @ApiOperation({})
  @ApiOkResponse({
    description: 'The user records',
    type: User,
    isArray: false
  })
  authenticate(@Req() request: RequestWithUser) {
    return request.user;
  }
}
