/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { CATCH_ERROR_KEY } from '../decorators';

@Injectable()
export class ErrorInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: Logger,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const shouldCatch = this.reflector.get<boolean>(
      CATCH_ERROR_KEY,
      context.getHandler(),
    );

    if (!shouldCatch) {
      return next.handle();
    }

    const className = context.getClass().name;
    const methodName = context.getHandler().name;

    return next.handle().pipe(
      catchError((error) => {
        this.logger.log(error, `${className}.${methodName}`);
        return throwError(() => error);
      }),
    );
  }
}
