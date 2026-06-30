// build-seed.mjs — cifra data.plain.json -> seed.enc.js con AES-256-GCM
// Uso:  node build-seed.mjs 'Password1' 'Password2' ...
import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

const passwords = process.argv.slice(2);
if (!passwords.length) {
  console.error("Manca la password.  Uso: node build-seed.mjs 'Pass1' 'Pass2' ...");
  process.exit(1);
}

const enc = new TextEncoder();
const plaintext = readFileSync("data.plain.json", "utf8");
const b64 = (buf) => Buffer.from(buf).toString("base64");

async function encryptWith(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
  );
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

const blobs = await Promise.all(passwords.map(encryptWith));

const out = `// Auto-generato da build-seed.mjs — dati cifrati (AES-256-GCM). NON contiene dati in chiaro.
window.SEED_ENC = ${JSON.stringify(blobs.length === 1 ? blobs[0] : blobs)};
`;
writeFileSync("seed.enc.js", out);
console.log(`OK -> seed.enc.js  (${blobs.length} password, ${out.length} byte)`);
