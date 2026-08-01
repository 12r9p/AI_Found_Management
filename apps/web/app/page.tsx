"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Card, Badge } from "../components/ui";
import { api } from "../lib/api";

export default function Home() {
  const [health, setHealth] = useState<{ store: string; ai: string } | null>(null);
  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const screens = [
    {
      href: "/register",
      title: "登録",
      desc: "拾得物を撮影・AIタグ付けして登録。スマホ対応。",
      tag: "現場",
    },
    {
      href: "/search",
      title: "探す",
      desc: "特徴のベクトル検索とフィルタで該当物品を照会。",
      tag: "受付",
    },
    {
      href: "/matches",
      title: "照合",
      desc: "問い合わせと遺失物の突き合わせを確認・確定。",
      tag: "受付",
    },
    {
      href: "/admin",
      title: "管理",
      desc: "一覧の直接編集・問い合わせ管理・設定・PDF出力。",
      tag: "スタッフ",
    },
  ];

  return (
    <AppShell>
      <div className="rb-between mb-16">
        <div>
          <div className="rb-eyebrow muted-text">LOST & FOUND / RAWBLOCK</div>
          <h1>遺失物管理システム</h1>
        </div>
        <div className="rb-row">
          <Badge tone={health ? "success" : "error"}>{health ? `API接続 OK` : "API未接続"}</Badge>
          {health && <Badge>STORE: {health.store}</Badge>}
          {health && <Badge>AI: {health.ai}</Badge>}
        </div>
      </div>

      <div className="rb-grid rb-grid--2">
        {screens.map((s) => (
          <Link key={s.href} href={s.href} style={{ textDecoration: "none", color: "inherit" }}>
            <Card variant="interactive" style={{ height: "100%" }}>
              <div className="rb-between">
                <h3>{s.title}</h3>
                <Badge>{s.tag}</Badge>
              </div>
              <p className="rb-small mt-8" style={{ marginBottom: 0 }}>
                {s.desc}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
