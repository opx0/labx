import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generateSigningKeypair } from "@/lib/domain/authorization";

// The signing key must outlive the process: a regenerated key would orphan
// every ACTIVE authorization on restart — their signatures stop verifying
// against a public key that no longer exists.

const KEY_PATH = process.env.SIGNING_KEY_PATH ?? "var/signing-key.pem";

export function loadOrCreateSigningKeypair() {
  if (existsSync(KEY_PATH)) {
    const privateKeyPem = readFileSync(KEY_PATH, "utf8");
    const publicKeyPem = createPublicKey(createPrivateKey(privateKeyPem))
      .export({ type: "spki", format: "pem" })
      .toString();
    return { privateKeyPem, publicKeyPem };
  }
  const keys = generateSigningKeypair();
  mkdirSync(dirname(KEY_PATH), { recursive: true });
  writeFileSync(KEY_PATH, keys.privateKeyPem, { mode: 0o600 });
  return keys;
}
