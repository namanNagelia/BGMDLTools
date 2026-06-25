import Link from "next/link";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* edition bar ------------------------------------------------------- */}
      <header className="relative z-10 border-b rule px-6 pt-6 pb-3 sm:px-12">
        <div className="flex items-baseline justify-between gap-4">
          <div className="eyebrow">
            VOL. I &nbsp;·&nbsp; NO. 001 &nbsp;·&nbsp; OFFSEASON EDITION
          </div>
          <div className="eyebrow hidden sm:block">FRONT OFFICE — INTERNAL</div>
        </div>
        <div className="seam mt-3" />
      </header>

      {/* masthead ---------------------------------------------------------- */}
      <section className="relative z-10 px-6 sm:px-12 pt-8 pb-4">
        <div className="display text-[14vw] sm:text-[10vw] leading-[0.78] rise">
          THE
          <br />
          <span className="text-[var(--leather)]">FRONT</span>
          <br />
          OFFICE
        </div>
      </section>

      <div className="relative z-10 px-6 sm:px-12">
        <div className="seam" />
      </div>

      {/* under construction body ------------------------------------------ */}
      <section className="relative z-10 px-6 sm:px-12 py-12 grid grid-cols-12 gap-x-6 gap-y-10">
        {/* left meta column */}
        <aside className="col-span-12 sm:col-span-3 space-y-6 rise [animation-delay:120ms]">
          <div>
            <div className="eyebrow opacity-70">FILED</div>
            <div className="font-mono text-sm mt-1">06 / 25 / 26</div>
          </div>
          <div>
            <div className="eyebrow opacity-70">DESK</div>
            <div className="font-mono text-sm mt-1">FREE AGENCY</div>
          </div>
          <div>
            <div className="eyebrow opacity-70">STATUS</div>
            <div className="font-mono text-sm mt-1 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--leather)] animate-pulse" />
              IN PRODUCTION
            </div>
          </div>
          <div>
            <div className="eyebrow opacity-70">MOD ENTRY</div>
            <Link
              href="/mod"
              className="mt-1 inline-flex items-baseline gap-2 font-mono text-sm underline decoration-[var(--leather)] decoration-2 underline-offset-4 hover:text-[var(--leather)] transition-colors"
            >
              /mod
              <span aria-hidden>→</span>
            </Link>
          </div>
        </aside>

        {/* center column — big editorial headline */}
        <div className="col-span-12 sm:col-span-9 space-y-8 rise [animation-delay:240ms]">
          <h1 className="display text-[18vw] sm:text-[13vw] leading-[0.78]">
            UNDER
            <br />
            CONSTRUCTION
            <span className="text-[var(--leather)]">.</span>
          </h1>

          <div className="grid grid-cols-12 gap-x-6">
            <div className="col-span-12 sm:col-span-7">
              <p className="text-lg sm:text-xl leading-snug max-w-prose">
                The newsroom is being built in plain view. The league&apos;s automated
                free-agency cycle is coming together one column at a time — caps,
                holds, offer sheets, the works. Pour a coffee. Watch the floor.
              </p>
            </div>
            <div className="col-span-12 sm:col-span-5 mt-6 sm:mt-0">
              <div className="border-l-2 rule pl-4">
                <div className="eyebrow opacity-70">WHAT&apos;S ON THE BOARD</div>
                <ol className="mt-3 space-y-1 font-mono text-sm">
                  <li>
                    <span className="text-[var(--leather)]">▸</span> Mod console
                    &amp; league import
                  </li>
                  <li>
                    <span className="opacity-40">▸</span> Cap-hold &amp; value
                    parser
                  </li>
                  <li>
                    <span className="opacity-40">▸</span> Offer submission floor
                  </li>
                  <li>
                    <span className="opacity-40">▸</span> Auto-resolution engine
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* footer ledger ----------------------------------------------------- */}
      <footer className="relative z-10 border-t rule px-6 sm:px-12 py-5 mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div className="eyebrow opacity-70">
            © FRONT OFFICE — BBGM LEAGUE FA
          </div>
          <div className="font-mono text-xs opacity-70">
            PRINTED ON RECYCLED OFFER SHEETS
          </div>
        </div>
      </footer>

      {/* gigantic faded number plate in the background */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-12 sm:-right-20 select-none display leading-none text-[40vw] sm:text-[28vw] opacity-[0.045]"
      >
        00
      </div>
    </main>
  );
}
