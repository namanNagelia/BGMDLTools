"use client";

import { useState, type FormEvent } from "react";
import { ApiError, mod } from "@/lib/api";

interface Props {
  onAuthed: () => void;
}

export function LoginCard({ onAuthed }: Props) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await mod.login(password);
      setPassword("");
      onAuthed();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("INCORRECT CREDENTIAL — TRY AGAIN");
      } else {
        setError("CONNECTION REFUSED");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-12 gap-6 sm:gap-10 items-end">
      <div className="col-span-12 sm:col-span-5">
        <div className="eyebrow opacity-60">GATE · CREDENTIALS</div>
        <h2 className="display text-[16vw] sm:text-[7vw] leading-[0.82] mt-3">
          STAFF
          <br />
          <span className="text-[var(--leather)]">ENTRY</span>
        </h2>
        <p className="font-mono text-xs opacity-70 mt-5 leading-relaxed max-w-xs">
          AUTHORIZED PERSONNEL ONLY. ALL ACTIONS LOGGED
          <span className="caret ml-1" />
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="col-span-12 sm:col-span-7 border rule p-6 sm:p-8 bg-[color:var(--ink-2)]"
      >
        <label className="block">
          <div className="eyebrow opacity-70 mb-2 flex items-center justify-between">
            <span>PASSCODE</span>
            <span className="opacity-50">[ HS-256 ]</span>
          </div>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            className="w-full bg-transparent border-0 border-b-2 rule pb-2 outline-none font-mono text-2xl tracking-widest focus:border-[var(--leather)] transition-colors disabled:opacity-50"
            placeholder="••••••••"
          />
        </label>

        {error && (
          <div className="mt-5 border-l-2 border-[var(--leather)] pl-3 py-1 font-mono text-xs text-[var(--leather)]">
            {error}
          </div>
        )}

        <div className="mt-8 flex items-center justify-between gap-4">
          <div className="font-mono text-[10px] opacity-40 leading-tight max-w-[12rem]">
            COOKIE STORED, HTTP-ONLY · SESSION 24H
          </div>
          <button
            type="submit"
            disabled={loading || password.length === 0}
            className="group inline-flex items-center gap-3 bg-[var(--leather)] text-[var(--paper)] px-6 py-3 font-mono text-sm tracking-wider hover:bg-[var(--leather-2)] disabled:bg-[var(--ink-2)] disabled:text-[color:rgba(243,237,225,0.3)] disabled:cursor-not-allowed transition-colors"
          >
            <span>{loading ? "VERIFYING" : "PUNCH IN"}</span>
            <span aria-hidden className="group-hover:translate-x-1 transition-transform">
              →
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}
