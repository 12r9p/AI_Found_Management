export type AppEvent =
  | { type: "notification"; data: { id: string; title: string; body: string; type: string } }
  | { type: "match"; data: { matchId: string; itemId: string; inquiryId: string; score: number } }
  | { type: "ping"; data: { timestamp: string } };

type Listener = (event: AppEvent) => void;

export class EventBus {
  private listeners: Set<Listener> = new Set();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: AppEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("EventBus listener error:", err);
      }
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

export const eventBus = new EventBus();
