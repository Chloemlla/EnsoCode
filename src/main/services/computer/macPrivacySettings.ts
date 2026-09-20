import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function macPrivacySettingsUrls(kind: 'screen' | 'accessibility'): string[] {
  const pane = kind === 'screen' ? 'Privacy_ScreenCapture' : 'Privacy_Accessibility';
  return [
    `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?${pane}`,
    `x-apple.systempreferences:com.apple.preference.security?${pane}`,
  ];
}

export async function openMacPrivacySettings(
  kind: 'screen' | 'accessibility',
  openUrl: (url: string) => Promise<void> = (url) =>
    execFileAsync('/usr/bin/open', [url]).then(() => undefined)
): Promise<void> {
  const urls = macPrivacySettingsUrls(kind);
  let lastError: unknown;
  for (const url of urls) {
    try {
      await openUrl(url);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to open privacy settings');
}
