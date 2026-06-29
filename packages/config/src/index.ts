import { homedir } from "node:os";
import { join } from "node:path";

export type RuntimeMode = "development" | "production" | "test";

export type AppConfig = {
  mode: RuntimeMode;
  apiPort: number;
  databasePath: string;
  workerPollMs: number;
  unreadListenLoopMinMs: number;
  unreadListenLoopMaxMs: number;
};

function parseRuntimeMode(value: string | undefined): RuntimeMode {
  if (value === "production" || value === "test" || value === "development") {
    return value;
  }
  return "development";
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function loadAppConfig(): AppConfig {
  return {
    mode: parseRuntimeMode(process.env.NODE_ENV),
    apiPort: parseIntEnv("BOSS_APP_API_PORT", 3001),
    databasePath:
      process.env.BOSS_APP_DB_PATH?.trim() || join(homedir(), ".boss-cli", "app.sqlite"),
    workerPollMs: parseIntEnv("BOSS_APP_WORKER_POLL_MS", 3_000),
    unreadListenLoopMinMs: parseIntEnv("BOSS_APP_UNREAD_LISTEN_LOOP_MIN_MS", 300_000),
    unreadListenLoopMaxMs: parseIntEnv("BOSS_APP_UNREAD_LISTEN_LOOP_MAX_MS", 600_000),
  };
}
