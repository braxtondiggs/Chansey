import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PushSubscriptionDto {
  @IsNotEmpty()
  @IsString()
  endpoint: string;

  @IsNotEmpty()
  @IsString()
  p256dh: string;

  @IsNotEmpty()
  @IsString()
  auth: string;

  @IsOptional()
  @IsString()
  userAgent?: string;
}

export class PushUnsubscribeDto {
  @IsNotEmpty()
  @IsString()
  endpoint: string;
}
