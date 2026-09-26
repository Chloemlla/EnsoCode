import { describe, expect, it } from 'vitest';
import { easeOutLayout, springStandard } from '@/lib/motion';
import { shouldSkipSidePanelWidthAnim, sidePanelWidthTransition } from './sidePanelWidthAnim';

describe('shouldSkipSidePanelWidthAnim', () => {
  it('首次挂载不跳过', () => {
    expect(shouldSkipSidePanelWidthAnim({ resizing: false, conversationId: 'a' })).toBe(false);
  });

  it('拖拽改宽时跳过动画', () => {
    expect(shouldSkipSidePanelWidthAnim({ resizing: true, conversationId: 'a' })).toBe(true);
  });

  it('同一会话开关/全屏不跳过，留给 spring', () => {
    expect(
      shouldSkipSidePanelWidthAnim({
        resizing: false,
        conversationId: 'a',
        previousConversationId: 'a',
      })
    ).toBe(false);
  });

  it('换会话跳过：宽度立切，聊天区不被 spring 拖着重测', () => {
    expect(
      shouldSkipSidePanelWidthAnim({
        resizing: false,
        conversationId: 'b',
        previousConversationId: 'a',
      })
    ).toBe(true);
  });
});

describe('sidePanelWidthTransition', () => {
  it('跳过动画时立切', () => {
    expect(sidePanelWidthTransition({ skip: true, cover: false, targetW: 0 })).toEqual({
      duration: 0,
    });
  });

  it('收起到 0 用无过冲 tween：width 冲到负值会被丢弃，末段卡住再突然收回', () => {
    expect(sidePanelWidthTransition({ skip: false, cover: false, targetW: 0 })).toBe(easeOutLayout);
  });

  it('全屏铺开/退出用 tween', () => {
    expect(sidePanelWidthTransition({ skip: false, cover: true, targetW: 1200 })).toBe(
      easeOutLayout
    );
  });

  it('打开保持 spring', () => {
    expect(sidePanelWidthTransition({ skip: false, cover: false, targetW: 360 })).toBe(
      springStandard
    );
  });
});
