import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  registerDecorator,
} from 'class-validator';

export enum FileUploadPurpose {
  DriverLicense = 'driver-license',
}

@ValidatorConstraint()
class IsValidFileDataConstraint {
  validate(value: string, validationArguments: ValidationArguments) {
    if (!value || typeof value !== 'string') {
      return false;
    }

    const match = /^data:([^;,]+);base64,/.exec(value);
    const mime = match?.[1]?.toLowerCase();
    const payload = validationArguments.object as FileUploadDTO;
    const allowedMimeTypes = ['image/png', 'image/jpeg'];

    if (payload.purpose === FileUploadPurpose.DriverLicense) {
      allowedMimeTypes.push('application/pdf');
    }

    return Boolean(mime && allowedMimeTypes.includes(mime));
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

  @IsEnum(FileUploadPurpose)
  @IsOptional()
  purpose?: FileUploadPurpose;
}
