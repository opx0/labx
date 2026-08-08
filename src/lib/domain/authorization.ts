import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from "node:crypto";

// Ed25519, not HMAC: verifying authority must not require the power to mint it.

export type AuthorizationState =
  | "ISSUED"
  | "ACTIVE"
  | "CONSUMED"
  | "EXPIRED"
  | "REVOKED"
  | "INVALIDATED";

const TRANSITIONS: Readonly<Record<AuthorizationState, readonly AuthorizationState[]>> = {
  ISSUED: ["ACTIVE", "REVOKED"],
  ACTIVE: ["CONSUMED", "EXPIRED", "REVOKED", "INVALIDATED"],
  CONSUMED: [],
  EXPIRED: [],
  REVOKED: [],
  INVALIDATED: [],
};

export const canTransition = (from: AuthorizationState, to: AuthorizationState) =>
  TRANSITIONS[from].includes(to);

export type AuthorizationClaims = {
  readonly id: string;
  readonly principal: string;
  readonly actionType: string;
  readonly target: string;
  readonly actionHash: string;
  readonly passportFingerprint: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly approvalId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly nonce: string;
};

export type SignedAuthorization = {
  readonly claims: AuthorizationClaims;
  readonly signature: string;
};

// Length-prefixed and fixed-order, so a signature never depends on JSON key order.
function claimsBytes(c: AuthorizationClaims): Buffer {
  const ordered = [
    c.id,
    c.principal,
    c.actionType,
    c.target,
    c.actionHash,
    c.passportFingerprint,
    c.policyId,
    String(c.policyVersion),
    c.approvalId,
    String(c.issuedAt),
    String(c.expiresAt),
    c.nonce,
  ];
  return Buffer.from(ordered.map((s) => `${s.length}:${s}`).join("|"), "utf8");
}

export function generateSigningKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

export const signAuthorization = (
  claims: AuthorizationClaims,
  privateKeyPem: string,
): SignedAuthorization => ({
  claims,
  signature: sign(null, claimsBytes(claims), createPrivateKey(privateKeyPem)).toString("base64"),
});

export function verifySignature(auth: SignedAuthorization, publicKeyPem: string): boolean {
  try {
    return verify(
      null,
      claimsBytes(auth.claims),
      createPublicKey(publicKeyPem),
      Buffer.from(auth.signature, "base64"),
    );
  } catch {
    return false;
  }
}

export const newNonce = () => randomBytes(24).toString("base64url");

export type AuthorizationInput = Omit<AuthorizationClaims, "issuedAt" | "expiresAt" | "nonce"> & {
  readonly ttlSeconds: number;
  readonly now: number;
};

export function issueAuthorization(
  input: AuthorizationInput,
  privateKeyPem: string,
): SignedAuthorization {
  const { ttlSeconds, now, ...rest } = input;
  return signAuthorization(
    { ...rest, issuedAt: now, expiresAt: now + ttlSeconds * 1000, nonce: newNonce() },
    privateKeyPem,
  );
}
