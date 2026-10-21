import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, type Features } from "./api-client";

/**
 * 標準機能のリンクは常に出し、任意拡張のリンクは`/api/session`でONと分かってから出す。
 * SSR・事前生成のHTMLと取得失敗時は隠したままにする。URLを直接開いた場合の表示は各画面が判断する。
 */
export function SiteNav() {
  const [features, setFeatures] = useState<Partial<Features>>({});
  useEffect(() => {
    let isMounted = true;
    api<{ features: Features }>("/api/session")
      .then((session) => {
        if (isMounted) setFeatures(session.features);
      })
      .catch(() => undefined);
    return () => {
      isMounted = false;
    };
  }, []);
  return (
    <nav className="site-nav" aria-label="メインナビゲーション">
      <Link to="/help">はじめに</Link>
      <Link to="/app">AIチャット</Link>
      {features.decisions && <Link to="/decisions">依頼の分類</Link>}
      {features.media && <Link to="/media">画像と素材</Link>}
    </nav>
  );
}
