let leader = true;
const listeners = new Set<(leader: boolean) => void>();

const remote = typeof window === 'undefined' ? undefined : window.electronAPI?.remote;
if (remote) {
  leader = remote.isLeader();
  remote.onLeaderChanged((next) => {
    leader = next;
    for (const listener of listeners) listener(next);
  });
}

export function isLeaderRenderer(): boolean {
  return leader;
}

export function onLeaderRendererChanged(listener: (leader: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
