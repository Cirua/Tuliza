const bcrypt = require('bcrypt')

const { sanitizeRole, roleToTable } = require('../config')

function buildDisplayName(email) {
  const localPart = String(email || '').split('@')[0] || 'User'
  const cleaned = localPart.replace(/[._-]+/g, ' ').trim()
  if (!cleaned) return 'User'
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function buildStudentUsername(email) {
  const localPart = String(email || '').split('@')[0] || 'student'
  const base = localPart.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'student'
  const suffix = Date.now().toString().slice(-6)
  return `${base}_${suffix}`
}

function roleIdColumn(role) {
  if (role === 'student') return 'student_id'
  if (role === 'mentor') return 'mentor_id'
  if (role === 'psychiatrist') return 'psychiatrist_id'
  if (role === 'admin') return 'admin_id'
  return null
}

async function ensurePasswordHashColumn(dbPool, table) {
  if (table === 'admin') return
  const sql = `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = 'password_hash'
    ) AS exists
  `
  const check = await dbPool.query(sql, [table])
  if (check.rows[0] && check.rows[0].exists) return
  await dbPool.query(`ALTER TABLE ${table} ADD COLUMN password_hash VARCHAR(255)`)
}

function setupAuthRoutes(app, dbPool) {
  app.post('/api/signup', async (req, res) => {
    try {
      const { email, password_hash, role } = req.body || {}
      const normalizedRole = sanitizeRole(role)

      if (!normalizedRole) return res.status(400).json({ error: 'Invalid role' })
      if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email is required' })
      if (!password_hash || typeof password_hash !== 'string') return res.status(400).json({ error: 'Password is required' })

      const table = roleToTable(normalizedRole)
      if (!table) return res.status(400).json({ error: 'Invalid role' })

      await ensurePasswordHashColumn(dbPool, table)

      if (normalizedRole !== 'admin') {
        const existingSql = `SELECT ${roleIdColumn(normalizedRole)} AS user_id FROM ${table} WHERE email = $1 LIMIT 1`
        const existing = await dbPool.query(existingSql, [email])
        if (existing.rows[0]) {
          return res.status(409).json({
            error: 'Email already exists. Please log in.',
            role: normalizedRole,
            userId: String(existing.rows[0].user_id),
          })
        }
      }

      const passwordHash = await bcrypt.hash(password_hash, 10)
      const userIdCol = roleIdColumn(normalizedRole)
      if (!userIdCol) return res.status(400).json({ error: 'Invalid role' })

      if (normalizedRole === 'admin') {
        const insertSql = `INSERT INTO admins (password_hash) VALUES ($1) RETURNING admin_id`
        const r = await dbPool.query(insertSql, [passwordHash])
        return res.json({ ok: true, role: normalizedRole, userId: String(r.rows[0].admin_id) })
      }

      if (normalizedRole === 'student') {
        const username = buildStudentUsername(email)
        const insertSql = `
          INSERT INTO ${table} (email,username, password_hash)
          VALUES ($1, $2, $3)
          RETURNING ${userIdCol}
        `

        try {
          const r = await dbPool.query(insertSql, [email, username, passwordHash])
          return res.json({ ok: true, role: normalizedRole, userId: String(r.rows[0][userIdCol]) })
        } catch (err) {
          if (err && err.code === '23502' && err.column === 'students_id') {
            const fallbackSql = `
              INSERT INTO ${table} (students_id, email, username, password_hash)
              VALUES ((SELECT COALESCE(MAX(students_id), 0) + 1 FROM ${table}), $1, $2, $3)
              RETURNING ${userIdCol}
            `
            const r2 = await dbPool.query(fallbackSql, [email, username, passwordHash])
            return res.json({ ok: true, role: normalizedRole, userId: String(r2.rows[0][userIdCol]) })
          }
          throw err
        }
      }

      const insertSqlPro = `
        INSERT INTO ${table} (full_name, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING ${userIdCol}
      `

      const fullName = buildDisplayName(email)
      const r2 = await dbPool.query(insertSqlPro, [fullName, email, passwordHash])
      return res.json({ ok: true, role: normalizedRole, userId: String(r2.rows[0][userIdCol]) })
    } catch (err) {
      if (err && err.code === '23505') {
        return res.status(409).json({ error: 'Email already exists. Please log in.' })
      }
      console.error('Signup failed:', err.message)
      return res.status(500).json({ error: 'Signup failed' })
    }
  })

  app.post('/api/login', async (req, res) => {
    try {
      const { email, password_hash, role } = req.body || {}
      const normalizedRole = sanitizeRole(role)

      if (!normalizedRole) return res.status(400).json({ error: 'Invalid role' })
      if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email is required' })
      if (!password_hash || typeof password_hash !== 'string') return res.status(400).json({ error: 'Password is required' })

      const table = roleToTable(normalizedRole)
      if (!table) return res.status(400).json({ error: 'Invalid role' })

      await ensurePasswordHashColumn(dbPool, table)

      if (normalizedRole === 'admin') {
        return res
          .status(501)
          .json({ error: 'Admin login not supported yet (admins table does not include email in your schema)' })
      }

      const userIdCol = roleIdColumn(normalizedRole)
      if (!userIdCol) return res.status(400).json({ error: 'Invalid role' })

      const sql = `SELECT ${userIdCol} AS user_id, password_hash FROM ${table} WHERE email = $1 LIMIT 1`
      const r = await dbPool.query(sql, [email])
      if (!r.rows[0]) return res.status(401).json({ error: 'Invalid email or password' })

      const { user_id, password_hash } = r.rows[0]
      const ok = await bcrypt.compare(password_hash, password_hash)
      if (!ok) return res.status(401).json({ error: 'Invalid email or password' })

      return res.json({ ok: true, role: normalizedRole, userId: String(user_id) })
    } catch (err) {
      console.error('Login failed:', err.message)
      return res.status(500).json({ error: 'Login failed' })
    }
  })
}

module.exports = { setupAuthRoutes }

