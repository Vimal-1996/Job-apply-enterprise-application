/*
 * Reads a Gmail API message (format=full) into the few fields the inbox uses.
 * The body is only ever held in memory: it's sent to Claude to summarize, or
 * shown to the user when they open the email, and never stored.
 */

/** The parts of the Gmail API's message resource we read. */
export interface GmailRawMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

export interface EmailMessage {
  gmailId: string;
  threadId: string;
  fromName: string | null;
  fromAddress: string;
  to: string | null;
  subject: string;
  receivedAt: Date;
  /** The email's Message-ID and References headers, for replying in the same thread. */
  messageIdHeader: string | null;
  references: string | null;
  text: string;
}

export function header(part: GmailPart | undefined, name: string): string | null {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

/** `"Jane Recruiter" <jane@acme.com>` → { name: 'Jane Recruiter', address: 'jane@acme.com' }. */
export function parseFrom(raw: string | null): { name: string | null; address: string } {
  const s = (raw ?? '').trim();
  const m = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(s);
  if (m) {
    const name = m[1].trim().replace(/^"(.*)"$/, '$1').trim();
    return { name: name || null, address: m[2].toLowerCase() };
  }
  return { name: null, address: s.toLowerCase() };
}

const decode = (data: string) => Buffer.from(data, 'base64url').toString('utf8');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** HTML email → readable plain text (layout-ish line breaks, no tags, no styles or scripts). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|table|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (all, e: string) => {
      const k = e.toLowerCase();
      if (k in ENTITIES) return ENTITIES[k];
      if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)));
      return all;
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The first text/plain part (not an attachment), else the first text/html part as text. */
export function bodyText(payload: GmailPart | undefined): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: GmailPart | undefined) => {
    if (!p) return;
    if (!p.filename && p.body?.data) {
      if (p.mimeType === 'text/plain') plain.push(decode(p.body.data));
      else if (p.mimeType === 'text/html') html.push(decode(p.body.data));
    }
    p.parts?.forEach(walk);
  };
  walk(payload);
  if (plain.length) return plain[0].replace(/\r\n/g, '\n').trim();
  if (html.length) return htmlToText(html[0]);
  return '';
}

export function parseMessage(m: GmailRawMessage): EmailMessage {
  const from = parseFrom(header(m.payload, 'From'));
  const date = m.internalDate ? new Date(Number(m.internalDate)) : new Date(header(m.payload, 'Date') ?? Date.now());
  return {
    gmailId: m.id,
    threadId: m.threadId,
    fromName: from.name,
    fromAddress: from.address,
    to: header(m.payload, 'To'),
    subject: (header(m.payload, 'Subject') ?? '').trim() || '(no subject)',
    receivedAt: Number.isNaN(date.getTime()) ? new Date() : date,
    messageIdHeader: header(m.payload, 'Message-ID') ?? header(m.payload, 'Message-Id'),
    references: header(m.payload, 'References'),
    text: bodyText(m.payload) || (m.snippet ?? ''),
  };
}

/** The Gmail web address of a thread (works whether or not it's still in the inbox). */
export const gmailThreadUrl = (threadId: string) => `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
