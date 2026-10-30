import { ValidationError, ValidationPipe } from '@nestjs/common';
import { AppError, ErrorCode } from './app-error';
import { HttpStatus } from '@nestjs/common';

function flatten(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {});
    return [
      ...own.map((message) =>
        message.startsWith(error.property)
          ? message.replace(error.property, path)
          : `${path}: ${message}`,
      ),
      ...flatten(error.children ?? [], path),
    ];
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        HttpStatus.BAD_REQUEST,
        flatten(errors),
      ),
  });
}
