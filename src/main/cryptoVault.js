// 暗号化保管庫（private/）用のコア関数
// AES-256-GCM + PBKDF2-SHA256。Node標準cryptoのみ使用（追加ライブラリ不要）。
const crypto = require('crypto');

const MAGIC_HEADER = '-----AICHAT-ENCRYPTED-----';
const MAGIC_FOOTER = '-----END-----';
const VERSION = 'v1';
const PBKDF2_ITERATIONS = 200000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32; // AES-256

// パスワード + ソルトから鍵を導出
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_BYTES, 'sha256');
}

// 平文を暗号化し、保存用フォーマット文字列を返す
function encrypt(plaintext, password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    MAGIC_HEADER,
    VERSION,
    `salt: ${salt.toString('base64')}`,
    `iv: ${iv.toString('base64')}`,
    `tag: ${tag.toString('base64')}`,
    `data: ${encrypted.toString('base64')}`,
    MAGIC_FOOTER,
    '',
  ].join('\n');
}

// 暗号化フォーマットかどうか判定
function isEncrypted(text) {
  return typeof text === 'string' && text.trimStart().startsWith(MAGIC_HEADER);
}

// 暗号文を復号して平文を返す。パスワード誤り・改ざん時は例外を投げる
function decrypt(formatted, password) {
  if (!isEncrypted(formatted)) {
    throw new Error('Not an encrypted payload');
  }
  const lines = formatted.split('\n');
  const fields = {};
  for (const line of lines) {
    const m = line.match(/^(salt|iv|tag|data):\s*(.+)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  if (!fields.salt || !fields.iv || !fields.tag || !fields.data) {
    throw new Error('Malformed encrypted payload');
  }
  const salt = Buffer.from(fields.salt, 'base64');
  const iv = Buffer.from(fields.iv, 'base64');
  const tag = Buffer.from(fields.tag, 'base64');
  const data = Buffer.from(fields.data, 'base64');
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

// パスワード検証用トークン（既知文字列を暗号化したもの）を生成
const VERIFY_PLAINTEXT = 'aichat-vault-verify-token';
function createVerifyToken(password) {
  return encrypt(VERIFY_PLAINTEXT, password);
}

// 入力パスワードがトークンと一致するか検証
function verifyPassword(token, password) {
  try {
    return decrypt(token, password) === VERIFY_PLAINTEXT;
  } catch {
    return false;
  }
}

module.exports = {
  encrypt,
  decrypt,
  isEncrypted,
  createVerifyToken,
  verifyPassword,
};
