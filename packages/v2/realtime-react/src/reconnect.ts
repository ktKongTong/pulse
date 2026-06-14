import type { RealtimeV2StateStore } from "./state";
import type { ConnectionStatus } from "./types";
import { nextConnection } from "./connection";

export const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 16_000] as const;

export class RetryBudget {
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly store: RealtimeV2StateStore,
    private readonly target: "common" | "media",
    private readonly exhaustedCode: string,
  ) { }

  schedule(run: () => void) {
    if (this.timer) return true;
    if (this.failures >= RECONNECT_DELAYS_MS.length) {
      this.markFailed();
      return false;
    }
    const delay = RECONNECT_DELAYS_MS[this.failures]!;
    this.failures += 1;
    this.store.patch((draft) => {
      draft[this.target].connection = nextConnection("retrying");
    });
    this.timer = setTimeout(() => {
      this.timer = null;
      run();
    }, delay);
    return true;
  }

  reset() {
    this.failures = 0;
  }

  cancel() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  dispose() {
    this.cancel();
    this.failures = 0;
  }

  private markFailed() {
    this.store.patch((draft) => {
      draft[this.target].connection = nextConnection(
        "failed" satisfies ConnectionStatus,
        this.exhaustedCode,
      );
    });
  }
}
