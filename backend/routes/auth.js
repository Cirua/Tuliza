const bcrypt = require('bcrypt')

const { sanitizeRole, roleToTable } = require('../config')
const { createSessionToken } = require('../auth/sessionToken')

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

function dashboardPath(role) {
  if (role === 'student') return 'student.html'
  if (role === 'mentor') return 'mentor.html'
  if (role === 'psychiatrist') return 'psychologist.html'
  if (role === 'admin') return 'admin.html'
  return 'account.html'
}

function isStrongPassword(password) {
  // At least 7 chars, uppercase, lowercase, and special char.
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{7,}$/.test(String(password || ''))
}

async function resolveRoleRow(dbPool, normalizedRole) {
  const candidates = [normalizedRole]
  if (normalizedRole === 'psychiatrist') candidates.push('psychologist')

  const result = await dbPool.query(
    `
    SELECT role_id, role_name
    FROM roles
    WHERE LOWER(role_name) = ANY($1)
    ORDER BY CASE WHEN LOWER(role_name) = $2 THEN 0 ELSE 1 END
    LIMIT 1
    `,
    [candidates.map((v) => String(v || '').toLowerCase()), String(normalizedRole || '').toLowerCase()]
  )

  return result.rows[0] || null
}

async function ensurePasswordHashColumn(dbPool, table) {
  if (table === 'admins') return
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

async function ensureRoleProfileRow(dbPool, { role, table, userIdCol, signupId, email }) {
  if (role === 'student') {
    const username = buildStudentUsername(email)
    const sql = `
      INSERT INTO ${table} (signup_id, email, username)
      VALUES ($1, $2, $3)
      RETURNING ${userIdCol}
    `
    const row = await dbPool.query(sql, [signupId, email, username])
    return String(row.rows[0][userIdCol])
  }

  if (role === 'mentor' || role === 'psychiatrist') {
    const fullName = buildDisplayName(email)
    const sql = `
      INSERT INTO ${table} (signup_id, email, full_name)
      VALUES ($1, $2, $3)
      RETURNING ${userIdCol}
    `
    const row = await dbPool.query(sql, [signupId, email, fullName])
    return String(row.rows[0][userIdCol])
  }

  return null
}

function setupAuthRoutes(app, dbPool) {
  app.post('/api/signup', async (req, res) => {
    try {
      const { email, password, role } = req.body || {}
      const normalizedRole = sanitizeRole(role)

      if (!normalizedRole) return res.status(400).json({ error: 'Invalid role' })
      if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email is required' })
      if (!password || typeof password !== 'string') return res.status(400).json({ error: 'Password is required' })
      if (!isStrongPassword(password)) {
        return res.status(400).json({
          error:
            'Password must be more than 6 characters and include uppercase, lowercase, and a special character.',
        })
      }
      if (normalizedRole === 'admin') {
        return res.status(403).json({ error: 'Admin signup is not allowed from this endpoint.' })
      }

      const table = roleToTable(normalizedRole)
      if (!table) return res.status(400).json({ error: 'Invalid role' })
      const userIdCol = roleIdColumn(normalizedRole)
      if (!userIdCol) return res.status(400).json({ error: 'Invalid role' })

      const roleRow = await resolveRoleRow(dbPool, normalizedRole)
      if (!roleRow) return res.status(400).json({ error: 'Role mapping missing in roles table.' })

      await ensurePasswordHashColumn(dbPool, table)

      const existingSignup = await dbPool.query(
        'SELECT signup_id FROM signup WHERE email = $1 AND role_id = $2 LIMIT 1',
        [email, Number(roleRow.role_id)]
      )
      if (existingSignup.rows[0]) return res.status(409).json({ error: 'Email already exists. Please log in.' })

      const passwordHash = await bcrypt.hash(password, 10)
      const signupInsert = await dbPool.query(
        'INSERT INTO signup (email, role_id, role_name, role, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING signup_id',
        [email, Number(roleRow.role_id), String(roleRow.role_name), normalizedRole, passwordHash]
      )

      const signupId = Number(signupInsert.rows[0].signup_id)
      const roleUserId = await ensureRoleProfileRow(dbPool, {
        role: normalizedRole,
        table,
        userIdCol,
        signupId,
        email,
      })

      return res.json({
        ok: true,
        role: normalizedRole,
        signupId: String(signupId),
        userId: roleUserId,
        message: 'Signup successful.',
      })
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
      const { email, password, role } = req.body || {}
      const normalizedRole = sanitizeRole(role)

      if (!normalizedRole) return res.status(400).json({ error: 'Invalid role' })
      if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email is required' })
      if (!password || typeof password !== 'string') return res.status(400).json({ error: 'Password is required' })

      const table = roleToTable(normalizedRole)
      const userIdCol = roleIdColumn(normalizedRole)
      if (!table || !userIdCol) return res.status(400).json({ error: 'Invalid role' })

      const roleRow = await resolveRoleRow(dbPool, normalizedRole)
      if (!roleRow) return res.status(400).json({ error: 'Role mapping missing in roles table.' })

      const signupResult = await dbPool.query(
        'SELECT signup_id, password_hash FROM signup WHERE email = $1 AND role_id = $2 LIMIT 1',
        [email, Number(roleRow.role_id)]
      )
      if (!signupResult.rows[0]) return res.status(401).json({ error: 'Invalid email or password' })

      const { signup_id: signupId, password_hash: storedPasswordHash } = signupResult.rows[0]
      const ok = await bcrypt.compare(password, storedPasswordHash)
      if (!ok) return res.status(401).json({ error: 'Invalid email or password' })

      const profileRow = await dbPool.query(
        `SELECT ${userIdCol} AS user_id FROM ${table} WHERE signup_id = $1 LIMIT 1`,
        [signupId]
      )
      if (!profileRow.rows[0]) {
        return res.status(500).json({ error: 'Profile is missing for this account. Please contact support.' })
      }

      const userId = String(profileRow.rows[0].user_id)
      let needsQuestionnaire = false
      if (normalizedRole === 'student') {
        const q = await dbPool.query('SELECT questionnaire_id FROM questionnaire WHERE student_id = $1 LIMIT 1', [Number(userId)])
        needsQuestionnaire = !q.rows[0]
      }

      const redirectTo = normalizedRole === 'student' && needsQuestionnaire ? 'questionnaire.html' : dashboardPath(normalizedRole)

      const sessionToken = createSessionToken({ userId, role: normalizedRole })
      return res.json({
        ok: true,
        role: normalizedRole,
        userId,
        signupId: String(signupId),
        needsQuestionnaire,
        redirectTo,
        sessionToken,
      })
    } catch (err) {
      console.error('Login failed:', err.message)
      return res.status(500).json({ error: 'Login failed' })
    }
  })

  app.post('/api/questionnaire', async (req, res) => {
    try {
      const { studentId, answers } = req.body || {}
      const parsedStudentId = Number(studentId)
      if (!Number.isInteger(parsedStudentId) || parsedStudentId <= 0) {
        return res.status(400).json({ error: 'Valid studentId is required' })
      }
      if (!answers || typeof answers !== 'object') {
        return res.status(400).json({ error: 'Questionnaire answers are required' })
      }

      await dbPool.query(
        `
        INSERT INTO questionnaire (student_id, answers_json, created_at, updated_at)
        VALUES ($1, $2::jsonb, NOW(), NOW())
        ON CONFLICT (student_id)
        DO UPDATE SET answers_json = EXCLUDED.answers_json, updated_at = NOW()
        `,
        [parsedStudentId, JSON.stringify(answers)]
      )

      return res.json({ ok: true, message: 'Questionnaire saved successfully.' })
    } catch (err) {
      console.error('Questionnaire save failed:', err.message)
      return res.status(500).json({ error: 'Failed to save questionnaire' })
    }
  })

  app.get('/api/chat/peers', async (req, res) => {
    try {
      const role = sanitizeRole(req.query.role)
      const userId = Number(req.query.userId)
      if (!role || !Number.isInteger(userId)) return res.status(400).json({ error: 'role and userId are required' })

      if (role === 'student') {
        const result = await dbPool.query(
          `
          SELECT DISTINCT
            COALESCE(m.mentor_id::text, m.psychiatrist_id::text) AS peer_user_id,
            CASE WHEN m.mentor_id IS NOT NULL THEN 'mentor' ELSE 'psychiatrist' END AS peer_role
          FROM messages m
          WHERE m.student_id = $1 AND (m.mentor_id IS NOT NULL OR m.psychiatrist_id IS NOT NULL)
          ORDER BY peer_user_id
          `,
          [userId]
        )
        return res.json({ ok: true, peers: result.rows })
      }

      if (role === 'mentor') {
        const result = await dbPool.query(
          `
          SELECT DISTINCT m.student_id::text AS peer_user_id, 'student' AS peer_role
          FROM messages m
          WHERE m.mentor_id = $1 AND m.student_id IS NOT NULL
          ORDER BY peer_user_id
          `,
          [userId]
        )
        return res.json({ ok: true, peers: result.rows })
      }

      if (role === 'psychiatrist') {
        const result = await dbPool.query(
          `
          SELECT DISTINCT m.student_id::text AS peer_user_id, 'student' AS peer_role
          FROM messages m
          WHERE m.psychiatrist_id = $1 AND m.student_id IS NOT NULL
          ORDER BY peer_user_id
          `,
          [userId]
        )
        return res.json({ ok: true, peers: result.rows })
      }

      return res.json({ ok: true, peers: [] })
    } catch (err) {
      console.error('Failed to load chat peers:', err.message)
      return res.status(500).json({ error: 'Failed to load peers' })
    }
  })
}

module.exports = { setupAuthRoutes }

