import { Logger, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { loadConfig } from '../config/config';
import { PG_POOL } from '../db/database.module';
import { JobsModule } from '../jobs/jobs.module';
import { ClaudeEmailClassifier, EMAIL_CLASSIFIER } from './email-classifier';
import { GMAIL_API, GoogleGmailApi } from './gmail-api';
import { InboxStore } from './inbox-store';
import { InboxController } from './inbox.controller';
import { INBOX_STORE, InboxService, TOKEN_CRYPTO } from './inbox.service';
import { TokenCrypto } from './token-crypto';

/** Job emails from the user's Gmail, summarized by Claude and linked to their jobs. */
@Module({
  imports: [JobsModule],
  controllers: [InboxController],
  providers: [
    InboxService,
    { provide: INBOX_STORE, inject: [PG_POOL], useFactory: (pool: Pool) => new InboxStore(pool) },
    {
      provide: TOKEN_CRYPTO,
      useFactory: () => {
        const { gmail } = loadConfig();
        if (gmail.tokenKey) return new TokenCrypto(gmail.tokenKey);
        if (gmail.enabled) new Logger('Inbox').warn('No GMAIL_TOKEN_KEY: Gmail connections will not survive a restart (local development only)');
        return TokenCrypto.ephemeral();
      },
    },
    {
      provide: GMAIL_API,
      // No Google client configured: the inbox says so.
      useFactory: () => {
        const { gmail } = loadConfig();
        return gmail.enabled ? new GoogleGmailApi(gmail) : null;
      },
    },
    {
      provide: EMAIL_CLASSIFIER,
      useFactory: () => {
        const { ai } = loadConfig();
        return ai.enabled ? new ClaudeEmailClassifier(ai.emailModel) : null;
      },
    },
  ],
})
export class InboxModule {}
