// 暗号化保管庫（private/）用のコア関数（モバイル版）
// AES-256-GCM + PBKDF2-SHA256。ブラウザ標準 Web Crypto API のみ使用。

const MAGIC_HEADER = '-----AICHAT-ENCRYPTED-----';
const MAGIC_FOOTER = '-----END-----';
const VERSION = 'v1';
const PBKDF2_ITERATIONS = 200000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256; // AES-256

function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  );
}

// 平文を暗号化し、保存用フォーマット文字列を返す
export async function encrypt(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    enc.encode(plaintext) as BufferSource
  );
  // Web Crypto は暗号文末尾に認証タグを含む（PC側はtag分離なので互換のため分離する）
  const full = new Uint8Array(cipherBuf);
  const tag = full.slice(full.length - 16);
  const data = full.slice(0, full.length - 16);
  return [
    MAGIC_HEADER,
    VERSION,
    `salt: ${bufToBase64(salt)}`,
    `iv: ${bufToBase64(iv)}`,
    `tag: ${bufToBase64(tag)}`,
    `data: ${bufToBase64(data)}`,
    MAGIC_FOOTER,
    '',
  ].join('\n');
}

// 暗号化フォーマットかどうか判定
export function isEncrypted(text: string): boolean {
  return typeof text === 'string' && text.trimStart().startsWith(MAGIC_HEADER);
}

// 暗号文を復号して平文を返す。パスワード誤り・改ざん時は例外を投げる
export async function decrypt(formatted: string, password: string): Promise<string> {
  if (!isEncrypted(formatted)) {
    throw new Error('Not an encrypted payload');
  }
  const fields: Record<string, string> = {};
  for (const line of formatted.split('\n')) {
    const m = line.match(/^(salt|iv|tag|data):\s*(.+)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  if (!fields.salt || !fields.iv || !fields.tag || !fields.data) {
    throw new Error('Malformed encrypted payload');
  }
  const salt = base64ToBuf(fields.salt);
  const iv = base64ToBuf(fields.iv);
  const tag = base64ToBuf(fields.tag);
  const data = base64ToBuf(fields.data);
  // PC側形式（data + tag分離）を Web Crypto 用に結合
  const combined = new Uint8Array(data.length + tag.length);
  combined.set(data, 0);
  combined.set(tag, data.length);
  const key = await deriveKey(password, salt);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, combined as BufferSource);
  return new TextDecoder().decode(plainBuf);
}

// パスワード検証用トークン
const VERIFY_PLAINTEXT = 'aichat-vault-verify-token';
export async function createVerifyToken(password: string): Promise<string> {
  return encrypt(VERIFY_PLAINTEXT, password);
}

export async function verifyPassword(token: string, password: string): Promise<boolean> {
  try {
    return (await decrypt(token, password)) === VERIFY_PLAINTEXT;
  } catch {
    return false;
  }
}
