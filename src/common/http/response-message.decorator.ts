import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE = 'yapa:response-message';

/** Sets the `message` placed in the success envelope for a route. */
export const ResponseMessage = (message: string) => SetMetadata(RESPONSE_MESSAGE, message);
