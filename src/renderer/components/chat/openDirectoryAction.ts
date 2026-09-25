import { addToast } from '@/components/ui/toast';
import type { TFunction } from '@/i18n';

export function openDirectoryLabel(platform: string): string {
  if (platform === 'darwin') return 'Open in Finder';
  if (platform === 'win32') return 'Open in File Explorer';
  return 'Open in File Manager';
}

export async function openDirectoryFromMenu(
  request: { projectId: string; conversationId?: string; appId?: string },
  t: TFunction
): Promise<void> {
  try {
    const result = await window.electronAPI.projects.reveal(request);
    if (!result.ok) {
      addToast({
        type: 'error',
        title: t('Could not complete the file action.'),
        description: result.error,
      });
    }
  } catch (error) {
    addToast({
      type: 'error',
      title: t('Could not complete the file action.'),
      description: String(error),
    });
  }
}
