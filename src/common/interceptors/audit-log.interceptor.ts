import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import {
  LOG_ACTIVITY_KEY,
  LogActivityOptions,
} from '../decorators/log-activity.decorator';
import { AuditLogService } from '../services/audit-log.service';

/** Keys whose values are always replaced with `[REDACTED]` in stored payloads. */
const SENSITIVE_KEYS = new Set([
  'password',
  'confirmPassword',
  'newPassword',
  'currentPassword',
  'token',
  'secret',
  'apiKey',
  'refreshToken',
]);

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogService: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<LogActivityOptions | undefined>(
      LOG_ACTIVITY_KEY,
      context.getHandler(),
    );

    // No @LogActivity decorator — pass straight through.
    if (!options) {
      return next.handle();
    }

    const request = context
      .switchToHttp()
      .getRequest<Record<string, any>>();

    return next.handle().pipe(
      tap(async (responseData: unknown) => {
        const payload =
          options.includeBody !== false
            ? this.sanitize({ ...request.body, ...request.params })
            : null;

        const result = options.includeResult
          ? this.sanitize(responseData)
          : null;

        await this.auditLogService.log({
          actorId: (request.user as any)?.id,
          organizationId: (request.user as any)?.organizationId ?? null,
          action: options.action,
          resource: options.resource,
          resourceId:
            request.params?.id ??
            request.params?.studentId ??
            request.params?.guardianId ??
            null,
          payload,
          result,
          ipAddress: request.ip ?? null,
        });
      }),
    );
  }

  private sanitize(data: unknown): Record<string, unknown> | null {
    if (data === null || data === undefined || typeof data !== 'object') {
      return null;
    }
    const clone: Record<string, unknown> = { ...(data as Record<string, unknown>) };
    for (const key of Object.keys(clone)) {
      if (SENSITIVE_KEYS.has(key)) {
        clone[key] = '[REDACTED]';
      }
    }
    return clone;
  }
}
