const allowedOrigins = new Set(
  (process.env.TULIZA_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
)

const allowedOriginPatterns = [
  /^https?:\/\/localhost(?::\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
]

function isAllowedOrigin(origin) {
  if (!origin) return false
  if (allowedOrigins.has(origin)) return true
  return allowedOriginPatterns.some((pattern) => pattern.test(origin))
}

function roleLabel(role) {
  if (role === 'student') return 'student'
  if (role === 'mentor') return 'mentor'
  if (role === 'psychiatrist') return 'psychiatrist'
  return ''
}

function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase()
  if (value === 'psychologist') return 'psychiatrist'
  return value
}

function toIsoString(value) {
  if (!value) return new Date().toISOString()
  const dateValue = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(dateValue.getTime())) return new Date().toISOString()
  return dateValue.toISOString()
}

function sanitizeRole(role) {
  const r = normalizeRole(role)
  if (r === 'student' || r === 'mentor' || r === 'psychiatrist' || r === 'admin') return r
  return null
}

function roleToTable(role) {
  if (role === 'student') return 'student'
  if (role === 'mentor') return 'mentor'
  if (role === 'psychiatrist') return 'psychiatrist'
  if (role === 'admin') return 'admins'
  return null
}

module.exports = {
  allowedOrigins,
  isAllowedOrigin,
  roleLabel,
  normalizeRole,
  toIsoString,
  sanitizeRole,
  roleToTable,
}

