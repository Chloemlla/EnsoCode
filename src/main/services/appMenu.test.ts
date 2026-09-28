import { describe, expect, it } from 'vitest';

import { APP_DISPLAY_NAME, macAppMenuTemplate } from './appMenu';

describe('macAppMenuTemplate', () => {
  it('labels app menu items with the product name instead of the package name', () => {
    const [appMenu] = macAppMenuTemplate();
    expect(appMenu.label).toBe(APP_DISPLAY_NAME);
    const items = appMenu.submenu as { role?: string; label?: string }[];
    const labelOf = (role: string) => items.find((item) => item.role === role)?.label;
    expect(labelOf('about')).toBe('About EnsoCode');
    expect(labelOf('hide')).toBe('Hide EnsoCode');
    expect(labelOf('quit')).toBe('Quit EnsoCode');
    expect(JSON.stringify(macAppMenuTemplate())).not.toContain('enso-code');
  });

  it('keeps the remaining default top-level menus', () => {
    expect(macAppMenuTemplate().slice(1)).toEqual([
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]);
  });
});
