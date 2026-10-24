import { existsSync } from "node:fs";

// Load .env for CLI scripts (Next.js loads it itself for the app).
if (existsSync(".env")) process.loadEnvFile(".env");

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.`);
  return value;
}
