export interface SuccessEnvelope<T> {
  status: 'success';
  message: string;
  data: T;
}

export interface ErrorEnvelope {
  status: 'error';
  message: string;
  data: { code: string; details?: unknown };
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export function success<T>(message: string, data: T): SuccessEnvelope<T> {
  return { status: 'success', message, data };
}

export function failure(code: string, message: string, details?: unknown): ErrorEnvelope {
  return {
    status: 'error',
    message,
    data: details === undefined ? { code } : { code, details },
  };
}
