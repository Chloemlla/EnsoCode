import { useSyncExternalStore } from 'react';
import { pluginSlotsVersion, subscribePluginSlots } from './registry';

/** 挂点登记变化时重渲染 */
export function usePluginSlotsVersion(): number {
  return useSyncExternalStore(subscribePluginSlots, pluginSlotsVersion, pluginSlotsVersion);
}
