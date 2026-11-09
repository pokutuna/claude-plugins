/** Thresholds: 5h/7d as used-% (0-100), cost as approximate USD. */
export type Limits = { "5h"?: number; "7d"?: number; cost?: number };

declare module "claude-code" {
  interface PluginState {
    "limit-usage": { limits: Limits };
  }
}
