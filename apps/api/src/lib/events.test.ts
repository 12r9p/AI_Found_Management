import { describe, expect, test } from "bun:test";
import { EventBus, eventBus, type AppEvent } from "./events.ts";

describe("EventBus", () => {
  test("イベントの購読と発火ができる", () => {
    const bus = new EventBus();
    const received: AppEvent[] = [];

    const unsubscribe = bus.subscribe((event) => {
      received.push(event);
    });

    expect(bus.listenerCount).toBe(1);

    const testEvent: AppEvent = {
      type: "notification",
      data: { id: "notif-1", title: "テスト", body: "本文", type: "match_found" },
    };

    bus.emit(testEvent);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(testEvent);

    unsubscribe();
    expect(bus.listenerCount).toBe(0);
  });

  test("複数のリスナーへ配信され解約も正しく動作する", () => {
    const bus = new EventBus();
    let count1 = 0;
    let count2 = 0;

    const un1 = bus.subscribe(() => count1++);
    const un2 = bus.subscribe(() => count2++);

    bus.emit({ type: "ping", data: { timestamp: "2026-08-09" } });

    expect(count1).toBe(1);
    expect(count2).toBe(1);

    un1();
    bus.emit({ type: "ping", data: { timestamp: "2026-08-09" } });

    expect(count1).toBe(1);
    expect(count2).toBe(2);

    un2();
    expect(bus.listenerCount).toBe(0);
  });

  test("グローバルな eventBus が利用可能", () => {
    expect(eventBus).toBeInstanceOf(EventBus);
  });
});
