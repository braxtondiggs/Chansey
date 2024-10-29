import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import { User } from '../../users/users.entity';

const GetUser = createParamDecorator((data: unknown, ctx: ExecutionContext): User => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});

export default GetUser;
