import { SetMetadata } from '@nestjs/common';

export const CATCH_ERROR_KEY = 'catchError';
export const CatchError = () => SetMetadata(CATCH_ERROR_KEY, true);
