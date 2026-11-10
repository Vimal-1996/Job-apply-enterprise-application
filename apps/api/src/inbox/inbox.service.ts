import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ApplicationStatus } from '../jobs/job-store';
import { JobsService, JobSummary } from '../jobs/jobs.service';
import { ClassifyError, ClassifyJob, EMAIL_CLASSIFIER, EmailClassifier } from './email-classifier';
import { EmailCategory, EmailVerdict, statusForCategory, worthSuggesting } from './email.schema';
import { GMAIL_API, GMAIL_SCOPES, GmailApi, GmailAuthError, jobEmailQuery, pkcePair } from './gmail-api';
import { EmailMessage, gmailThreadUrl, parseMessage } from './gmail-message';
import { ConnectionRow, ConnectionStatus, EmailRow, InboxStore, LinkSource, SyncStatus } from './inbox-store';
import { openState, sealState, STATE_TTL_MS, TokenCrypto } from './token-crypto';

export const INBOX_STORE = Symbol('INBOX_STORE');
export const TOKEN_CRYPTO = Symbol('TOKEN_CRYPTO');

/** A sync still running after this long is treated as failed (e.g. the API restarted mid-way). */
export const SYNC_TIMEOUT_MS = 5 * 60_000;

export const INBOX_LIMITS = {
  /** How far back the first sync looks. */
  firstSyncDays: 60,
  /** Emails read per sync: the first sync, and later ones. */
  firstSyncMax: 200,
  laterSyncMax: 100,
  /** Emails sent to Claude per user per day. */
  perDay: 400,
  /** Emails per Claude request. */
  batch: 8,
};

/** Later syncs look back a day before the last one, so mail that arrived late isn't missed (known emails are skipped). */
const OVERLAP_MS = 24 * 60 * 60_000;

const RECONNECT = 'Google needs you to connect Gmail again (it ends test-mode connections after 7 days).';

export interface ConnectionView {
  email: string;
  status: ConnectionStatus;
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncedAt: string | null;
  connectedAt: string;
}

export interface InboxEmailView {
  id: string;
  fromName: string | null;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  category: EmailCategory;
  summary: string | null;
  action: string | null;
  actionDue: string | null;
  company: string | null;
  threadUrl: string;
  /** The saved job this email is about, if linked. */
  job: { id: string; title: string | null; company: string | null; applicationStatus: ApplicationStatus } | null;
  linkSource: LinkSource | null;
  /** A stage change for the linked job the user hasn't decided on, if it would move the job forward. */
  suggestion: { status: ApplicationStatus } | null;
}

export interface InboxView {
  /** A Google client is configured on this server. */
  enabled: boolean;
  aiEnabled: boolean;
  connection: ConnectionView | null;
  emails: InboxEmailView[];
}

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);
  /** Short-lived Gmail access tokens, by user. */
  private readonly accessTokens = new Map<string, { token: string; expiresAt: number }>();
  /** Syncs running in this process, by user; tests await them. */
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    @Inject(INBOX_STORE) private readonly store: InboxStore,
    @Inject(TOKEN_CRYPTO) private readonly crypto: TokenCrypto,
    private readonly jobs: JobsService,
    @Optional() @Inject(GMAIL_API) private readonly gmail: GmailApi | null,
    @Optional() @Inject(EMAIL_CLASSIFIER) private readonly classifier: EmailClassifier | null,
  ) {}

  async view(userId: string, jobId?: string): Promise<InboxView> {
    const conn = await this.store.connection(userId);
    const [rows, jobs] = await Promise.all([conn ? this.store.list(userId, jobId) : Promise.resolve([]), this.jobs.list(userId)]);
    const byId = new Map(jobs.map((j) => [j.id, j]));
    return {
      enabled: Boolean(this.gmail),
      aiEnabled: Boolean(this.classifier),
      connection: conn ? connectionView(conn) : null,
      emails: rows.map((r) => emailView(r, byId)),
    };
  }

  /** The Google consent page to send the user to. The state names them and carries the PKCE verifier, sealed. */
  connectUrl(userId: string): { url: string } {
    const gmail = this.requireGmail();
    const { verifier, challenge } = pkcePair();
    const state = sealState(this.crypto, { userId, verifier, exp: Date.now() + STATE_TTL_MS });
    return { url: gmail.authUrl(state, challenge) };
  }

  /**
   * Finishes connecting with the code Google sent back to the web app. The
   * state must have been started by this same signed-in user, so a link made
   * by someone else can't attach their Gmail to this account, or this Gmail to theirs.
   */
  async finishConnect(userId: string, code: string, state: string): Promise<InboxView> {
    const gmail = this.requireGmail();
    const s = openState(this.crypto, state);
    if (!s || s.userId !== userId) throw new BadRequestException('This Gmail connection link has expired or is not yours. Start connecting again.');
    let tokens;
    try {
      tokens = await gmail.exchangeCode(code, s.verifier);
    } catch (e) {
      if (e instanceof GmailAuthError) throw new BadRequestException('Google did not accept this connection. Start connecting again.');
      throw e;
    }
    if (!tokens.refreshToken) throw new BadRequestException("Google didn't grant ongoing access. Start connecting again.");
    const granted = tokens.scope.split(' ');
    if (!granted.includes(GMAIL_SCOPES[0])) {
      throw new BadRequestException('Allow "Read your email" on the Google screen: the inbox needs it to find your job emails.');
    }
    const email = await gmail.profileEmail(tokens.accessToken);
    await this.store.saveConnection(userId, email, this.crypto.seal(tokens.refreshToken), tokens.scope);
    this.accessTokens.set(userId, { token: tokens.accessToken, expiresAt: tokens.expiresAt });
    return this.view(userId);
  }

  /** Disconnects Gmail: tells Google to revoke access, and deletes the token and every saved email summary. */
  async disconnect(userId: string): Promise<void> {
    const conn = await this.store.connection(userId);
    if (!conn) return;
    const token = this.crypto.open(conn.refreshTokenEnc);
    this.accessTokens.delete(userId);
    await this.store.disconnect(userId);
    if (token && this.gmail) await this.gmail.revoke(token).catch((e) => this.logger.warn(`Revoking a Gmail token failed: ${e}`));
  }

  /** Starts reading new job emails; returns at once. Poll GET /inbox until the sync is no longer 'syncing'. */
  async sync(userId: string): Promise<InboxView> {
    const gmail = this.requireGmail();
    if (!this.classifier) throw new ServiceUnavailableException("Reading emails with AI isn't set up on this server");
    const conn = await this.store.connection(userId);
    if (!conn) throw new ConflictException('Connect Gmail first');
    if (conn.status === 'expired') throw new ConflictException(RECONNECT);
    const runId = randomUUID();
    if (!(await this.store.startSync(userId, runId, new Date(Date.now() - SYNC_TIMEOUT_MS)))) {
      return this.view(userId); // already syncing: nothing to start
    }
    const run = this.runSync(gmail, this.classifier, userId, runId, conn).finally(() => {
      if (this.running.get(userId) === run) this.running.delete(userId);
    });
    this.running.set(userId, run);
    return this.view(userId);
  }

  /** The email's text, fetched from Gmail now (bodies are never stored). */
  async body(userId: string, id: string): Promise<{ text: string; threadUrl: string }> {
    const gmail = this.requireGmail();
    const row = await this.requireEmail(userId, id);
    const token = await this.accessToken(userId);
    try {
      const m = parseMessage(await gmail.getMessage(token, row.gmailId));
      return { text: m.text, threadUrl: gmailThreadUrl(row.threadId) };
    } catch (e) {
      throw await this.authFailure(userId, e);
    }
  }

  /** Links the email to one of the user's jobs, or unlinks it (jobId null). */
  async link(userId: string, id: string, jobId: string | null): Promise<InboxEmailView> {
    await this.requireEmail(userId, id);
    if (jobId) await this.jobs.get(userId, jobId); // 404 unless it's the user's job
    await this.store.setLink(userId, id, jobId);
    return this.emailView(userId, id);
  }

  /** Accepts (moves the job to the suggested stage, noted as from email) or dismisses an email's stage suggestion. */
  async decideSuggestion(userId: string, id: string, accept: boolean): Promise<InboxEmailView> {
    const row = await this.requireEmail(userId, id);
    if (!row.jobId || !row.suggestedStatus || row.suggestionState !== 'pending') throw new ConflictException('This email has no stage suggestion to act on');
    if (accept) await this.jobs.updateApplication(userId, row.jobId, { status: row.suggestedStatus }, 'email');
    await this.store.setSuggestionState(userId, id, accept ? 'accepted' : 'dismissed');
    return this.emailView(userId, id);
  }

  /** Resolves when every sync running in this process has finished. For tests. */
  async whenIdle(): Promise<void> {
    await Promise.all(this.running.values());
  }

  private async runSync(gmail: GmailApi, classifier: EmailClassifier, userId: string, runId: string, conn: ConnectionRow): Promise<void> {
    const startedAt = new Date();
    try {
      const token = await this.accessToken(userId);
      const first = !conn.lastSyncedAt;
      const query = jobEmailQuery(
        first ? { days: INBOX_LIMITS.firstSyncDays } : { days: INBOX_LIMITS.firstSyncDays, after: (conn.lastSyncedAt!.getTime() - OVERLAP_MS) / 1000 },
      );
      const ids = await gmail.listMessageIds(token, query, first ? INBOX_LIMITS.firstSyncMax : INBOX_LIMITS.laterSyncMax);
      const known = await this.store.knownGmailIds(userId);
      const fresh = ids.filter((id) => !known.has(id));

      const usedToday = await this.store.readSince(userId, new Date(Date.now() - 24 * 60 * 60_000));
      const allowed = Math.max(0, INBOX_LIMITS.perDay - usedToday);
      const todo = fresh.slice(0, allowed);
      const jobs = await this.jobs.list(userId);
      const forClaude: ClassifyJob[] = jobs.map((j) => ({ title: j.title, company: j.company, host: hostOf(j.applyUrl ?? j.url), status: j.applicationStatus }));

      // Oldest first, so a thread's first email is linked before its replies.
      todo.reverse();
      for (let i = 0; i < todo.length; i += INBOX_LIMITS.batch) {
        const batch = await Promise.all(todo.slice(i, i + INBOX_LIMITS.batch).map(async (id) => parseMessage(await gmail.getMessage(token, id))));
        const verdicts = await classifier.classify(
          batch.map((m) => ({ from: m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress, subject: m.subject, receivedAt: m.receivedAt, text: m.text })),
          forClaude,
        );
        for (let n = 0; n < batch.length; n++) await this.save(userId, batch[n], verdicts.get(n + 1), jobs);
      }

      // Only move the sync point on when everything found was read; otherwise the rest is picked up next time.
      const complete = todo.length === fresh.length;
      await this.store.finishSync(userId, runId, complete ? startedAt : null, complete ? null : "You've reached today's limit for reading emails; the rest will be read tomorrow.");
    } catch (e) {
      let message = 'Something went wrong reading your email. Please try again.';
      if (e instanceof GmailAuthError) {
        await this.store.setExpired(userId);
        this.accessTokens.delete(userId);
        message = RECONNECT;
      } else if (e instanceof ClassifyError) message = e.message;
      else this.logger.error(`Syncing Gmail failed: ${(e as Error).stack ?? e}`);
      await this.store.failSync(userId, runId, message).catch((err) => this.logger.error(`Couldn't record a failed sync: ${err}`));
    }
  }

  private async save(userId: string, m: EmailMessage, v: EmailVerdict | undefined, jobs: JobSummary[]) {
    // Claude skipped it: keep it as an unsorted job email so it's still visible (and not read again).
    const verdict: EmailVerdict = v ?? { ref: 0, category: 'other_job', summary: '', action: null, actionDue: null, company: null, jobRef: null };
    const jobRelated = verdict.category !== 'not_job';
    let jobId: string | null = verdict.jobRef ? jobs[verdict.jobRef - 1].id : null;
    let linkSource: LinkSource | null = jobId ? 'ai' : null;
    if (!jobId && jobRelated) {
      jobId = await this.store.threadJob(userId, m.threadId);
      if (jobId) linkSource = 'thread';
    }
    const target = jobId ? statusForCategory(verdict.category) : null;
    await this.store.insert({
      id: randomUUID(),
      userId,
      gmailId: m.gmailId,
      threadId: m.threadId,
      fromName: m.fromName,
      fromAddress: m.fromAddress,
      subject: m.subject.slice(0, 500),
      receivedAt: m.receivedAt,
      jobRelated,
      category: verdict.category,
      summary: verdict.summary || null,
      action: verdict.action,
      actionDue: verdict.actionDue,
      company: verdict.company,
      jobId,
      linkSource,
      suggestedStatus: target,
      suggestionState: target ? 'pending' : null,
    });
    if (jobId && linkSource === 'ai') await this.store.linkThread(userId, m.threadId, jobId);
  }

  /** A Gmail access token, refreshed when needed. Marks the connection expired if Google refuses. */
  private async accessToken(userId: string): Promise<string> {
    const gmail = this.requireGmail();
    const cached = this.accessTokens.get(userId);
    if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
    const conn = await this.store.connection(userId);
    if (!conn) throw new ConflictException('Connect Gmail first');
    if (conn.status === 'expired') throw new ConflictException(RECONNECT);
    const refreshToken = this.crypto.open(conn.refreshTokenEnc);
    try {
      // Unreadable token: sealed with a key from before a restart.
      if (!refreshToken) throw new GmailAuthError('The stored Gmail token can no longer be read');
      const t = await gmail.refresh(refreshToken);
      this.accessTokens.set(userId, { token: t.accessToken, expiresAt: t.expiresAt });
      return t.accessToken;
    } catch (e) {
      throw await this.authFailure(userId, e);
    }
  }

  /** Turns Google refusing access into "reconnect" (and records it); other errors pass through. */
  private async authFailure(userId: string, e: unknown): Promise<unknown> {
    if (!(e instanceof GmailAuthError)) return e;
    this.accessTokens.delete(userId);
    await this.store.setExpired(userId);
    return new ConflictException(RECONNECT);
  }

  private async emailView(userId: string, id: string): Promise<InboxEmailView> {
    const row = await this.requireEmail(userId, id);
    const jobs = await this.jobs.list(userId);
    return emailView(row, new Map(jobs.map((j) => [j.id, j])));
  }

  private async requireEmail(userId: string, id: string): Promise<EmailRow> {
    const row = await this.store.get(userId, id);
    if (!row || !row.jobRelated) throw new NotFoundException('Email not found');
    return row;
  }

  private requireGmail(): GmailApi {
    if (!this.gmail) throw new ServiceUnavailableException("Connecting Gmail isn't set up on this server");
    return this.gmail;
  }
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function connectionView(c: ConnectionRow): ConnectionView {
  // A sync left running too long (e.g. the API restarted) is shown as failed.
  const stuck = c.syncStatus === 'syncing' && c.syncStartedAt && Date.now() - c.syncStartedAt.getTime() > SYNC_TIMEOUT_MS;
  return {
    email: c.email,
    status: c.status,
    syncStatus: stuck ? 'failed' : c.syncStatus,
    syncError: stuck ? 'Reading your email took too long. Please try again.' : c.syncError,
    lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
    connectedAt: c.connectedAt.toISOString(),
  };
}

function emailView(r: EmailRow, jobs: Map<string, JobSummary>): InboxEmailView {
  const job = r.jobId ? jobs.get(r.jobId) : undefined;
  const suggest = job && r.suggestionState === 'pending' && worthSuggesting(r.suggestedStatus, job.applicationStatus);
  return {
    id: r.id,
    fromName: r.fromName,
    fromAddress: r.fromAddress,
    subject: r.subject,
    receivedAt: r.receivedAt.toISOString(),
    category: r.category,
    summary: r.summary,
    action: r.action,
    actionDue: r.actionDue,
    company: r.company,
    threadUrl: gmailThreadUrl(r.threadId),
    job: job ? { id: job.id, title: job.title, company: job.company, applicationStatus: job.applicationStatus } : null,
    linkSource: job ? r.linkSource : null,
    suggestion: suggest ? { status: r.suggestedStatus! } : null,
  };
}
