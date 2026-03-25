import { SetMetadata } from '@nestjs/common';

/** Metadata key used by ResponseInterceptor to pick up the response message. */
export const RESPONSE_MESSAGE_KEY = 'responseMessage';

export const ResponseMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);
