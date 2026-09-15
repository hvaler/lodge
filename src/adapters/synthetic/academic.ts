/**
 * Degree programmes, academic calendar, people and the seeded fault queue.
 *
 * Transcribed from `docs/san-telmo.md` §2–§5. Everything here is fixed: what the generator builds
 * on top of it is the timetable.
 */

import type { Deadline, IssueStatus } from '../../provider/index.ts';
import { campusInstant } from './campus.ts';

// ── Programmes ───────────────────────────────────────────────────────────────

export interface Programme {
  readonly code: string;
  readonly name: string;
  /** Building where most of its teaching happens. */
  readonly home: string;
  readonly groups: readonly string[];
  readonly years: number;
}

export const PROGRAMMES: readonly Programme[] = [
  { code: 'HAR', name: 'Historia del Arte', home: 'MEN', groups: ['A'], years: 4 },
  { code: 'INF', name: 'Ingeniería Informática', home: 'SCL', groups: ['A', 'B'], years: 4 },
  { code: 'ENF', name: 'Enfermería', home: 'SCL', groups: ['A', 'B'], years: 4 },
  { code: 'DER', name: 'Derecho', home: 'MEN', groups: ['A', 'B'], years: 4 },
  { code: 'BMA', name: 'Biología Marina', home: 'FAR', groups: ['A'], years: 4 },
  { code: 'TEI', name: 'Traducción e Interpretación', home: 'FAR', groups: ['A'], years: 4 },
];

export function programmeByCode(code: string): Programme | null {
  return PROGRAMMES.find((p) => p.code === code) ?? null;
}

// ── Calendar ─────────────────────────────────────────────────────────────────

/**
 * The academic year 2026–2027.
 *
 * Deliberately alive during the demo window: several of these close in October 2026, which is what
 * gives `campus.deadlines` something real to answer. A question with no entry here must come back
 * empty — UC-03 requires the agent to say a deadline is not on record rather than approximate one.
 */
export const CALENDAR: readonly Deadline[] = [
  { id: 'enrolment-ordinary', label: 'Matrícula ordinaria', opensOn: campusInstant('2026-07-01', '09:00'), closesOn: campusInstant('2026-07-17') },
  { id: 'enrolment-late', label: 'Matrícula extraordinaria y modificaciones', opensOn: campusInstant('2026-09-21', '09:00'), closesOn: campusInstant('2026-10-02') },
  { id: 'credit-transfer', label: 'Solicitud de convalidaciones', closesOn: campusInstant('2026-10-09') },
  { id: 'placement-agreements', label: 'Convenios de prácticas de Enfermería, a partir de 3.º', closesOn: campusInstant('2026-10-16') },
  { id: 'final-project-autumn', label: 'Entrega de TFG, convocatoria de otoño', closesOn: campusInstant('2026-10-30') },
  { id: 'teaching-s1', label: 'Docencia del primer cuatrimestre', opensOn: campusInstant('2026-09-14', '09:00'), closesOn: campusInstant('2027-01-22') },
  { id: 'exams-s1', label: 'Exámenes del primer cuatrimestre, primera convocatoria', opensOn: campusInstant('2027-01-26', '09:00'), closesOn: campusInstant('2027-02-13') },
  { id: 'teaching-s2', label: 'Docencia del segundo cuatrimestre', opensOn: campusInstant('2027-02-16', '09:00'), closesOn: campusInstant('2027-05-29') },
  { id: 'exams-resit', label: 'Convocatoria extraordinaria', opensOn: campusInstant('2027-06-15', '09:00'), closesOn: campusInstant('2027-06-26') },
];

/** Campus closed. Local patron's day, 13 October, is the one a generic calendar would miss. */
export const HOLIDAYS: readonly string[] = [
  '2026-10-12',
  '2026-10-13',
  '2026-11-01',
  '2026-12-06',
  '2026-12-08',
  '2027-01-01',
  '2027-01-06',
];

export function isHoliday(isoDate: string): boolean {
  return HOLIDAYS.includes(isoDate);
}

/** Semester 1 teaching runs between these dates, holidays excepted. */
export const SEMESTER_1 = { from: '2026-09-14', to: '2027-01-22' } as const;

// ── People ───────────────────────────────────────────────────────────────────

export type PersonRole = 'student' | 'lecturer' | 'porter';

export interface Person {
  readonly subject: string;
  readonly role: PersonRole;
  readonly programme?: string;
  readonly year?: number;
  readonly group?: string;
  /** Set for the exchange student: the hook UC-07 hangs off. The other institution is M2's. */
  readonly alsoEnrolledElsewhere?: boolean;
}

export const PEOPLE: readonly Person[] = [
  { subject: 'est-0001', role: 'student', programme: 'DER', year: 2, group: 'A' },
  { subject: 'est-0002', role: 'student', programme: 'INF', year: 2, group: 'B' },
  { subject: 'est-0042', role: 'student', programme: 'TEI', year: 3, group: 'A', alsoEnrolledElsewhere: true },
  { subject: 'doc-0007', role: 'lecturer', programme: 'DER' },
  { subject: 'doc-0011', role: 'lecturer', programme: 'BMA' },
  { subject: 'con-0001', role: 'porter' },
];

export function personBySubject(subject: string): Person | null {
  return PEOPLE.find((p) => p.subject === subject) ?? null;
}

// ── Seeded fault queue ───────────────────────────────────────────────────────

export interface SeededIssue {
  readonly number: string;
  readonly roomId: string;
  /** Matches an entry in that room's equipment — a room without a projector cannot have a broken one. */
  readonly equipment: string;
  readonly openedBy: string;
  readonly status: IssueStatus;
  readonly openedAt: Date;
}

/**
 * Open on a clean clone, so UC-06 has something to answer without anyone having to file a fault
 * first. Numbers are fixed rather than drawn: they are spoken back in the video.
 */
export const SEEDED_ISSUES: readonly SeededIssue[] = [
  { number: 'INC-2026-0019', roomId: 'SCL-201', equipment: 'puestos de ordenador', openedBy: 'doc-0011', status: 'resolved', openedAt: campusInstant('2026-09-28', '11:20') },
  { number: 'INC-2026-0028', roomId: 'FAR-104', equipment: 'pantalla táctil', openedBy: 'doc-0011', status: 'in-progress', openedAt: campusInstant('2026-10-05', '16:40') },
  { number: 'INC-2026-0031', roomId: 'MEN-203', equipment: 'proyector', openedBy: 'doc-0007', status: 'open', openedAt: campusInstant('2026-10-06', '09:05') },
];

/** Fault numbers continue the seeded run, so a new report reads as the next one in the queue. */
export const FIRST_FREE_ISSUE_NUMBER = 32;

export function formatIssueNumber(sequence: number, year = 2026): string {
  return `INC-${year}-${String(sequence).padStart(4, '0')}`;
}
