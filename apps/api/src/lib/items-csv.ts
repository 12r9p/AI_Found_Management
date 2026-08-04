import type { Store } from "../store/index.ts";
import { MAX_ITEM_PAGE_LIMIT } from "../store/item-pagination.ts";
import type { Item, SearchFilters } from "../types.ts";

const CSV_HEADER = [
  "id",
  "status",
  "category",
  "color",
  "brand",
  "found_location",
  "map_pin",
  "found_at",
  "ai_description",
  "tags",
  "created_at",
];

export function escapeCsvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function itemToCsvRow(item: Item): string {
  const mapPin =
    item.found_x != null && item.found_y != null
      ? `${(item.found_x * 100).toFixed(1)}%,${(item.found_y * 100).toFixed(1)}%`
      : "";
  return [
    item.id,
    item.status,
    item.category,
    item.color,
    item.brand,
    item.found_location,
    mapPin,
    item.found_at ?? "",
    item.ai_description,
    item.tags.join(";"),
    item.created_at,
  ]
    .map(escapeCsvCell)
    .join(",");
}

export function createItemsCsvStream(
  store: Store,
  filters: SearchFilters,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cursor: string | undefined;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`﻿${CSV_HEADER.join(",")}\n`));
    },
    async pull(controller) {
      try {
        const page = await store.listItems(filters, {
          cursor,
          limit: MAX_ITEM_PAGE_LIMIT,
        });
        if (cancelled) return;
        if (page.nextCursor && page.nextCursor === cursor) {
          controller.error(new Error("item_pagination_stalled"));
          return;
        }
        if (page.items.length > 0) {
          controller.enqueue(encoder.encode(`${page.items.map(itemToCsvRow).join("\n")}\n`));
        }
        cursor = page.nextCursor ?? undefined;
        if (!cursor) controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      cancelled = true;
    },
  });
}
