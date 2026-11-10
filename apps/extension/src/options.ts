import { checkSettings, DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './config';
import { signOut } from './auth';

const field = (id: keyof Settings) => document.getElementById(id) as HTMLInputElement;
const status = document.getElementById('status')!;

async function show(s: Settings) {
  for (const k of Object.keys(s) as (keyof Settings)[]) field(k).value = s[k];
}

document.getElementById('form')!.addEventListener('submit', async (e) => {
  e.preventDefault();
  const checked = checkSettings({ apiUrl: field('apiUrl').value, cognitoDomain: field('cognitoDomain').value, clientId: field('clientId').value });
  if ('error' in checked) {
    status.textContent = checked.error;
    status.className = 'error';
    return;
  }
  const before = await loadSettings();
  await saveSettings(checked);
  // Tokens from another environment are no use here.
  if (before.cognitoDomain !== checked.cognitoDomain || before.clientId !== checked.clientId) await signOut();
  await show(checked);
  status.textContent = 'Saved.';
  status.className = 'ok';
});

document.getElementById('reset')!.addEventListener('click', () => void show(DEFAULT_SETTINGS));
document.getElementById('redirect')!.textContent = chrome.identity.getRedirectURL();
void loadSettings().then(show);
