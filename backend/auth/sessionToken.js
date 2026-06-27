const crypto = require('crypto')

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url')
}

function base64UrlDecode(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8')
}

function getSessionSecret() {
  return process.env.TULIZA_SESSION_SECRET || ''
}

function signPayload(payloadEncoded, secret) {
  return crypto.createHmac('sha256', secret).update(payloadEncoded).digest('base64url')
}

function createSessionToken(claims) {
  const secret = getSessionSecret()
  if (!secret) return null
  const payload = {
    userId: String(claims.userId || ''),
    role: String(claims.role || ''),
    exp: Number(claims.exp || Date.now() + 8 * 60 * 60 * 1000),
  }
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload))
  const signature = signPayload(payloadEncoded, secret)
  return `${payloadEncoded}.${signature}`
}

function verifySessionToken(token) {
  const secret = getSessionSecret()
  if (!secret || !token || typeof token !== 'string') return null

  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [payloadEncoded, signature] = parts
  const expected = signPayload(payloadEncoded, secret)
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null

  let payload
  try {
    payload = JSON.parse(base64UrlDecode(payloadEncoded))
  } catch (_) {
    return null
  }

  if (!payload || !payload.userId || !payload.role) return null
  if (!Number.isFinite(payload.exp) || Date.now() > payload.exp) return null
  return payload
}

module.exports = {
  createSessionToken,
  verifySessionToken,
}
