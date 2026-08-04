import type { Item } from "../types.ts";

export const DEFAULT_ITEM_PAGE_LIMIT = 100;
export const MAX_ITEM_PAGE_LIMIT = 200;

export interface ItemListOptions {
  cursor?: ItemCursorPosition;
  limit?: number;
}

export interface ItemPage {
  items: Item[];
  nextCursor: ItemCursorPosition | null;
}

export interface ItemCursorPosition {
  createdAt: string;
  id: string;
}

export class InvalidItemCursorError extends Error {
  constructor() {
    super("invalid_cursor");
    this.name = "InvalidItemCursorError";
  }
}

export class InvalidItemLimitError extends Error {
  constructor() {
    super("invalid_limit");
    this.name = "InvalidItemLimitError";
  }
}

export function normalizeItemPageLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_ITEM_PAGE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new InvalidItemLimitError();
  return Math.min(limit, MAX_ITEM_PAGE_LIMIT);
}

export function parseItemPageLimit(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new InvalidItemLimitError();
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit)) throw new InvalidItemLimitError();
  if (limit > MAX_ITEM_PAGE_LIMIT) throw new InvalidItemLimitError();
  return limit;
}

export function itemCursorFromItem(item: Pick<Item, "created_at" | "id">): ItemCursorPosition {
  return { createdAt: item.created_at, id: item.id };
}

export function isItemCursorPosition(value: unknown): value is ItemCursorPosition {
  if (!value || typeof value !== "object") return false;
  const cursor = value as Record<string, unknown>;
  return (
    typeof cursor.createdAt === "string" &&
    isCanonicalCursorDate(cursor.createdAt) &&
    typeof cursor.id === "string" &&
    cursor.id.length > 0
  );
}

export function parseItemCursor(value: unknown): ItemCursorPosition {
  if (!isItemCursorPosition(value)) throw new InvalidItemCursorError();
  return { createdAt: value.createdAt, id: value.id };
}

function isCanonicalCursorDate(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

export function isItemAfterCursor(
  item: Pick<Item, "created_at" | "id">,
  cursor: ItemCursorPosition,
): boolean {
  return (
    item.created_at < cursor.createdAt ||
    (item.created_at === cursor.createdAt && item.id < cursor.id)
  );
}

export function itemCursorsEqual(
  left: ItemCursorPosition | null | undefined,
  right: ItemCursorPosition | null | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.createdAt === right.createdAt && left.id === right.id;
}

export function compareItemsNewestFirst(
  a: Pick<Item, "created_at" | "id">,
  b: Pick<Item, "created_at" | "id">,
): number {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id > b.id ? -1 : 1;
}

export function toItemPage(items: Item[], limit: number): ItemPage {
  const hasNextPage = items.length > limit;
  const pageItems = hasNextPage ? items.slice(0, limit) : items;
  return {
    items: pageItems,
    nextCursor: hasNextPage ? itemCursorFromItem(pageItems[pageItems.length - 1]!) : null,
  };
}
