/**
 * Filing a fault into the system the institution already watches.
 *
 * A broken projector has to reach the people who fix projectors, and they are not looking at a
 * queue Lodge invented — they are looking at the one they already have open. So this module writes
 * outward, and the shape of what it writes into is the institution's choice.
 *
 * Two of them, deliberately in this order:
 *
 *  - **A webhook** needs no vendor, no library and no account. POST a documented payload and let
 *    the institution wire it to whatever they run. It can file a fault and it cannot answer "how is
 *    mine going", which is exactly why `issues` was split into `issue-reporting` and
 *    `issue-tracking` (ADR-017).
 *  - **Jira** as the worked example of a real tracker, because it can do both and because it is the
 *    one people ask about. Everything specific to it lives here and nothing above this file knows.
 *
 * What is **not** here yet is email, which is the only one of the three that is genuinely a
 * standard every institution already has. It needs an SMTP dependency; see `docs/roadmap.md`.
 */

import type { IssueStatus, Ticket } from '../../provider/index.ts';

/** What a service desk needs to be told. Everything here is already known to the caller. */
export interface FaultReport {
  readonly roomId: string;
  readonly equipment: string;
  readonly note?: string;
  /** The token subject of whoever reported it. Never a name typed by a user. */
  readonly reportedBy: string;
  readonly reportedAt: Date;
  readonly institution: string;
}

/** Files a fault and returns the reference the institution's own system gave it. */
export interface IssueSink {
  file(report: FaultReport): Promise<string>;
}

/** Reads back what one person reported. Not every sink can do this — that is the whole point. */
export interface IssueTracker {
  openedBy(subject: string): Promise<readonly Ticket[]>;
}

export class IssueSinkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'IssueSinkError';
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/** Injected so a test can answer without a network, and so a proxy can be supplied. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

// ── Webhook ──────────────────────────────────────────────────────────────────

export interface WebhookSource {
  readonly url: string;
  /** Sent with every request. Where an API key or a shared secret goes. */
  readonly headers?: Record<string, string>;
  /**
   * Which field of the JSON answer carries the reference, dotted for nesting: `key`, `data.id`.
   *
   * Required rather than guessed. A reference is spoken back to the person who reported the fault
   * and is how they chase it later; inventing one when the endpoint did not return one would hand
   * somebody a number that means nothing to the desk they will quote it to.
   */
  readonly referenceField: string;
}

function dig(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((at, key) => {
    return at && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined;
  }, value);
}

/**
 * Posts the fault as JSON and reads the reference out of the answer.
 *
 * The payload is flat, documented and stable, because the institution wires it to something and
 * then forgets about it. Adding a field is safe; renaming one is not, and would need the same
 * deliberation as any other published contract.
 */
export function createWebhookSink(source: WebhookSource, fetchImpl: Fetch = fetch): IssueSink {
  return {
    async file(report: FaultReport): Promise<string> {
      let response: Response;
      try {
        response = await fetchImpl(source.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...source.headers },
          body: JSON.stringify({
            room: report.roomId,
            equipment: report.equipment,
            note: report.note ?? '',
            reportedBy: report.reportedBy,
            reportedAt: report.reportedAt.toISOString(),
            institution: report.institution,
            source: 'lodge',
          }),
        });
      } catch (error) {
        throw new IssueSinkError(`The fault webhook at '${source.url}' could not be reached.`, {
          cause: error,
        });
      }

      if (!response.ok) {
        throw new IssueSinkError(
          `The fault webhook at '${source.url}' answered ${response.status}.`,
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new IssueSinkError('The fault webhook did not answer with JSON.', { cause: error });
      }

      const reference = dig(body, source.referenceField);
      if (typeof reference !== 'string' && typeof reference !== 'number') {
        throw new IssueSinkError(
          `The fault webhook answered without '${source.referenceField}', so there is no reference ` +
            `to give back. The report may or may not have been recorded, and saying either would be a guess.`,
        );
      }

      return String(reference);
    },
  };
}

// ── Jira ─────────────────────────────────────────────────────────────────────

export interface JiraSource {
  /** Base URL of the instance, e.g. `https://example.atlassian.net`. */
  readonly url: string;
  /** Project key faults are filed under, e.g. `FM`. */
  readonly project: string;
  /** Account the API token belongs to. */
  readonly email: string;
  readonly token: string;
  /** Issue type to create. Defaults to `Task`, which every project has. */
  readonly issueType?: string;
}

/**
 * How a reported fault is attributed to the person who reported it.
 *
 * A label rather than Jira's `reporter` field, because that would need every student and lecturer
 * to exist as a Jira account — which is a licensing conversation, not an integration. The label
 * carries the token subject, and `openedBy` searches on it.
 */
function labelFor(subject: string): string {
  // Jira labels cannot contain spaces. Subjects are token identifiers and will not either, but a
  // label that silently fails to apply would quietly break chasing for one person only.
  return `lodge-${subject.replace(/\s+/g, '_')}`;
}

function statusOf(category: unknown): IssueStatus {
  // Jira projects rename statuses freely; the *category* is the part that is stable across them.
  const key = typeof category === 'string' ? category : '';
  if (key === 'done') return 'resolved';
  if (key === 'indeterminate') return 'in-progress';
  return 'open';
}

/**
 * Jira Service Management, or any Jira project: files a fault and reads back what somebody
 * reported. The only connector here that can do both, which is why it declares both capabilities.
 */
export function createJiraTracker(
  source: JiraSource,
  fetchImpl: Fetch = fetch,
): IssueSink & IssueTracker {
  const base = source.url.replace(/\/+$/, '');
  const auth = `Basic ${Buffer.from(`${source.email}:${source.token}`).toString('base64')}`;
  const headers = { authorization: auth, 'content-type': 'application/json', accept: 'application/json' };

  async function call(path: string, init?: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, { ...init, headers });
    } catch (error) {
      throw new IssueSinkError(`Jira at '${base}' could not be reached.`, { cause: error });
    }

    if (!response.ok) {
      // Deliberately not echoing Jira's body back: it can carry field names and project
      // configuration, and this message reaches a person through a speaker.
      throw new IssueSinkError(`Jira at '${base}' answered ${response.status}.`);
    }

    return response.json();
  }

  return {
    async file(report: FaultReport): Promise<string> {
      const created = (await call('/rest/api/3/issue', {
        method: 'POST',
        body: JSON.stringify({
          fields: {
            project: { key: source.project },
            issuetype: { name: source.issueType ?? 'Task' },
            summary: `${report.equipment} in ${report.roomId}`,
            description: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text:
                        `Reported through Lodge at ${report.institution}.` +
                        (report.note ? ` Note: ${report.note}` : ''),
                    },
                  ],
                },
              ],
            },
            labels: [labelFor(report.reportedBy), 'lodge'],
          },
        }),
      })) as { key?: unknown };

      if (typeof created.key !== 'string') {
        throw new IssueSinkError('Jira accepted the fault but did not return an issue key.');
      }
      return created.key;
    },

    async openedBy(subject: string): Promise<readonly Ticket[]> {
      const found = (await call('/rest/api/3/search/jql', {
        method: 'POST',
        body: JSON.stringify({
          // Scoped to the project *and* the label: a subject cannot see anything they did not
          // report, however the instance is configured.
          jql: `project = "${source.project}" AND labels = "${labelFor(subject)}" ORDER BY created DESC`,
          fields: ['summary', 'status', 'created', 'labels'],
          maxResults: 20,
        }),
      })) as { issues?: { key?: unknown; fields?: Record<string, unknown> }[] };

      return (found.issues ?? []).flatMap((issue) => {
        if (typeof issue.key !== 'string') return [];
        const fields = issue.fields ?? {};
        const summary = typeof fields['summary'] === 'string' ? fields['summary'] : '';
        // `<equipment> in <room>`, which is what `file` wrote. Parsed back rather than stored
        // separately, so there is one place that decides the shape.
        const [equipment = '', roomId = ''] = summary.split(' in ');
        const category = (fields['status'] as { statusCategory?: { key?: unknown } } | undefined)
          ?.statusCategory?.key;

        return [
          {
            number: issue.key,
            roomId,
            equipment,
            status: statusOf(category),
            openedAt: new Date(String(fields['created'] ?? '')),
          } satisfies Ticket,
        ];
      });
    },
  };
}
