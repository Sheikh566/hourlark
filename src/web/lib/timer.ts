export function broadcastTimerChange(): void {
  const channel = new BroadcastChannel("hourlark-timer");
  channel.postMessage({ changed: Date.now() });
  channel.close();
}
