import { describe, expect, it } from 'vitest';

import {
  CALENDAR,
  FIRST_FREE_ISSUE_NUMBER,
  HOLIDAYS,
  PEOPLE,
  PROGRAMMES,
  SEEDED_ISSUES,
  formatIssueNumber,
  isHoliday,
  personBySubject,
  programmeByCode,
} from './academic.ts';
import { campusInstant, campusLocalParts, roomById } from './campus.ts';

describe('programmes', () => {
  it('has the six of docs/san-telmo.md, each in a real building', () => {
    expect(PROGRAMMES).toHaveLength(6);
    expect(PROGRAMMES.map((p) => p.code)).toEqual(['HAR', 'INF', 'ENF', 'DER', 'BMA', 'TEI']);
    expect(PROGRAMMES.every((p) => ['MEN', 'SCL', 'FAR'].includes(p.home))).toBe(true);
  });

  it('gives the two largest cohorts a second group', () => {
    expect(programmeByCode('DER')?.groups).toEqual(['A', 'B']);
    expect(programmeByCode('INF')?.groups).toEqual(['A', 'B']);
    expect(programmeByCode('HAR')?.groups).toEqual(['A']);
  });

  it('returns null for a programme that does not exist', () => {
    expect(programmeByCode('XXX')).toBeNull();
  });
});

describe('campusInstant', () => {
  // The calendar straddles the end of summer time: 9 October is CEST, 30 October is CET.
  it('resolves a CEST date to UTC+2', () => {
    const at = campusInstant('2026-10-09', '23:59');

    expect(at.toISOString()).toBe('2026-10-09T21:59:00.000Z');
  });

  it('resolves a CET date to UTC+1', () => {
    const at = campusInstant('2026-10-30', '23:59');

    expect(at.toISOString()).toBe('2026-10-30T22:59:00.000Z');
  });

  it('round-trips through the campus wall clock in both seasons', () => {
    for (const iso of ['2026-10-09', '2026-10-30', '2027-01-22', '2027-06-15']) {
      const parts = campusLocalParts(campusInstant(iso, '23:59'));

      expect(parts.isoDate).toBe(iso);
      expect(parts.minutes).toBe(23 * 60 + 59);
    }
  });
});

describe('academic calendar', () => {
  it('keeps three deadlines alive during the October demo window', () => {
    const october = CALENDAR.filter(
      (d) => d.closesOn >= campusInstant('2026-10-03', '00:00') && d.closesOn <= campusInstant('2026-10-31', '23:59'),
    );

    expect(october.map((d) => d.id)).toEqual(['credit-transfer', 'placement-agreements', 'final-project-autumn']);
  });

  it('gives every entry a unique id and a closing date after its opening date', () => {
    expect(new Set(CALENDAR.map((d) => d.id)).size).toBe(CALENDAR.length);

    for (const entry of CALENDAR) {
      if (entry.opensOn) expect(entry.opensOn.getTime()).toBeLessThan(entry.closesOn.getTime());
    }
  });

  it('closes late enrolment just before the week when everything piles up', () => {
    const lateEnrolment = CALENDAR.find((d) => d.id === 'enrolment-late');

    // 2 October, the Friday before the 5th–9th.
    expect(campusLocalParts(lateEnrolment!.closesOn).isoDate).toBe('2026-10-02');
  });
});

describe('holidays', () => {
  it('closes the campus for the national day and the local patron the day after', () => {
    expect(isHoliday('2026-10-12')).toBe(true);
    expect(isHoliday('2026-10-13')).toBe(true);
    // Which makes the 5th-9th a four-day run into a long weekend.
    expect(isHoliday('2026-10-09')).toBe(false);
  });

  it('lists holidays as plain ISO dates', () => {
    expect(HOLIDAYS.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
  });
});

describe('people', () => {
  it('has two students on different programmes, which is what UC-02 isolates', () => {
    const one = personBySubject('est-0001');
    const other = personBySubject('est-0002');

    expect(one?.programme).not.toBe(other?.programme);
    expect(one?.group).not.toBe(other?.group);
  });

  it('marks exactly one exchange student, the hook UC-07 hangs off', () => {
    const exchange = PEOPLE.filter((p) => p.alsoEnrolledElsewhere);

    expect(exchange.map((p) => p.subject)).toEqual(['est-0042']);
  });

  it('enrols every student on a programme that exists', () => {
    for (const person of PEOPLE.filter((p) => p.role === 'student')) {
      expect(programmeByCode(person.programme!)).not.toBeNull();
      expect(programmeByCode(person.programme!)?.groups).toContain(person.group);
    }
  });

  it('returns null for an unknown subject rather than inventing a person', () => {
    expect(personBySubject('est-9999')).toBeNull();
  });
});

describe('seeded fault queue', () => {
  it('reports each fault against equipment the room actually has', () => {
    // A room without a projector cannot have a broken projector. This is what makes the
    // multi-turn confirmation in UC-05 meaningful rather than ceremonial.
    for (const issue of SEEDED_ISSUES) {
      const room = roomById(issue.roomId);

      expect(room, `${issue.roomId} should exist`).not.toBeNull();
      expect(room?.equipment, `${issue.number} in ${issue.roomId}`).toContain(issue.equipment);
    }
  });

  it('leaves faults in all three states, so issue_status has something to say', () => {
    expect(SEEDED_ISSUES.map((i) => i.status).sort()).toEqual(['in-progress', 'open', 'resolved']);
  });

  it('attributes faults to lecturers, since students do not file them', () => {
    for (const issue of SEEDED_ISSUES) {
      expect(personBySubject(issue.openedBy)?.role).toBe('lecturer');
    }
  });

  it('continues numbering after the highest seeded fault', () => {
    const highest = Math.max(...SEEDED_ISSUES.map((i) => Number(i.number.slice(-4))));

    expect(FIRST_FREE_ISSUE_NUMBER).toBe(highest + 1);
    expect(formatIssueNumber(FIRST_FREE_ISSUE_NUMBER)).toBe('INC-2026-0032');
  });
});
