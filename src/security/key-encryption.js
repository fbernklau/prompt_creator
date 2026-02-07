const crypto = require('crypto');

const KEY_VERSION = 'server-aesgcm-v1';

function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret || ''), 'utf8').digest();
}

function encryptApiKey(plainText, secret) {
  const text = String(plainText || '').trim();
  if (!text) throw new Error('API key is empty.');
  if (!secret) throw new Error('Server encryption secret is missing.');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: KEY_VERSION,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

function decryptApiKey(blob, secret) {
  if (!blob || blob.version !== KEY_VERSION) {
    throw new Error('Unsupported key format. Please resave provider API key.');
  }
  if (!secret) throw new Error('Server encryption secret is missing.');

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveKey(secret),
    Buffer.from(blob.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function hasServerEncryptedKey(blob) {
  return Boolean(blob && blob.version === KEY_VERSION && blob.ciphertext && blob.iv && blob.tag);
}

module.exports = {
  KEY_VERSION,
  encryptApiKey,
  decryptApiKey,
  hasServerEncryptedKey,
};
