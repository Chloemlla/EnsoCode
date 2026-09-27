import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AskUserView } from '@/stores/sessions/timeline';
import { AskUserResult } from './AskUserResult';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => `[${key}]` }) }));

const render = (over: Partial<AskUserView> = {}, waiting = false): string =>
  renderToStaticMarkup(
    createElement(AskUserResult, {
      ask: {
        question: '用哪个方案？',
        options: ['方案 A', '方案 B'],
        answer: null,
        autoSelected: false,
        ...over,
      },
      waiting,
    })
  );

/** 所有被标为选中的行的文字 */
const selectedRows = (html: string): string[] =>
  [...html.matchAll(/<li data-selected="true"[^>]*>([\s\S]*?)<\/li>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, '')
  );

describe('AskUserResult', () => {
  it('选了某个选项：列出当时全部选项，只高亮选中的那个', () => {
    const html = render({ answer: '方案 B' });

    expect(html).toContain('用哪个方案？');
    expect(html).toContain('方案 A');
    expect(selectedRows(html)).toEqual(['方案 B[Selected]']);
    expect(html).not.toContain('[Custom answer]');
  });

  it('自定义回答：选项都不选中，回答单独列在最后', () => {
    const html = render({ answer: '都不要，用 C' });

    expect(selectedRows(html)).toEqual(['[Custom answer]都不要，用 C[Selected]']);
    expect(html).toContain('方案 A');
    expect(html).toContain('方案 B');
  });

  it('没有选项的自由问答：只列问题与回答，不标自定义', () => {
    const html = render({ options: [], answer: 'enso' });

    expect(selectedRows(html)).toEqual(['enso[Selected]']);
    expect(html).not.toContain('[Custom answer]');
  });

  it('超时自动选择：注明是自动选的默认项，而不是用户的回答', () => {
    const picked = render({ answer: '方案 A', autoSelected: true });
    expect(selectedRows(picked)).toEqual(['方案 A[Selected]']);
    expect(picked).toContain('[No answer in time; the default was selected]');

    const custom = render({ answer: '稍后再说', autoSelected: true });
    expect(selectedRows(custom)).toEqual(['稍后再说[Selected]']);
    expect(custom).not.toContain('[Custom answer]');
  });

  it('等待回答：提示等待中，没有任何选中项', () => {
    const html = render({}, true);

    expect(html).toContain('[Waiting for your answer]');
    expect(selectedRows(html)).toEqual([]);
    expect(html).toContain('方案 A');
  });
});
