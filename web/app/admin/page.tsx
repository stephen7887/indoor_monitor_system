"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  Flame,
  LoaderCircle,
  LogOut,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import type { Firefighter } from "@/lib/types";

// AA:BB:CC:DD:EE:FF — 저장 시 대문자로 정규화
const MAC_RE = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;

function normalizeMac(raw: string): string | null {
  const mac = raw.trim();
  return MAC_RE.test(mac) ? mac.toUpperCase() : null;
}

export default function AdminPage() {
  if (!supabaseConfigured) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-base text-muted">
          Supabase 환경변수(web/.env.local)를 먼저 설정하세요.
        </p>
      </div>
    );
  }
  return <Admin />;
}

function Admin() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-edge bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Flame className="h-7 w-7 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold leading-tight">
                대원 관리
              </h1>
              <p className="truncate text-sm font-medium text-muted">
                비콘 태그 등록 · 수정
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm font-bold hover:bg-surface-2"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              대시보드
            </Link>
            {session && (
              <button
                type="button"
                onClick={() => supabase?.auth.signOut()}
                className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm font-bold text-muted hover:bg-surface-2"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                로그아웃
              </button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-4 lg:px-6 lg:py-6">
        {!authReady ? (
          <p className="flex items-center gap-2 text-base text-muted">
            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
            인증 상태 확인 중…
          </p>
        ) : session ? (
          <Manager userEmail={session.user.email ?? ""} />
        ) : (
          <LoginForm />
        )}
      </main>
    </div>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setPending(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (err)
      setError(
        err.message === "Invalid login credentials"
          ? "이메일 또는 비밀번호가 올바르지 않습니다."
          : err.message,
      );
    setPending(false);
  }

  return (
    <div className="mx-auto max-w-md rounded-xl border border-edge bg-surface p-6">
      <h2 className="text-lg font-bold">관리자 로그인</h2>
      <p className="mt-1 text-sm text-muted">
        대원 정보 추가·수정은 로그인한 관리자만 가능합니다.
      </p>
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-muted">
            이메일
          </span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-base"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-muted">
            비밀번호
          </span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-base"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-info px-4 py-2.5 text-base font-bold text-bg disabled:opacity-60"
        >
          {pending ? "로그인 중…" : "로그인"}
        </button>
      </form>
    </div>
  );
}

function Manager({ userEmail }: { userEmail: string }) {
  const [rows, setRows] = useState<Firefighter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!supabase) return;
    const { data, error: err } = await supabase
      .from("firefighters")
      .select("*")
      .order("created_at", { ascending: true });
    if (err) setError(err.message);
    else {
      setRows((data as Firefighter[]) ?? []);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        <span className="font-bold">{userEmail}</span> 계정으로 로그인됨
      </p>
      {error && (
        <div
          role="alert"
          className="rounded-lg border-2 border-danger bg-danger-bg px-4 py-3 text-base font-medium"
        >
          오류: {error}
        </div>
      )}
      <AddForm onAdded={reload} />
      <RosterTable rows={rows} loading={loading} onChanged={reload} />
    </div>
  );
}

function AddForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [mac, setMac] = useState("");
  const [team, setTeam] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const tagMac = normalizeMac(mac);
    if (!tagMac) {
      setError("태그 MAC은 AA:BB:CC:DD:EE:FF 형식이어야 합니다.");
      return;
    }
    setPending(true);
    setError(null);
    const { error: err } = await supabase.from("firefighters").insert({
      name: name.trim(),
      tag_mac: tagMac,
      team: team.trim() || null,
    });
    if (err) {
      setError(
        err.code === "23505"
          ? `이미 등록된 태그 MAC입니다: ${tagMac}`
          : err.message,
      );
    } else {
      setName("");
      setMac("");
      setTeam("");
      onAdded();
    }
    setPending(false);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-edge bg-surface p-4"
    >
      <h2 className="text-base font-bold">대원 추가</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1.2fr_1fr_auto]">
        <input
          required
          placeholder="이름"
          aria-label="이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg border border-edge bg-bg px-3 py-2 text-base"
        />
        <input
          required
          placeholder="태그 MAC (AA:BB:CC:DD:EE:FF)"
          aria-label="태그 MAC"
          value={mac}
          onChange={(e) => setMac(e.target.value)}
          className="rounded-lg border border-edge bg-bg px-3 py-2 font-mono text-base"
        />
        <input
          placeholder="팀 (선택)"
          aria-label="팀"
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="rounded-lg border border-edge bg-bg px-3 py-2 text-base"
        />
        <button
          type="submit"
          disabled={pending}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-info px-4 py-2 text-base font-bold text-bg disabled:opacity-60"
        >
          <Plus className="h-5 w-5" aria-hidden />
          추가
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

function RosterTable({
  rows,
  loading,
  onChanged,
}: {
  rows: Firefighter[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function toggleActive(row: Firefighter) {
    if (!supabase) return;
    const { error: err } = await supabase
      .from("firefighters")
      .update({ active: !row.active })
      .eq("id", row.id);
    if (err) setError(err.message);
    else {
      setError(null);
      onChanged();
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-edge bg-surface">
      <table className="w-full min-w-[640px] text-left text-base">
        <thead>
          <tr className="border-b border-edge text-sm font-bold text-muted">
            <th className="px-4 py-3">이름</th>
            <th className="px-4 py-3">태그 MAC</th>
            <th className="px-4 py-3">팀</th>
            <th className="px-4 py-3">상태</th>
            <th className="px-4 py-3 text-right">수정</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-muted">
                불러오는 중…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-muted">
                등록된 대원이 없습니다.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <RosterRow
                key={row.id}
                row={row}
                onToggle={() => toggleActive(row)}
                onSaved={onChanged}
              />
            ))
          )}
        </tbody>
      </table>
      {error && (
        <p role="alert" className="px-4 py-3 text-sm font-medium text-danger">
          오류: {error}
        </p>
      )}
    </div>
  );
}

function RosterRow({
  row,
  onToggle,
  onSaved,
}: {
  row: Firefighter;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.name);
  const [mac, setMac] = useState(row.tag_mac);
  const [team, setTeam] = useState(row.team ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setName(row.name);
    setMac(row.tag_mac);
    setTeam(row.team ?? "");
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (!supabase) return;
    const tagMac = normalizeMac(mac);
    if (!tagMac) {
      setError("MAC 형식: AA:BB:CC:DD:EE:FF");
      return;
    }
    if (!name.trim()) {
      setError("이름을 입력하세요.");
      return;
    }
    setPending(true);
    const { error: err } = await supabase
      .from("firefighters")
      .update({ name: name.trim(), tag_mac: tagMac, team: team.trim() || null })
      .eq("id", row.id);
    if (err) {
      setError(err.code === "23505" ? "이미 등록된 태그 MAC입니다." : err.message);
      setPending(false);
    } else {
      setPending(false);
      setEditing(false);
      onSaved();
    }
  }

  if (editing) {
    return (
      <tr className="border-b border-edge last:border-b-0">
        <td className="px-4 py-2">
          <input
            aria-label="이름 수정"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-edge bg-bg px-2 py-1.5 text-base"
          />
        </td>
        <td className="px-4 py-2">
          <input
            aria-label="태그 MAC 수정"
            value={mac}
            onChange={(e) => setMac(e.target.value)}
            className="w-full rounded-lg border border-edge bg-bg px-2 py-1.5 font-mono text-base"
          />
        </td>
        <td className="px-4 py-2">
          <input
            aria-label="팀 수정"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            className="w-full rounded-lg border border-edge bg-bg px-2 py-1.5 text-base"
          />
        </td>
        <td className="px-4 py-2 text-sm text-muted" colSpan={1}>
          {error && (
            <span role="alert" className="font-medium text-danger">
              {error}
            </span>
          )}
        </td>
        <td className="px-4 py-2">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-lg bg-info px-3 py-1.5 text-sm font-bold text-bg disabled:opacity-60"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              aria-label="수정 취소"
              className="rounded-lg border border-edge p-1.5 hover:bg-surface-2"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-edge last:border-b-0">
      <td className="px-4 py-3 font-bold">{row.name}</td>
      <td className="px-4 py-3 font-mono text-sm">{row.tag_mac}</td>
      <td className="px-4 py-3">{row.team ?? "—"}</td>
      <td className="px-4 py-3">
        <button
          type="button"
          role="switch"
          aria-checked={row.active}
          aria-label={`${row.name} 활성 상태`}
          onClick={onToggle}
          className={`rounded-full border-2 px-3 py-1 text-sm font-bold ${
            row.active
              ? "border-ok bg-ok-bg text-ok"
              : "border-edge bg-surface-2 text-muted"
          }`}
        >
          {row.active ? "활성" : "비활성"}
        </button>
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={startEdit}
            aria-label={`${row.name} 정보 수정`}
            className="rounded-lg border border-edge p-2 hover:bg-surface-2"
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </td>
    </tr>
  );
}
