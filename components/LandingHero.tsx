"use client";

import { InputRow, type DemoEntry, type LocalFiles } from "./InputRow";

export function LandingHero({
  demos,
  busy,
  rateLimit,
  onLocal,
  onGithub,
  onDemo,
  onContinuePartial,
}: {
  demos: DemoEntry[];
  busy?: boolean;
  rateLimit?: { commitsLoaded: number } | null;
  onLocal: (files: LocalFiles) => void;
  onGithub: (owner: string, repo: string, token?: string) => void;
  onDemo: (id: string) => void;
  onContinuePartial?: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-end">
      {/* Layered scrim: a soft radial glow behind the hero text plus a bottom-up
          dark gradient, so the headline stays legible over the live galaxy. */}
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/75 to-transparent" />
      <div
        className="absolute inset-x-0 bottom-0 h-[70vh]"
        style={{
          background:
            "radial-gradient(60% 80% at 50% 100%, color-mix(in srgb, var(--bg) 92%, transparent), transparent 70%)",
        }}
      />

      <div className="pointer-events-auto relative z-10 mb-[14vh] flex w-full max-w-2xl flex-col items-center px-6 text-center">
        <p className="mb-5 text-sm font-medium tracking-[0.25em] text-fg-dim uppercase">
          Repo<span className="text-accent">Reel</span>
        </p>

        <h1 className="text-balance text-4xl font-bold leading-[1.05] tracking-tight text-fg sm:text-6xl">
          Watch your codebase{" "}
          <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">
            being born
          </span>
          .
        </h1>

        <p className="mt-5 text-base text-fg-dim sm:text-lg">
          A cinematic galaxy <span className="text-fg">and</span> an AI guide that explains the whole codebase:
          what it is, what each file does, who built it, how healthy it is.
        </p>
        <p className="mt-2 text-sm text-fg-dim/80">100% in your browser. Nothing uploaded.</p>

        <div className="mt-10 flex w-full justify-center">
          <InputRow
            demos={demos}
            busy={busy}
            rateLimit={rateLimit}
            onLocal={onLocal}
            onGithub={onGithub}
            onDemo={onDemo}
            onContinuePartial={onContinuePartial}
          />
        </div>

        <p className="mt-8 text-xs tracking-wide text-fg-dim/80">
          open source · no tracking · no sign-up
        </p>
      </div>
    </div>
  );
}
