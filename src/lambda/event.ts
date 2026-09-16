/**
 * AWS Lambda Function URL events on one side, the web-standard types on the other.
 *
 * Shared by both Lambda entrypoints — the MCP server and the public demonstration — because the
 * base64 body, the method buried in `requestContext.http` and the optional headers are three
 * chances to get it slightly differently wrong in two places.
 *
 * The event shape is declared here rather than taken from `@types/aws-lambda`: it is six fields,
 * and a type-only dependency for six fields is a dependency somebody has to approve.
 */

/** Payload format 2.0. Only the fields anything here reads. */
export interface FunctionUrlEvent {
  readonly rawPath?: string;
  readonly rawQueryString?: string;
  readonly headers?: Record<string, string | undefined>;
  readonly body?: string;
  readonly isBase64Encoded?: boolean;
  readonly requestContext?: { readonly http?: { readonly method?: string } };
}

export interface FunctionUrlResult {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly isBase64Encoded?: boolean;
}

/** Turns the event into the web-standard `Request` a fetch handler speaks. */
export function toRequest(event: FunctionUrlEvent): Request {
  const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
  // The host is cosmetic — handlers here route on path and method — but a real URL keeps anything
  // downstream that parses it from having to special-case us.
  const url = new URL(`${event.rawPath ?? '/'}${query}`, 'https://lodge.invalid');

  const headers = new Headers();
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(name, value);
  }

  const method = event.requestContext?.http?.method ?? 'GET';
  const hasBody = event.body !== undefined && method !== 'GET' && method !== 'HEAD';

  return new Request(url, {
    method,
    headers,
    ...(hasBody
      ? { body: event.isBase64Encoded ? Buffer.from(event.body!, 'base64') : event.body! }
      : {}),
  });
}

export async function toResult(response: Response): Promise<FunctionUrlResult> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return { statusCode: response.status, headers, body: await response.text() };
}
