import { fillForm } from './fill/fields';
import { jobFromPage } from './fill/sites';
import type { DetectReply, FillReply, ToContent } from './messages';

/*
 * Runs on Greenhouse and Lever pages (including Greenhouse forms embedded on
 * company sites). Reads the job and fills the form when the side panel asks.
 * It never submits anything. Frames without a job or form stay silent, so the
 * panel hears from the right one.
 */

const MIN_DESCRIPTION = 200;
const hasForm = () => document.querySelector('form input, form textarea') !== null;

async function detect(): Promise<DetectReply | null> {
  const job = jobFromPage(document, location.href);
  if (!job) return null;
  // Lever's /apply page shows no description: read it from the posting page (same site).
  if (job.description.length < MIN_DESCRIPTION && job.url !== location.href.split(/[?#]/)[0]) {
    try {
      const html = await (await fetch(job.url, { credentials: 'omit' })).text();
      const posting = jobFromPage(new DOMParser().parseFromString(html, 'text/html'), job.url);
      if (posting && posting.description.length > job.description.length) job.description = posting.description;
    } catch {
      /* keep what we have */
    }
  }
  return { job, hasForm: hasForm() };
}

chrome.runtime.onMessage.addListener((msg: ToContent, _sender, sendResponse) => {
  if (msg.type === 'detect') {
    if (!jobFromPage(document, location.href)) return false;
    void detect().then(sendResponse);
    return true;
  }
  if (msg.type === 'fill') {
    if (!hasForm()) return false;
    const reply: FillReply = { report: fillForm(document, msg.data, msg.resume) };
    sendResponse(reply);
    return false;
  }
  return false;
});
