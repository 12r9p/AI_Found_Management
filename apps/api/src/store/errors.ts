export const DUPLICATE_DISPLAY_ID_ERROR = "duplicate_display_id";

/** 管理番号の一意制約違反をStore実装間で揃えるエラー。 */
export class DuplicateDisplayIdError extends Error {
  readonly code = DUPLICATE_DISPLAY_ID_ERROR;

  constructor(options?: ErrorOptions) {
    super(DUPLICATE_DISPLAY_ID_ERROR, options);
    this.name = "DuplicateDisplayIdError";
  }
}

/** D1が返すSQLite一意制約エラーのうち、管理番号の競合だけをドメインエラーへ変換する。 */
export function mapDisplayIdWriteError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("UNIQUE constraint failed: items.display_id") ||
    message.includes("items_display_id_unique_idx")
  ) {
    return new DuplicateDisplayIdError({ cause: error });
  }
  return error;
}
