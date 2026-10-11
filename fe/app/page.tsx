import Link from "next/link";
import { RecruitmentBoard } from "@/components/recruitment/RecruitmentBoard";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* edition bar ------------------------------------------------------- */}
      <header className="relative z-10 border-b rule px-6 pt-6 pb-3 sm:px-12">
        <div className="flex items-baseline justify-between gap-4">
          <Link
            href="/mod"
            className="eyebrow hidden sm:inline-flex items-baseline gap-2 underline decoration-[var(--leather)] decoration-2 underline-offset-4 hover:text-[var(--leather)] transition-colors"
          >
            MOD ENTRY →
          </Link>
        </div>
        <div className="seam mt-3" />
      </header>

      {/* recruitment board ------------------------------------------------ */}
      <section className="relative z-10 px-3 sm:px-12 py-10">
        <RecruitmentBoard />
      </section>

      {/* footer ledger ----------------------------------------------------- */}
      <footer className="relative z-10 border-t rule px-6 sm:px-12 py-5 mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div className="eyebrow opacity-70">BGMDL League FA</div>
          <div className="font-mono text-xs opacity-70">
            Created by NamanDeep
          </div>
        </div>
      </footer>

      {/* gigantic faded number plate in the background */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-12 sm:-right-20 select-none display leading-none text-[40vw] sm:text-[28vw] opacity-[0.045]"
      >
        FA
      </div>
    </main>
  );
}
