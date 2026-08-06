import type { Inquiry, Item, Match } from "./types.ts";

/** DB・Vectorize内部だけで使うembeddingを公開APIから除外する。 */
export function toItemDto<T extends Item>(item: T): Omit<T, "embedding"> {
  const { embedding: _embedding, ...dto } = item;
  return dto;
}

/** DB・Vectorize内部だけで使うembeddingを公開APIから除外する。 */
export function toInquiryDto<T extends Inquiry>(inquiry: T): Omit<T, "embedding"> {
  const { embedding: _embedding, ...dto } = inquiry;
  return dto;
}

export function toMatchDto(match: Match): Match {
  return { ...match };
}
