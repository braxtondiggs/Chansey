import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class APIAuthenticationGuard extends AuthGuard('api-key') {}
