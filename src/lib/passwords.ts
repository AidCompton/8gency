import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

// Password and token helpers with no framework imports, so account services,
// scripts and tests can share them with the server actions.

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export const newToken = () => randomBytes(32).toString("base64url");

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 11);
}

export function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

let dummy: string | null = null;
/** Compare against a throwaway hash, so an unknown email takes as long as a wrong password. */
export async function burnPasswordCheck(pw: string) {
  dummy ??= bcrypt.hashSync(randomBytes(8).toString("hex"), 11);
  await bcrypt.compare(pw, dummy);
}

export const MIN_PASSWORD = 10;

/** The rules every new password meets: reset, change, invite and sign-up. */
export function passwordProblem(pw: string, email = ""): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters for your password.`;
  if (pw.length > 200) return "That password is too long.";
  if (email && pw.toLowerCase() === email.toLowerCase()) return "Your password can't be your email address.";
  if (/^(.)\1+$/.test(pw) || /^(password|12345678|qwertyuiop|letmein)/i.test(pw)) return "That password is too easy to guess. Try a few unrelated words.";
  return null;
}
