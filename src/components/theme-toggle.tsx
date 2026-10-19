import { useEffect, useState } from "react";

type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "theme";
const ORDER: ThemePreference[] = ["system", "light", "dark"];
const LABELS: Record<ThemePreference, string> = {
  system: "自動",
  light: "ライト",
  dark: "ダーク",
};

// hydration前に固定テーマを反映し、ダーク表示での白いちらつきを防ぐ。
// 保存値がない・読めない場合はOS設定に従う（data-themeを付けない）。
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function applyPreference(preference: ThemePreference) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  if (preference === "system") delete root.dataset.theme;
  else root.dataset.theme = preference;
  // スタイルの再計算を確定させてから transition を戻す。
  void root.offsetHeight;
  requestAnimationFrame(() => root.classList.remove("theme-switching"));
  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // 保存できない環境でも、表示中のページには反映する。
  }
}

export function ThemeToggle() {
  // SSRとの一致のため初回は「自動」で描画し、マウント後に実際の値へ合わせる。
  const [preference, setPreference] = useState<ThemePreference>("system");
  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (isThemePreference(current)) setPreference(current);
  }, []);

  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length];
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`表示テーマ：${LABELS[preference]}。押すと${LABELS[next]}に切り替えます`}
      onClick={() => {
        applyPreference(next);
        setPreference(next);
      }}
    >
      <ThemeIcon preference={preference} />
      <span className="theme-toggle-label">{LABELS[preference]}</span>
    </button>
  );
}

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      {preference === "light" ? (
        <>
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
        </>
      ) : preference === "dark" ? (
        <path d="M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7Z" />
      ) : (
        <>
          <circle cx="8" cy="8" r="5.75" />
          <path d="M8 2.25v11.5A5.75 5.75 0 0 0 8 2.25Z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}
