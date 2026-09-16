/**
 * Node's HTTP types on one side, the web-standard ones on the other.
 *
 * Both entrypoints that serve something written as a `fetch` handler need this translation, and it
 * was copied into two files before it was extracted into one. Nothing here is Lodge-specific.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/** Writes a web-standard `Response` to a Node response. */
export async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(await response.text());
}

/**
 * Builds a web-standard `Request` from a Node one, reading the body if there is one.
 *
 * The origin is supplied rather than guessed: a `Request` needs an absolute URL and a Node request
 * only carries a path. Nothing downstream routes on the host, but a real URL keeps anything that
 * parses one from having to special-case us.
 */
export async function nodeToRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) for (const one of value) headers.append(name, one);
  }

  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') {
    return new Request(new URL(req.url ?? '/', origin), { method, headers });
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);

  return new Request(new URL(req.url ?? '/', origin), {
    method,
    headers,
    body: Buffer.concat(chunks),
  });
}
