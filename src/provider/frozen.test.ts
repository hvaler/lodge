/**
 * The freeze, at runtime.
 *
 * `frozen.ts` locks the *shape* and fails at `tsc`. This locks the *names* — capabilities, methods
 * and published tools — and fails at `npm test` with a readable diff, because
 * `Type 'false' does not satisfy the constraint 'true'` tells you that something moved but not what.
 *
 * Renaming a capability or a tool is not a refactor here: `campus.find_room` is in the video, in
 * the adoption guide and in whatever client an institution has already pointed at its server.
 */

import { describe, expect, it } from 'vitest';

import { AMENDED_ON, FROZEN_ON } from './frozen.ts';
import {
  CAPABILITIES,
  CAPABILITY_METHODS,
  CAPABILITY_REQUIRES,
  CAPABILITY_TOOLS,
  toolCatalogue,
} from './provider.ts';
import type { Provider } from './provider.ts';

describe(`the provider interface, frozen on ${FROZEN_ON}, amended ${AMENDED_ON.join(', ')} (ADR-006)`, () => {
  it('declares six capabilities, in this order', () => {
    // The order is the catalogue order a client sees, so it is part of the contract too.
    expect([...CAPABILITIES]).toEqual([
      'rooms',
      'timetable',
      'deadlines',
      'wayfinding',
      'issue-reporting',
      'issue-tracking',
    ]);
  });

  it('obliges exactly these methods per capability', () => {
    expect(CAPABILITY_METHODS).toEqual({
      rooms: ['findFreeRooms', 'getRoom', 'listRooms'],
      timetable: ['timetable'],
      deadlines: ['deadlines'],
      wayfinding: ['wayfind'],
      'issue-reporting': ['reportIssue'],
      'issue-tracking': ['issueStatus'],
    });
  });

  it('records which capabilities need another one', () => {
    expect(CAPABILITY_REQUIRES).toEqual({ 'issue-reporting': ['rooms'] });
  });

  it('publishes exactly these tools per capability', () => {
    expect(CAPABILITY_TOOLS).toEqual({
      rooms: ['campus.find_room'],
      timetable: ['campus.timetable'],
      deadlines: ['campus.deadlines'],
      wayfinding: ['campus.wayfind'],
      'issue-reporting': ['campus.report_issue'],
      'issue-tracking': ['campus.issue_status'],
    });
  });

  it('offers six tools to an institution that can answer everything', () => {
    const everything = {
      descriptor: { capabilities: CAPABILITIES },
    } as unknown as Provider;

    expect(toolCatalogue(everything)).toEqual([
      'campus.find_room',
      'campus.timetable',
      'campus.deadlines',
      'campus.wayfind',
      'campus.report_issue',
      'campus.issue_status',
    ]);
  });
});
