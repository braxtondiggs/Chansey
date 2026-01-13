import { ApiProperty } from '@nestjs/swagger';

import { IsDateString, IsUUID, registerDecorator, ValidationOptions } from 'class-validator';

/** Maximum allowed date range in days */
const MAX_DATE_RANGE_DAYS = 365;

/**
 * Custom validator to ensure end date is after start date
 */
function IsAfterStartDate(property: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isAfterStartDate',
      target: object.constructor,
      propertyName: propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: string, args) {
          const [relatedPropertyName] = args.constraints;
          const startValue = (args.object as Record<string, string>)[relatedPropertyName];
          if (!startValue || !value) return true;
          return new Date(value) > new Date(startValue);
        },
        defaultMessage() {
          return 'End date must be after start date';
        }
      }
    });
  };
}

/**
 * Custom validator to prevent future dates
 */
function IsNotFutureDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotFutureDate',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: string) {
          if (!value) return true;
          return new Date(value) <= new Date();
        },
        defaultMessage() {
          return 'Date cannot be in the future';
        }
      }
    });
  };
}

/**
 * Custom validator to ensure date range doesn't exceed maximum
 */
function IsWithinMaxDateRange(startProperty: string, maxDays: number, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isWithinMaxDateRange',
      target: object.constructor,
      propertyName: propertyName,
      constraints: [startProperty, maxDays],
      options: validationOptions,
      validator: {
        validate(value: string, args) {
          const [relatedPropertyName, maxDaysAllowed] = args.constraints;
          const startValue = (args.object as Record<string, string>)[relatedPropertyName];
          if (!startValue || !value) return true;
          const diffMs = new Date(value).getTime() - new Date(startValue).getTime();
          const diffDays = diffMs / (1000 * 60 * 60 * 24);
          return diffDays <= maxDaysAllowed;
        },
        defaultMessage(args) {
          return `Date range cannot exceed ${args.constraints[1]} days`;
        }
      }
    });
  };
}

/**
 * DTO for validating coinId path parameter
 */
export class CoinIdParamDto {
  @ApiProperty({
    description: 'Coin UUID',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @IsUUID('4')
  coinId: string;
}

/**
 * DTO for validating candle query parameters
 */
export class GetCandlesQueryDto {
  @ApiProperty({
    description: 'Start date (ISO 8601 format)',
    example: '2024-01-01T00:00:00.000Z'
  })
  @IsDateString()
  start: string;

  @ApiProperty({
    description: 'End date (ISO 8601 format, max 365 days from start)',
    example: '2024-01-31T23:59:59.999Z'
  })
  @IsDateString()
  @IsAfterStartDate('start', { message: 'End date must be after start date' })
  @IsNotFutureDate({ message: 'End date cannot be in the future' })
  @IsWithinMaxDateRange('start', MAX_DATE_RANGE_DAYS, {
    message: `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`
  })
  end: string;
}
