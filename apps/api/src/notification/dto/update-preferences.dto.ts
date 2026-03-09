import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsObject, IsOptional, Max, Min, ValidateNested } from 'class-validator';

class ChannelPreferencesDto {
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @IsOptional()
  @IsBoolean()
  sms?: boolean;
}

class QuietHoursDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  startHourUtc?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  endHourUtc?: number;
}

export class UpdatePreferencesDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ChannelPreferencesDto)
  channels?: ChannelPreferencesDto;

  @IsOptional()
  @IsObject()
  events?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quietHours?: QuietHoursDto;
}
