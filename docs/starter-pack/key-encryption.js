const crypto = require('crypto');

const KEY_VERSION = 'server-aesgcm-v1';

function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret || ''), 'utf8').digest();
}

function assertSecret(secret, label = 'KEY_ENCRYPTION_SECRET') {
  if (!String(secret || '').trim()) {
    throw new Error(`${label} is missing.`);
  }
}

function encryptApiKey(plainText, secret) {
  const normalized = String(plainText || '').trim();
  if (!normalized) throw new Error('API key is empty.');
  assertSecret(secret);

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: KEY_VERSION,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptWithSecret(blob, secret) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveKey(secret),
    Buffer.from(blob.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function decryptApiKey(blob, secrets = {}) {
  if (!hasServerEncryptedKey(blob)) {
    throw new Error('Unsupported key format. Re-save key in latest format.');
  }

  const currentSecret = secrets.current || secrets.secret || '';
  const previousSecret = secrets.previous || '';
  assertSecret(currentSecret);

  try {
    return decryptWithSecret(blob, currentSecret);
  } catch (err) {
    if (!previousSecret) throw err;
    return decryptWithSecret(blob, previousSecret);
  }
}

function hasServerEncryptedKey(blob) {
  return Boolean(
    blob &&
      blob.version === KEY_VERSION &&
      blob.iv &&
      blob.tag &&
      blob.ciphertext
  );
}

module.exports = {
  KEY_VERSION,
  encryptApiKey,
  decryptApiKey,
  hasServerEncryptedKey,
};
