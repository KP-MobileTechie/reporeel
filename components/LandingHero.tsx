"use client";

import { InputRow, type DemoEntry, type LocalFiles } from "./InputRow";

export function LandingHero({
  demos,
  rateLimit,
  onLocal,
  onGithub,
  onDemo,
  onContinuePartial,
}: {
  demos: DemoEntry[];
  rateLimit?: { commitsLoaded: number } | null;
  onLocal: (files: LocalFiles) => void;
  onGithub: (owner: string, repo: string, token?: string) => void;
  onDemo: (id: string) => void;
  onContinuePartial?: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-end">
      {/* gradient scrim: dark at bottom, fading up, keeps hero text readable */}
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-transparent" />

      <div className="pointer-events-auto relative z-10 mb-[12vh] flex w-full max-w-2xl flex-col items-center px-6 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-fg sm:text-6xl">
          Repo<span className="text-accent">Reel</span>
        </h1>
        <p className="mt-3 text-xl text-fg">Watch your codebase being born.</p>
        <p className="mt-1 text-sm text-fg-dim">
          Any repo. 100% in your browser. Nothing uploaded.
        </p>

        <div className="mt-8 flex w-full justify-center">
          <InputRow
            demos={demos}
            rateLimit={rateLimit}
            onLocal={onLocal}
            onGithub={onGithub}
            onDemo={onDemo}
            onContinuePartial={onContinuePartial}
          />
        </div>
      </div>
    </div>
  );
}
