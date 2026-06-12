import type { CommitTimeline } from "@/lib/types";

// Generic adapter failure (bad input shape, repo not found, unexpected HTTP status).
export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterError";
  }
}

// Thrown when a GitHub rate limit is hit mid-fetch. Carries whatever timeline
// was successfully normalized before the limit so the UI can still render it.
export class RateLimitError extends Error {
  constructor(public partial: CommitTimeline) {
    super("github rate limit exceeded");
    this.name = "RateLimitError";
  }
}
