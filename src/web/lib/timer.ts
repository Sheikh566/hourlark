export function broadcastTimerChange(): void {
  const channel = new BroadcastChannel("iomechs-time-timer");
  channel.postMessage({ changed: Date.now() });
  channel.close();
}
