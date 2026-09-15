/**
 * Reading what an institution points us at.
 *
 * A source is a local path or an HTTP(S) URL, because that is how these things actually exist: a
 * timetable feed published by the scheduling system, a room table exported to a share. Supporting
 * both is the difference between "configure it" and "write an exporter first".
 */

import { readFile } from 'node:fs/promises';

export class SourceError extends Error {
  readonly location: string;

  constructor(location: string, cause: string) {
    super(`Could not read '${location}': ${cause}`);
    this.name = 'SourceError';
    this.location = location;
  }
}

function isHttp(location: string): boolean {
  return /^https?:\/\//i.test(location);
}

/**
 * Fetches or reads `location` as text.
 *
 * Failures carry the location. An institution debugging its own configuration needs to know which
 * of four paths was wrong, and "ENOENT" on its own does not tell them.
 */
export async function readSource(location: string, signal?: AbortSignal): Promise<string> {
  if (isHttp(location)) {
    let response: Response;
    try {
      response = await fetch(location, signal ? { signal } : {});
    } catch (error) {
      throw new SourceError(location, error instanceof Error ? error.message : 'request failed');
    }
    if (!response.ok) {
      throw new SourceError(location, `HTTP ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  try {
    return await readFile(location, 'utf8');
  } catch (error) {
    throw new SourceError(location, error instanceof Error ? error.message : 'read failed');
  }
}
