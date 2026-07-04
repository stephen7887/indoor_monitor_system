"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

// 다크(관제 기본) ↔ 라이트(야외 시인성). layout.tsx 인라인 스크립트가 초기값을 세팅.
export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setTheme(
      document.documentElement.dataset.theme === "light" ? "light" : "dark",
    );
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // localStorage 차단 환경(사파리 프라이빗 등)에서도 토글 자체는 동작
    }
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        theme === "dark" ? "라이트 테마로 전환 (야외)" : "다크 테마로 전환 (관제)"
      }
      className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-edge bg-surface text-fg transition-colors duration-200 hover:bg-surface-2"
    >
      {theme === "dark" ? (
        <Sun className="h-5 w-5" aria-hidden />
      ) : (
        <Moon className="h-5 w-5" aria-hidden />
      )}
    </button>
  );
}
