import {
  IsNotEmpty,
  IsString,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  registerDecorator,
} from 'class-validator';

@ValidatorConstraint()
class IsValidFileDataConstraint {
  validate(value: string) {
    if (!value || typeof value !== 'string') {
      return false;
    }

    const [mime] = value.split('data:').pop().split(';');

    return [
      'image/png',
      'image/jpeg',
      // 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // 'application/pdf',
      // 'text/csv',
    ].includes(mime);
  }

  defaultMessage(validationArguments?: ValidationArguments) {
    return `${validationArguments.property} must be a valid/supported file type`;
  }
}

const IsValidFileData =
  (validationOptions?: ValidationOptions) =>
  (object: unknown, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidFileDataConstraint,
    });
  };

export class FileUploadDTO {
  @IsString()
  @IsNotEmpty()
  filename: string;

  @IsValidFileData()
  @IsNotEmpty()
  data: string;
}
