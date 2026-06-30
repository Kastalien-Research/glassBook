import type { NextFunction, Request, Response } from 'express';

type McpRequestAddressParts = {
  readonly headers: Request['headers'];
  readonly ip?: string;
  readonly socket: {
    readonly remoteAddress?: string;
  };
};

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;
  let normalized = address.trim().toLowerCase().replace(/^"|"$/g, '');
  if (normalized.startsWith('for=')) {
    normalized = normalized.slice(4);
  }
  normalized = normalized.replace(/^"|"$/g, '');
  if (normalized.startsWith('[')) {
    const bracketEnd = normalized.indexOf(']');
    normalized = bracketEnd >= 0 ? normalized.slice(1, bracketEnd) : normalized.slice(1);
  } else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(normalized)) {
    normalized = normalized.slice(0, normalized.lastIndexOf(':'));
  }
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice('::ffff:'.length);
  }
  return normalized;
}

function isLoopbackAddress(address: string | undefined): boolean {
  const normalized = normalizeAddress(address);
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized?.startsWith('127.') === true
  );
}

function forwardedClientAddress(req: McpRequestAddressParts): string | undefined {
  const forwardedFor = headerValue(req.headers['x-forwarded-for']);
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim();
  }

  const forwarded = headerValue(req.headers.forwarded);
  const firstForwardedEntry = forwarded?.split(',')[0];
  return firstForwardedEntry
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith('for='));
}

export function isLocalMcpRequest(req: McpRequestAddressParts): boolean {
  const socketIsLocal = isLoopbackAddress(req.socket.remoteAddress) || isLoopbackAddress(req.ip);
  const forwardedAddress = forwardedClientAddress(req);
  return socketIsLocal && (!forwardedAddress || isLoopbackAddress(forwardedAddress));
}

export function requireLocalMcpRequest(req: Request, res: Response, next: NextFunction) {
  if (!isLocalMcpRequest(req)) {
    return res.status(403).json({
      error: true,
      result: 'MCP endpoint is only available from localhost',
    });
  }
  return next();
}
