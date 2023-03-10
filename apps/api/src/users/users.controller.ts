import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { UpdateUserDto } from './dto/update-user.dto';
import User from './users.entity';
import UsersService from './users.service';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import RequestWithUser from '../authentication/interface/requestWithUser.interface';

@ApiTags('User')
@ApiBearerAuth('token')
@Controller('user')
export class UserController {
  constructor(private readonly user: UsersService) {}

  @Patch()
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({})
  async updateUser(@Body() dto: UpdateUserDto) {
    return this.user.update(dto);
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
    delete request.user.password;
    return request.user;
  }
}
