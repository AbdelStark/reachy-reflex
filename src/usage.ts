import type { JevResponse } from "reachy-jev";

export interface UsageSnapshot {
  reportedCalls: number;
  inputTokens: number;
  outputTokens: number;
  unresolvedCalls: number;
  pendingCalls: number;
}

function tokenCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Tab-only accounting of transport attempts, not an invoice or cost estimate. */
export class UsageMeter {
  private reportedCalls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private unresolvedCalls = 0;
  private pendingCalls = 0;

  constructor(private readonly onChange: (snapshot: UsageSnapshot) => void = () => {}) {}

  snapshot(): UsageSnapshot {
    return {
      reportedCalls: this.reportedCalls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      unresolvedCalls: this.unresolvedCalls,
      pendingCalls: this.pendingCalls,
    };
  }

  wrap(ask: (state: unknown, questions: unknown) => Promise<JevResponse>): typeof ask {
    return async (state, questions) => {
      this.pendingCalls++;
      this.onChange(this.snapshot());
      try {
        const response = await ask(state, questions);
        const input = response.usage?.input_tokens;
        const output = response.usage?.output_tokens;
        if (tokenCount(input) && tokenCount(output)
          && Number.isSafeInteger(this.inputTokens + input)
          && Number.isSafeInteger(this.outputTokens + output)) {
          this.reportedCalls++;
          this.inputTokens += input;
          this.outputTokens += output;
        } else {
          this.unresolvedCalls++;
        }
        return response;
      } catch (error) {
        // A rejected or aborted browser request may still have reached a billed model.
        this.unresolvedCalls++;
        throw error;
      } finally {
        this.pendingCalls--;
        this.onChange(this.snapshot());
      }
    };
  }
}

export function formatUsage(snapshot: UsageSnapshot): string {
  const tokens = `${snapshot.inputTokens} input / ${snapshot.outputTokens} output tokens reported`;
  const unresolved = `${snapshot.unresolvedCalls} call${snapshot.unresolvedCalls === 1 ? "" : "s"} without complete usage`;
  const pending = snapshot.pendingCalls ? ` · ${snapshot.pendingCalls} pending` : "";
  return `Cost unavailable (model rate not verified) · This tab: ${tokens}; ${unresolved}${pending}. Not an invoice.`;
}
