import { describe, expect, it, vi } from 'vitest';
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

describe('HTTP MCP route', () => {
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
    const response = {
      status: vi.fn(function status() {
        return response;
      }),
      json: vi.fn(),
    };
    const next = vi.fn();

    requireLocalMcpRequest(
      request('127.0.0.1', {
        'x-forwarded-for': '203.0.113.7',
      }) as any,
      response as any,
      next,
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
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
});
