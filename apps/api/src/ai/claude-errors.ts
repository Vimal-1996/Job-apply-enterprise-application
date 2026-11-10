import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';

/**
 * A safe message for the user when a Claude call fails for a known reason
 * (the details go to the log), or null for anything else.
 */
export function claudeErrorMessage(e: unknown, logger: Logger, unreadable: string): string | null {
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
    logger.warn(`Claude unavailable: ${(e as Error).message}`);
    return 'The AI service is busy. Please try again in a few minutes.';
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    logger.error(`Claude rejected the API key: ${e.message}`);
    return "The AI service isn't available right now";
  }
  if (e instanceof Anthropic.BadRequestError) {
    // e.g. input Claude can't open, or no API credit left; the log says which.
    logger.error(`Claude rejected the request: ${e.message}`);
    return unreadable;
  }
  return null;
}
