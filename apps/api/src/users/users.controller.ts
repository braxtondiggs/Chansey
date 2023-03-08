import { Body, Controller, Patch, Req, UseGuards } from '@nestjs/common';

import { UpdateUserDto } from './dto/update-user.dto';
import UsersService from './users.service';
import JwtAuthenticationGuard from '../authentication/jwt-authentication.guard';
import RequestWithUser from '../authentication/requestWithUser.interface';

@Controller('user')
export class UserController {
  constructor(private readonly user: UsersService) {}

  @Patch()
  @UseGuards(JwtAuthenticationGuard)
  async updateUser(@Body() dto: UpdateUserDto, @Req() { user }: RequestWithUser) {
    return this.user.updateUser(dto, user);
  }
}
