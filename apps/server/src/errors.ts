import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type ZodType, type z } from 'zod';
import type { ApiErrorBody } from '@deadline-day/protocol';

/** An error with an HTTP status and a stable code the client can switch on. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.details === undefined ? {} : { details: this.details }) } };
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new ApiError(400, code, message, details);
export const unauthorized = (message = 'Sign in or continue as a guest first') => new ApiError(401, 'AUTH_REQUIRED', message);
export const forbidden = (code: string, message: string) => new ApiError(403, code, message);
export const notFound = (code: string, message: string) => new ApiError(404, code, message);
export const conflict = (code: string, message: string, details?: unknown) => new ApiError(409, code, message, details);

/** Parse with a zod schema; a ZodError becomes a 400 in the error handler. */
export function parse<S extends ZodType>(schema: S, data: unknown): z.output<S> {
  return schema.parse(data ?? {});
}

export function zodToApiError(err: ZodError): ApiError {
  const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const first = issues[0];
  const message = first ? (first.path ? `${first.path}: ${first.message}` : first.message) : 'Invalid input';
  return badRequest('VALIDATION_ERROR', message, issues);
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof ZodError) return zodToApiError(err);
  const fe = err as Partial<FastifyError>;
  if (typeof fe.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 500) {
    return new ApiError(fe.statusCode, fe.code ?? 'BAD_REQUEST', fe.message ?? 'Bad request');
  }
  return new ApiError(500, 'INTERNAL', 'Something went wrong on the server');
}

/** `spa`: when set, page requests the API does not know get the web app instead of a JSON 404. */
export function installErrorHandler(app: FastifyInstance, spa?: { isPage: (request: FastifyRequest) => boolean; send: (reply: FastifyReply) => void }): void {
  app.setErrorHandler((err, request, reply) => {
    const api = toApiError(err);
    if (api.status >= 500) request.log.error(err);
    void reply.status(api.status).send(api.body());
  });
  app.setNotFoundHandler((request, reply) => {
    if (spa?.isPage(request)) return spa.send(reply);
    void reply.status(404).send(notFound('NOT_FOUND', `No route for ${request.method} ${request.url}`).body());
  });
}
