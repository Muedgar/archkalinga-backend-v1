import { SetMetadata } from '@nestjs/common';

export const LOG_ACTIVITY_KEY = 'log_activity';

export interface LogActivityOptions {
  action: string;
  resource: string;
  includeBody?: boolean;
  includeResult?: boolean;
}

export const LogActivity = (options: LogActivityOptions) =>
  SetMetadata(LOG_ACTIVITY_KEY, options);
