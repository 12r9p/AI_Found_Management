import type { Item } from "./types";
import { itemCursorsEqual, type ItemCursor, type ItemPage } from "./api";

const ALL_ITEMS_PAGE_LIMIT = 200;

export type ItemPageLoader = (query: Record<string, string>) => Promise<ItemPage>;

export async function fetchAllItems(
  loadPage: ItemPageLoader,
  query: Record<string, string> = {},
  onProgress?: (itemsLoaded: number) => void,
): Promise<Item[]> {
  const filters = { ...query };
  delete filters.cursor;
  delete filters.cursorCreatedAt;
  delete filters.cursorId;
  delete filters.limit;

  const items: Item[] = [];
  let cursor: ItemCursor | undefined;
  do {
    const pageQuery: Record<string, string> = {
      ...filters,
      limit: String(ALL_ITEMS_PAGE_LIMIT),
    };
    if (cursor) {
      pageQuery.cursorCreatedAt = cursor.createdAt;
      pageQuery.cursorId = cursor.id;
    }
    const page = await loadPage(pageQuery);
    items.push(...page.items);
    onProgress?.(items.length);
    if (page.nextCursor && itemCursorsEqual(page.nextCursor, cursor)) {
      throw new Error("item_pagination_stalled");
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return items;
}
