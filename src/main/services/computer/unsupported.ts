import { ComputerError } from '@shared/computer/errors';
import type { ComputerCapabilities } from '@shared/computer/types';
import type { DesktopBackend } from './backend';

export class UnsupportedDesktopBackend implements DesktopBackend {
  constructor(private readonly platform = process.platform) {}

  async capabilities(): Promise<ComputerCapabilities> {
    return {
      platform: this.platform,
      capture: false,
      input: false,
      ax: false,
      backgroundInput: false,
      clipboard: false,
      capturePermission: 'unsupported',
      inputPermission: 'unsupported',
      axPermission: 'unsupported',
      detail: 'This platform cannot operate the desktop yet.',
    };
  }

  async displays() {
    return [];
  }
  async windows() {
    return [];
  }
  async capture(): Promise<never> {
    throw new ComputerError('unsupported', 'Desktop capture is not available on this platform');
  }
  async click(): Promise<never> {
    throw new ComputerError('unsupported', 'Desktop input is not available on this platform');
  }
  async move(): Promise<never> {
    return this.click();
  }
  async drag(): Promise<never> {
    return this.click();
  }
  async scroll(): Promise<never> {
    return this.click();
  }
  async typeText(): Promise<never> {
    return this.click();
  }
  async keyChord(): Promise<never> {
    return this.click();
  }
  async raise(): Promise<never> {
    return this.click();
  }
  async axSnapshot(): Promise<never> {
    throw new ComputerError('unsupported', 'Accessibility is not available on this platform');
  }
  async axQuery(): Promise<never> {
    return this.axSnapshot();
  }
  async axElementAt() {
    return null;
  }
  async axFocused() {
    return null;
  }
  async axNode(): Promise<never> {
    return this.axSnapshot();
  }
  async axAttributes(): Promise<never> {
    return this.axSnapshot();
  }
  async axChildren(): Promise<never> {
    return this.axSnapshot();
  }
  async axParent() {
    return null;
  }
  async axPerform(): Promise<never> {
    return this.axSnapshot();
  }
  async axSetValue(): Promise<never> {
    return this.axSnapshot();
  }
  async axFocus(): Promise<never> {
    return this.axSnapshot();
  }
  async axClick(): Promise<never> {
    return this.axSnapshot();
  }
  async clipboardRead() {
    return '';
  }
  async clipboardWrite(): Promise<never> {
    throw new ComputerError('unsupported', 'Clipboard is not available on this platform');
  }
}
