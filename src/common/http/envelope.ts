export interface SuccessEnvelope<T> {
  status: 'success';
  message: string;
  data: T;
  /** Present only on responses that carry extra information, such as pagination. */
  meta?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  status: 'error';
  message: string;
  data: { code: string; details?: unknown };
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export function success<T>(
  message: string,
  data: T,
  meta?: Record<string, unknown>,
): SuccessEnvelope<T> {
  return meta === undefined
    ? { status: 'success', message, data }
    : { status: 'success', message, data, meta };
}

export function failure(code: string, message: string, details?: unknown): ErrorEnvelope {
  return {
    status: 'error',
    message,
    data: details === undefined ? { code } : { code, details },
  };
}
