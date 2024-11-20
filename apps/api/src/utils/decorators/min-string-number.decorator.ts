import { ValidationArguments, ValidationOptions, registerDecorator } from 'class-validator';

export function MinStringNumber(min: number, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'minStringNumber',
      target: object.constructor,
      propertyName: propertyName,
      constraints: [min],
      options: validationOptions,
      validator: {
        validate(value: string, args: ValidationArguments) {
          const [min] = args.constraints;
          const num = parseFloat(value);
          return !isNaN(num) && num >= min;
        },
        defaultMessage(args: ValidationArguments) {
          const [min] = args.constraints;
          return `${args.property} must be greater than or equal to ${min}`;
        }
      }
    });
  };
}
