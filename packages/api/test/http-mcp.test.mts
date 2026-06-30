import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCP_TOKEN_ENV, requireMcpBearerToken } from '../server/mcp-auth.mjs';
import { isLocalMcpRequest, requireLocalMcpRequest } from '../server/mcp-local-only.mjs';

function request(
  remoteAddress: string | undefined,
  headers: Record<string, string | undefined> = {},
) {
  return {
    socket: { remoteAddress },
    ip: remoteAddress,
    headers,
  };
}

function response() {
  const response = {
    status: vi.fn(function status() {
      return response;
    }),
    json: vi.fn(),
  };
  return response;
}

describe('HTTP MCP route', () => {
  const previousToken = process.env[MCP_TOKEN_ENV];

  afterEach(() => {
    if (previousToken === undefined) {
      delete process.env[MCP_TOKEN_ENV];
    } else {
      process.env[MCP_TOKEN_ENV] = previousToken;
    }
  });

  it('rejects non-local forwarded clients before CORS can expose MCP', () => {
    expect(
      isLocalMcpRequest(
        request('127.0.0.1', {
          'x-forwarded-for': '203.0.113.7',
        }),
      ),
    ).toBe(false);
  });

  it('returns 403 for non-local forwarded clients', () => {
    const res = response();
    const next = vi.fn();

    requireLocalMcpRequest(
      request('127.0.0.1', {
        'x-forwarded-for': '203.0.113.7',
      }) as any,
      res as any,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: true,
      result: 'MCP endpoint is only available from localhost',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows local MCP clients', () => {
    expect(isLocalMcpRequest(request('127.0.0.1'))).toBe(true);
    expect(isLocalMcpRequest(request('::1'))).toBe(true);
    expect(
      isLocalMcpRequest(
        request('::ffff:127.0.0.1', {
          forwarded: 'for="[::1]";proto=http',
        }),
      ),
    ).toBe(true);
  });

  it('fails closed when the MCP token is not configured', () => {
    delete process.env[MCP_TOKEN_ENV];
    const res = response();
    const next = vi.fn();

    requireMcpBearerToken(request('127.0.0.1') as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: true,
      result: `MCP endpoint is disabled until ${MCP_TOKEN_ENV} is set`,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects local MCP clients without the configured bearer token', () => {
    process.env[MCP_TOKEN_ENV] = 'local-secret';
    const res = response();
    const next = vi.fn();

    requireMcpBearerToken(request('127.0.0.1') as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: true,
      result: 'MCP endpoint requires a valid bearer token',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects local MCP clients with the wrong bearer token', () => {
    process.env[MCP_TOKEN_ENV] = 'local-secret';
    const res = response();
    const next = vi.fn();

    requireMcpBearerToken(
      request('127.0.0.1', { authorization: 'Bearer wrong-secret' }) as any,
      res as any,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows local MCP clients with the configured bearer token', () => {
    process.env[MCP_TOKEN_ENV] = 'local-secret';
    const res = response();
    const next = vi.fn();

    requireMcpBearerToken(
      request('127.0.0.1', { authorization: 'Bearer local-secret' }) as any,
      res as any,
      next,
    );

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
