/**
 * The fault queue.
 *
 * Behind a small interface because the two deployment targets store it differently: the self-hosted
 * container keeps it in memory for the length of a demo, and M4's managed target will put it in
 * DynamoDB. The adapter does not care which, and neither does the provider interface.
 */

import type { IssueStatus, Ticket } from '../../provider/index.ts';
import { FIRST_FREE_ISSUE_NUMBER, SEEDED_ISSUES, formatIssueNumber } from './academic.ts';

export interface StoredIssue extends Ticket {
  /** Subject of the person who filed it. `campus.issue_status` filters on this and nothing else. */
  readonly openedBy: string;
}

export interface IssueStore {
  openedBy(subject: string): Promise<readonly StoredIssue[]>;
  add(issue: Omit<StoredIssue, 'number'>): Promise<StoredIssue>;
}

/**
 * In-memory store, seeded so a clean clone can answer UC-06 without filing a fault first.
 *
 * Note this is per-process state in a server that is stateless *by protocol*. That is not a
 * contradiction: the protocol carries no session, and a replica that has not seen a report simply
 * does not list it. For a single-node demo that is invisible; M4 makes it shared.
 */
export class InMemoryIssueStore implements IssueStore {
  readonly #issues: StoredIssue[];
  #nextSequence: number;

  constructor(seed: readonly StoredIssue[] = seededIssues()) {
    this.#issues = [...seed];
    const highest = Math.max(FIRST_FREE_ISSUE_NUMBER - 1, ...seed.map((i) => Number(i.number.slice(-4))));
    this.#nextSequence = highest + 1;
  }

  async openedBy(subject: string): Promise<readonly StoredIssue[]> {
    // Newest first: someone chasing a report means the one they just filed.
    return this.#issues
      .filter((issue) => issue.openedBy === subject)
      .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  }

  async add(issue: Omit<StoredIssue, 'number'>): Promise<StoredIssue> {
    const stored: StoredIssue = { ...issue, number: formatIssueNumber(this.#nextSequence) };
    this.#nextSequence++;
    this.#issues.push(stored);
    return stored;
  }
}

function seededIssues(): StoredIssue[] {
  return SEEDED_ISSUES.map((issue) => ({
    number: issue.number,
    roomId: issue.roomId,
    equipment: issue.equipment,
    status: issue.status satisfies IssueStatus,
    openedAt: issue.openedAt,
    openedBy: issue.openedBy,
  }));
}
