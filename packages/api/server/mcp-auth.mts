import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const MCP_TOKEN_ENV = 'SRCBOOK_MCP_TOKEN';

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function bearerToken(req: Request): string | undefined {
  const authorization = headerValue(req.headers.authorization);
  if (!authorization) return undefined;

  const [scheme, token, ...extra] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || extra.length > 0) return undefined;
  return token;
}

function tokenMatches(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function requireMcpBearerToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env[MCP_TOKEN_ENV];
  if (!expected) {
    return res.status(403).json({
      error: true,
      result: `MCP endpoint is disabled until ${MCP_TOKEN_ENV} is set`,
    });
  }

  const actual = bearerToken(req);
  if (!actual || !tokenMatches(actual, expected)) {
    return res.status(403).json({
      error: true,
      result: 'MCP endpoint requires a valid bearer token',
    });
  }

  return next();
}
