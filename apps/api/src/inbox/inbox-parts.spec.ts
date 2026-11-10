import { statusForCategory, tidyVerdicts, worthSuggesting } from './email.schema';
import { jobEmailQuery, pkcePair } from './gmail-api';
import { bodyText, gmailThreadUrl, htmlToText, parseFrom, parseMessage } from './gmail-message';
import { openState, sealState, TokenCrypto } from './token-crypto';
import { createHash } from 'crypto';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('Gmail messages', () => {
  it('reads sender names and addresses', () => {
    expect(parseFrom('"Acme Recruiting" <Jobs@Acme.com>')).toEqual({ name: 'Acme Recruiting', address: 'jobs@acme.com' });
    expect(parseFrom('no-reply@greenhouse.io')).toEqual({ name: null, address: 'no-reply@greenhouse.io' });
  });

  it('turns HTML email into readable text', () => {
    const html = '<html><head><style>p{color:red}</style></head><body><p>Hi Jane,</p><p>Thanks&nbsp;for applying &amp; good luck.</p><ul><li>Step 1</li><li>Step 2</li></ul><script>x()</script></body></html>';
    expect(htmlToText(html)).toBe("Hi Jane,\nThanks for applying & good luck.\n• Step 1\n• Step 2");
  });

  it('prefers the plain-text part and skips attachments', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', filename: 'notes.txt', body: { data: b64('attachment text') } },
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/html', body: { data: b64('<p>HTML version</p>') } },
            { mimeType: 'text/plain', body: { data: b64('Plain version\r\nLine 2') } },
          ],
        },
      ],
    };
    expect(bodyText(payload)).toBe('Plain version\nLine 2');
    expect(bodyText({ mimeType: 'text/html', body: { data: b64('<b>Only</b> HTML') } })).toBe('Only HTML');
  });

  it('parses a whole message', () => {
    const m = parseMessage({
      id: 'm1',
      threadId: 't1',
      internalDate: String(Date.UTC(2026, 10, 1, 12)),
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'Acme <jobs@acme.com>' },
          { name: 'Subject', value: ' Interview invitation ' },
          { name: 'Message-ID', value: '<abc@acme.com>' },
        ],
        body: { data: b64('Please pick a time.') },
      },
    });
    expect(m).toMatchObject({ gmailId: 'm1', threadId: 't1', fromName: 'Acme', fromAddress: 'jobs@acme.com', subject: 'Interview invitation', messageIdHeader: '<abc@acme.com>', text: 'Please pick a time.' });
    expect(m.receivedAt.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(gmailThreadUrl('t1')).toBe('https://mail.google.com/mail/u/0/#all/t1');
  });
});

describe('Gmail search and sign-in', () => {
  it('searches 60 days at first, then from a point in time, never the user\'s own mail', () => {
    const first = jobEmailQuery({ days: 60 });
    expect(first.startsWith('newer_than:60d -from:me -in:chats {')).toBe(true);
    expect(first).toContain('from:greenhouse.io');
    expect(first).toContain('subject:(application OR');
    expect(jobEmailQuery({ days: 60, after: 1_700_000_000.7 }).startsWith('after:1700000000 ')).toBe(true);
  });

  it('makes a PKCE pair whose challenge is the S256 hash of the verifier', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });
});

describe('TokenCrypto', () => {
  const crypto = new TokenCrypto(Buffer.alloc(32, 1));

  it('round-trips, and refuses tampering or another key', () => {
    const sealed = crypto.seal('refresh-token');
    expect(sealed).not.toContain('refresh-token');
    expect(crypto.open(sealed)).toBe('refresh-token');
    const bad = Buffer.from(sealed, 'base64url');
    bad[bad.length - 1] ^= 1;
    expect(crypto.open(bad.toString('base64url'))).toBeNull();
    expect(new TokenCrypto(Buffer.alloc(32, 2)).open(sealed)).toBeNull();
    expect(crypto.open('short')).toBeNull();
  });

  it('seals the connect state and refuses it once expired', () => {
    const state = sealState(crypto, { userId: 'u1', verifier: 'v', exp: 2_000 });
    expect(openState(crypto, state, 1_000)).toEqual({ userId: 'u1', verifier: 'v', exp: 2_000 });
    expect(openState(crypto, state, 3_000)).toBeNull();
    expect(openState(crypto, 'nonsense', 1_000)).toBeNull();
  });
});

describe('email verdicts', () => {
  const v = (over: object) => ({ ref: 1, category: 'interview' as const, summary: 'Invite.', action: null, actionDue: null, company: 'Acme', jobRef: 1, ...over });

  it('keeps one verdict per real email, with valid job references and dates', () => {
    const out = tidyVerdicts(
      {
        emails: [
          v({ ref: 1, actionDue: '2026-11-20' }),
          v({ ref: 1, summary: 'duplicate' }),
          v({ ref: 2, jobRef: 9, actionDue: 'next Friday' }),
          v({ ref: 3, category: 'not_job', summary: 'spam', action: 'Click here', jobRef: 1 }),
          v({ ref: 7 }),
        ],
      },
      3,
      2,
    );
    expect([...out.keys()]).toEqual([1, 2, 3]);
    expect(out.get(1)).toMatchObject({ summary: 'Invite.', actionDue: '2026-11-20', jobRef: 1 });
    expect(out.get(2)).toMatchObject({ jobRef: null, actionDue: null });
    expect(out.get(3)).toMatchObject({ summary: '', action: null, jobRef: null });
  });

  it('maps email kinds to stages, and only suggests moving forward', () => {
    expect(statusForCategory('application_received')).toBe('applied');
    expect(statusForCategory('assessment')).toBe('interviewing');
    expect(statusForCategory('job_alert')).toBeNull();
    expect(worthSuggesting('interviewing', 'applied')).toBe(true);
    expect(worthSuggesting('applied', 'interviewing')).toBe(false);
    expect(worthSuggesting('interviewing', 'interviewing')).toBe(false);
    expect(worthSuggesting('rejected', 'interviewing')).toBe(true);
    expect(worthSuggesting('rejected', 'offer')).toBe(false);
    expect(worthSuggesting('offer', 'withdrawn')).toBe(false);
    expect(worthSuggesting(null, 'saved')).toBe(false);
  });
});
