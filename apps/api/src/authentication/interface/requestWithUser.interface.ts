import { FastifyRequest } from 'fastify';

import { User } from '../../users/users.entity';

interface RequestWithUser extends FastifyRequest {
  user: User;
}

export default RequestWithUser;
