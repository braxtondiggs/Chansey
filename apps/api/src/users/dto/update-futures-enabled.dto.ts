import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean } from 'class-validator';

/**
 * DTO for toggling futures trading on/off.
 */
export class UpdateFuturesEnabledDto {
  @ApiProperty({
    description: 'Whether to enable or disable futures trading',
    example: true
  })
  @IsBoolean()
  enabled: boolean;
}

/**
 * Response DTO for futures trading status.
 */
export class FuturesEnabledStatusDto {
  @ApiProperty({
    description: 'Whether futures trading is currently enabled',
    example: false
  })
  futuresEnabled: boolean;
}
