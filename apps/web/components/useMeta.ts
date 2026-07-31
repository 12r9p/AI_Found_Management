"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Meta } from "../lib/types";

const FALLBACK: Meta = {
  categories: ["財布", "かばん", "傘", "スマートフォン", "鍵", "水筒", "眼鏡", "帽子", "衣類", "その他"].map((name) => ({ name })),
  colors: ["黒", "白", "灰", "紺", "青", "赤", "茶", "緑", "その他"].map((name) => ({ name })),
  itemStatuses: ["stored", "returned", "disposed", "transferred"],
  inquiryStatuses: ["open", "matched", "resolved", "closed"],
};

export function useMeta(): Meta {
  const [meta, setMeta] = useState<Meta>(FALLBACK);
  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
  }, []);
  return meta;
}
