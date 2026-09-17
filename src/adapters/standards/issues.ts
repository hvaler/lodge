/**
 * Filing a fault into the system the institution already watches.
 *
 * A broken projector has to reach the people who fix projectors, and they are not looking at a
 * queue Lodge invented — they are looking at the one they already have open. So this module writes
 * outward, and the shape of what it writes into is the institution's choice.
 *
 * Three of them:
 *
 *  - **Email**, which is the only one that is genuinely a standard every institution already has.
 *    A service desk address needs no API key, no firewall exception and no procurement.
 *  - **A webhook** needs no vendor and no library either. POST a documented payload and let the
 *    institution wire it to whatever they run.
 *  - **Jira** as the worked example of a real tracker, because it can answer back and because it is
 *    the one people ask about. Everything specific to it lives here and nothing above knows.
 *
 * Only Jira can say how a report is getting on. The other two receive and cannot be asked, which is
 * exactly why `issues` was split into `issue-reporting` and `issue-tracking` (ADR-017).
 */

import { randomBytes } from 'node:crypto';

import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';

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

// ── Email ────────────────────────────────────────────────────────────────────

export interface EmailSource {
  /** The service desk address faults are sent to. */
  readonly to: string;
  /** Who they come from. Wherever replies should land. */
  readonly from: string;
  readonly host: string;
  /** Defaults to 587, which is submission with STARTTLS. */
  readonly port?: number;
  /** True for implicit TLS on 465. Defaults to false, which still upgrades on 587. */
  readonly secure?: boolean;
  readonly user?: string;
  readonly password?: string;
}

/**
 * Letters that cannot be confused when read out loud or written down from hearing them.
 *
 * No `O` or `0`, no `I`, `1` or `L`. The reference exists to be spoken by a synthesiser, repeated
 * by a person and typed by somebody at a service desk, and every one of those steps is a chance to
 * turn an O into a zero.
 */
const UNAMBIGUOUS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function shortReference(): string {
  const bytes = randomBytes(6);
  let out = '';
  for (const byte of bytes) out += UNAMBIGUOUS[byte % UNAMBIGUOUS.length];
  return `LDG-${out}`;
}

/** What nodemailer needs from a transport. Narrowed so a test can pass six lines. */
export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<unknown>;
}

export interface EmailSinkOptions {
  /** Injected so a test can pin the reference and assert on it. */
  readonly reference?: () => string;
  /** Injected so a test can answer without SMTP. */
  readonly transport?: MailTransport;
}

/**
 * Sends the fault to the service desk, with a reference **Lodge mints**.
 *
 * This is the opposite of the webhook rule, which refuses to invent one, and the difference is not
 * an inconsistency. A webhook belongs to a system that assigns its own references, so inventing one
 * would hand somebody a number the desk has never seen. An inbox assigns nothing until a human
 * triages it — so until then there is no identifier at all, and the one Lodge puts **in the subject
 * line** is the only thing both sides can search for. It is meaningful to the desk precisely
 * because it is written where they will read it.
 */
export function createEmailSink(source: EmailSource, options: EmailSinkOptions = {}): IssueSink {
  const reference = options.reference ?? shortReference;
  const transport: MailTransport =
    options.transport ??
    (createTransport({
      host: source.host,
      port: source.port ?? 587,
      secure: source.secure ?? false,
      ...(source.user ? { auth: { user: source.user, pass: source.password ?? '' } } : {}),
    }) as unknown as Transporter as MailTransport);

  return {
    async file(report: FaultReport): Promise<string> {
      const number = reference();

      // Labelled lines, plain text. A person reads this on a phone and a mail rule may parse it,
      // and neither is served by HTML. The reference leads the subject so it survives a reply
      // chain and a truncated notification.
      const text = [
        `Reference:   ${number}`,
        `Room:        ${report.roomId}`,
        `Equipment:   ${report.equipment}`,
        `Reported by: ${report.reportedBy}`,
        `Reported at: ${report.reportedAt.toISOString()}`,
        ...(report.note ? [`Note:        ${report.note}`] : []),
        '',
        `Reported through Lodge at ${report.institution}.`,
        'Replying to this message does not reach the person who reported it.',
      ].join('\n');

      try {
        await transport.sendMail({
          from: source.from,
          to: source.to,
          subject: `[${number}] ${report.equipment} in ${report.roomId} — ${report.institution}`,
          text,
        });
      } catch (error) {
        throw new IssueSinkError(
          `The fault could not be sent to '${source.to}' through ${source.host}.`,
          { cause: error },
        );
      }

      return number;
    },
  };
}

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
