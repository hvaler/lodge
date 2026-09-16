/**
 * The demonstration's routing, as a web-standard fetch handler.
 *
 * Shared by both entrypoints — the Node server behind `npm run demo` and the Lambda behind the
 * public one — because two copies of this would be two copies that drift, and the public one is
 * the copy nobody runs locally and therefore the copy that rots.
 */

import type { AskRequest, Catalogue } from './api.ts';

/** The half of {@link createDemoApi} this needs. Structural, so a test can pass forty lines. */
export interface DemoApi {
  catalogues(): Promise<readonly Catalogue[]>;
  ask(request: AskRequest): Promise<{ readonly said: string }>;
}

/**
 * A hard ceiling on how many questions the demonstration answers.
 *
 * Only the public deployment passes one. It exists because the page spends money on somebody
 * else's behalf every time it answers, and an open endpoint that spends money is an open endpoint
 * that eventually spends all of it. A cap that refuses politely is better than a budget alarm that
 * tells you afterwards.
 */
export interface Quota {
  /** Returns whether this question is allowed, and how many remain. */
  take(): Promise<{ readonly allowed: boolean; readonly remaining: number }>;
}

export interface DemoHandlerOptions {
  readonly api: DemoApi;
  readonly page: string;
  readonly quota?: Quota;
  /** So a failure reaches the logs rather than only the caller. */
  readonly onError?: (error: Error) => void;
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

export function createDemoHandler(options: DemoHandlerOptions): (request: Request) => Promise<Response> {
  const { api, page, quota } = options;

  return async function handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (request.method === 'GET' && (path === '/' || path === '/index.html')) {
      return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    if (request.method === 'GET' && path === '/api/institutions') {
      try {
        return json(200, await api.catalogues());
      } catch (error) {
        options.onError?.(error as Error);
        return json(502, { error: `Lodge did not answer: ${(error as Error).message}` });
      }
    }

    if (request.method === 'POST' && path === '/api/ask') {
      if (quota) {
        const { allowed, remaining } = await quota.take();
        if (!allowed) {
          // 429 with a sentence the page can read out, because the person in front of it did
          // nothing wrong and deserves to know what to do instead.
          return json(
            429,
            {
              error:
                'This public demonstration has answered as many questions as it will today. ' +
                'The video shows the same thing, and `npm run demo` runs it locally with no limit.',
            },
            { 'retry-after': '3600' },
          );
        }
        options.onError?.(new Error(`quota: ${remaining} answers left today`));
      }

      try {
        const body = (await request.json()) as AskRequest;
        return json(200, await api.ask(body));
      } catch (error) {
        options.onError?.(error as Error);
        // An unknown institution is the caller's mistake; anything else is ours, and saying which
        // saves somebody reading the wrong logs.
        const status = (error as Error).name === 'UnknownInstitutionError' ? 400 : 500;
        return json(status, { error: (error as Error).message });
      }
    }

    return json(404, { error: 'not found' });
  };
}
