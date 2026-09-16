/**
 * The demonstration's routing and its daily ceiling.
 *
 * The ceiling gets more attention than the routing, because it is the part that exists to stop an
 * open endpoint spending somebody else's money and the part that is only ever exercised in
 * production. A cap that miscounts is a cap that either refuses a judge or drains a budget.
 */

import { describe, expect, it } from 'vitest';

import { createDemoHandler } from './handler.ts';
import type { DemoApi, Quota } from './handler.ts';
import { createDailyQuota, dailyLimitFrom } from './quota.ts';
import type { DynamoLike } from './quota.ts';

const api: DemoApi = {
  async catalogues() {
    return [
      {
        slug: 'san-telmo',
        name: 'Universidad de San Telmo',
        locale: 'es-ES',
        tools: [{ name: 'campus.find_room', description: 'x' }],
        identities: [],
        suggestions: [],
      },
    ];
  },
  async ask() {
    return { said: 'Hay tres aulas libres.' };
  },
};

function ask(handle: (r: Request) => Promise<Response>): Promise<Response> {
  return handle(
    new Request('http://demo.test/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ institution: 'san-telmo', utterance: '¿aulas?' }),
    }),
  );
}

describe('routing', () => {
  const handle = createDemoHandler({ api, page: '<title>Lodge</title>' });

  it('serves the page at the root', async () => {
    const response = await handle(new Request('http://demo.test/'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('Lodge');
  });

  it('serves the catalogue the page draws its sidebar from', async () => {
    const response = await handle(new Request('http://demo.test/api/institutions'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{ slug: 'san-telmo' }]);
  });

  it('answers a question', async () => {
    expect(await (await ask(handle)).json()).toEqual({ said: 'Hay tres aulas libres.' });
  });

  it('says not found rather than serving the page for anything else', async () => {
    expect((await handle(new Request('http://demo.test/wp-admin'))).status).toBe(404);
  });
});

describe('the daily ceiling', () => {
  /** A table that counts, which is all the real one does. */
  function counter(): DynamoLike & { total(): number } {
    const days = new Map<string, number>();
    return {
      total: () => [...days.values()].reduce((a, b) => a + b, 0),
      async send(command: never): Promise<unknown> {
        const { input } = command as unknown as { input: { Key: { day: { S: string } } } };
        const day = input.Key.day.S;
        const next = (days.get(day) ?? 0) + 1;
        days.set(day, next);
        return { Attributes: { asked: { N: String(next) } } };
      },
    };
  }

  it('allows up to the limit and refuses after it', async () => {
    const quota = createDailyQuota({ tableName: 't', limit: 3, client: counter() });

    const verdicts = [];
    for (let i = 0; i < 5; i++) verdicts.push((await quota.take()).allowed);

    expect(verdicts).toEqual([true, true, true, false, false]);
  });

  it('reports how many are left, so it can be said out loud', async () => {
    const quota = createDailyQuota({ tableName: 't', limit: 10, client: counter() });

    expect((await quota.take()).remaining).toBe(9);
  });

  it('counts each day separately', async () => {
    let day = new Date('2026-09-16T10:00:00Z');
    const quota = createDailyQuota({
      tableName: 't',
      limit: 1,
      client: counter(),
      now: () => day,
    });

    expect((await quota.take()).allowed).toBe(true);
    expect((await quota.take()).allowed).toBe(false);

    day = new Date('2026-09-17T10:00:00Z');
    expect((await quota.take()).allowed).toBe(true);
  });

  it('counts before answering, not after', async () => {
    // Counting afterwards lets a burst all pass the check and all spend, which is the one case
    // the cap exists for.
    const table = counter();
    const quota = createDailyQuota({ tableName: 't', limit: 100, client: table });

    await Promise.all(Array.from({ length: 10 }, () => quota.take()));

    expect(table.total()).toBe(10);
  });
});

describe('what a refused visitor is told', () => {
  const exhausted: Quota = {
    async take() {
      return { allowed: false, remaining: 0 };
    },
  };

  it('is turned away with something useful rather than a broken page', async () => {
    const handle = createDemoHandler({ api, page: '', quota: exhausted });

    const response = await ask(handle);

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('3600');
    const body = (await response.json()) as { error: string };
    // The person in front of it did nothing wrong and deserves to know what to do instead.
    expect(body.error).toContain('npm run demo');
  });

  it('still serves the page and the catalogue, which cost nothing', async () => {
    const handle = createDemoHandler({ api, page: 'still here', quota: exhausted });

    expect(await (await handle(new Request('http://demo.test/'))).text()).toBe('still here');
    expect((await handle(new Request('http://demo.test/api/institutions'))).status).toBe(200);
  });
});

describe('the limit is read from the environment', () => {
  it('is absent when unset, which means no cap at all', () => {
    expect(dailyLimitFrom({})).toBeNull();
  });

  it('refuses a value that is not a positive whole number', () => {
    expect(() => dailyLimitFrom({ LODGE_DEMO_DAILY_LIMIT: 'lots' })).toThrow(/positive whole number/);
    expect(() => dailyLimitFrom({ LODGE_DEMO_DAILY_LIMIT: '0' })).toThrow();
    expect(() => dailyLimitFrom({ LODGE_DEMO_DAILY_LIMIT: '-5' })).toThrow();
  });

  it('reads a good one', () => {
    expect(dailyLimitFrom({ LODGE_DEMO_DAILY_LIMIT: '500' })).toBe(500);
  });
});
