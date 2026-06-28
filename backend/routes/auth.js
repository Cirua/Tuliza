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

function profilePath(role) {
  if (role === 'student') return 'profile-student.html'
  if (role === 'mentor') return 'profile-mentor.html'
  if (role === 'psychiatrist') return 'profile-psychiatrist.html'
  if (role === 'admin') return 'profile-admin.html'
  return 'profile.html'
}

function isStrongPassword(password) {
  // At least 7 chars, uppercase, lowercase, and special char.
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{7,}$/.test(String(password || ''))
}

function normalizeAnswer(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function normalizeAnswerSet(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
  )
}

function computeAssignmentDecision(answers) {
  const periodAffected = normalizeAnswer(answers.period_affected)
  const supportType = normalizeAnswer(answers.support_type)
  const supportPreferences = normalizeAnswer(answers.support_preferences)
  const sessionStructure = normalizeAnswerSet(answers.session_structure)
  const communication = normalizeAnswerSet(answers.communication)

  const mentorDurations = new Set(['less than 2 weeks', '2-4 weeks'])
  const psychiatristDurations = new Set(['1-3 months', 'more than 3 months'])

  const mentorPreferenceOptions = new Set(['someone to listen', 'academic guidance', 'emotional support'])
  const psychiatristPreferenceOptions = new Set(['stress management', 'professional support'])

  const isMentorDuration = mentorDurations.has(periodAffected)
  const isPsychiatristDuration = psychiatristDurations.has(periodAffected)

  const supportTypeIsEither = supportType === 'either'
  const eitherSupportsMentor = supportTypeIsEither && isMentorDuration
  const eitherSupportsPsychiatrist = supportTypeIsEither && !isMentorDuration

  let mentorScore = 0
  let psychiatristScore = 0

  if (isMentorDuration) mentorScore += 1
  if (isPsychiatristDuration) psychiatristScore += 1

  if (supportType === 'peer mentor' || supportType === 'not sure' || eitherSupportsMentor) mentorScore += 1
  if (supportType === 'professional support from a psychiatrist' || eitherSupportsPsychiatrist) psychiatristScore += 1

  if (mentorPreferenceOptions.has(supportPreferences)) mentorScore += 1
  if (psychiatristPreferenceOptions.has(supportPreferences)) psychiatristScore += 1

  if (sessionStructure.has('flexible') || (sessionStructure.has('balanced') && eitherSupportsMentor)) mentorScore += 1
  if (sessionStructure.has('structured') || (sessionStructure.has('balanced') && eitherSupportsPsychiatrist)) psychiatristScore += 1

  if (communication.has('casual') || (communication.has('balanced') && eitherSupportsMentor)) mentorScore += 1
  if (communication.has('formal') || (communication.has('balanced') && eitherSupportsPsychiatrist)) psychiatristScore += 1

  let assignedRole = null
  if (mentorScore > psychiatristScore) {
    assignedRole = 'mentor'
  } else if (psychiatristScore > mentorScore) {
    assignedRole = 'psychiatrist'
  } else if (supportType === 'peer mentor' || supportType === 'not sure') {
    assignedRole = 'mentor'
  } else if (supportType === 'professional support from a psychiatrist') {
    assignedRole = 'psychiatrist'
  } else if (isMentorDuration) {
    assignedRole = 'mentor'
  } else if (isPsychiatristDuration) {
    assignedRole = 'psychiatrist'
  }

  return {
    mentorScore,
    psychiatristScore,
    assignedRole,
  }
}

async function findLeastLoadedAssignee(dbPool, role) {
  if (role === 'mentor') {
    const result = await dbPool.query(
      `
      SELECT m.mentor_id AS assignee_id, COUNT(a.assignment_id)::int AS assigned_count
      FROM mentor m
      LEFT JOIN assignments a ON a.mentor_id = m.mentor_id
      GROUP BY m.mentor_id
      ORDER BY assigned_count ASC, m.mentor_id ASC
      LIMIT 1
      `
    )
    return result.rows[0] ? Number(result.rows[0].assignee_id) : null
  }

  if (role === 'psychiatrist') {
    const result = await dbPool.query(
      `
      SELECT p.psychiatrist_id AS assignee_id, COUNT(a.assignment_id)::int AS assigned_count
      FROM psychiatrist p
      LEFT JOIN assignments a ON a.psychiatrist_id = p.psychiatrist_id
      GROUP BY p.psychiatrist_id
      ORDER BY assigned_count ASC, p.psychiatrist_id ASC
      LIMIT 1
      `
    )
    return result.rows[0] ? Number(result.rows[0].assignee_id) : null
  }

  return null
}

async function getQuestionnaireForeignKeyTarget(dbPool, constraintName) {
  const target = await dbPool.query(
    `
    SELECT ccu.table_name AS referenced_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema = ccu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'questionnaire'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND tc.constraint_name = $1
    LIMIT 1
    `,
    [constraintName]
  )

  return target.rows[0] ? String(target.rows[0].referenced_table) : null
}

async function resolveQuestionnaireAssigneeId(dbPool, role, proposedId) {
  const numericId = Number(proposedId)
  if (!Number.isInteger(numericId) || numericId <= 0) return null

  if (role === 'mentor') {
    const fkTarget = await getQuestionnaireForeignKeyTarget(dbPool, 'fk_qst_mentor')
    if (!fkTarget || fkTarget === 'mentor') {
      const exists = await dbPool.query('SELECT mentor_id FROM mentor WHERE mentor_id = $1 LIMIT 1', [numericId])
      return exists.rows[0] ? numericId : null
    }

    return null
  }

  if (role === 'psychiatrist') {
    const fkTarget = await getQuestionnaireForeignKeyTarget(dbPool, 'fk_qst_psychiatrist')
    if (!fkTarget || fkTarget === 'psychiatrist') {
      const exists = await dbPool.query('SELECT psychiatrist_id FROM psychiatrist WHERE psychiatrist_id = $1 LIMIT 1', [
        numericId,
      ])
      return exists.rows[0] ? numericId : null
    }

    return null
  }

  return null
}

async function ensureQuestionnaireWriteSchema(dbPool) {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS assignments (
      assignment_id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      student_id INT REFERENCES student(student_id),
      mentor_id INT REFERENCES mentor(mentor_id),
      psychiatrist_id INT REFERENCES psychiatrist(psychiatrist_id)
    )
  `)

  // Compatibility guard for older questionnaire schema variants.
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS mentalhealthsupport VARCHAR(10)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS concerns VARCHAR(200)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS period_affected VARCHAR(50)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS support_type VARCHAR(50)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS support_preferences VARCHAR(50)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS support_preference VARCHAR(50)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS religion TEXT')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS religion_type VARCHAR(50)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS spiritual_status VARCHAR(50)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS therapy_status VARCHAR(10)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS seek_support TEXT')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS expectations TEXT')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS session_structure VARCHAR(50)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS communication VARCHAR(50)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS mentor_id INT')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS psychiatrist_id INT')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()')

  await dbPool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'questionnaire'
          AND column_name = 'support_preference'
      ) THEN
        ALTER TABLE questionnaire ALTER COLUMN support_preference SET DEFAULT '';
      END IF;
    END $$;
  `)

  await dbPool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_questionnaire_student_unique ON questionnaire(student_id)')

  const fkTarget = await dbPool.query(
    `
    SELECT ccu.table_name AS referenced_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema = ccu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'questionnaire'
      AND tc.constraint_name = 'fk_qst_student'
      AND tc.constraint_type = 'FOREIGN KEY'
    LIMIT 1
    `
  )

  if (fkTarget.rows[0] && String(fkTarget.rows[0].referenced_table) !== 'student') {
    await dbPool.query('ALTER TABLE questionnaire DROP CONSTRAINT IF EXISTS fk_qst_student')
    await dbPool.query(
      'ALTER TABLE questionnaire ADD CONSTRAINT fk_qst_student FOREIGN KEY (student_id) REFERENCES student(student_id)'
    )
  } else if (!fkTarget.rows[0]) {
    await dbPool.query(
      'ALTER TABLE questionnaire ADD CONSTRAINT fk_qst_student FOREIGN KEY (student_id) REFERENCES student(student_id)'
    )
  }
}

async function resolveStudentIdForQuestionnaire(dbPool, rawStudentId) {
  const numericId = Number(rawStudentId)
  if (!Number.isInteger(numericId) || numericId <= 0) return null

  const byStudentId = await dbPool.query('SELECT student_id FROM student WHERE student_id = $1 LIMIT 1', [numericId])
  if (byStudentId.rows[0]) return Number(byStudentId.rows[0].student_id)

  const bySignupId = await dbPool.query('SELECT student_id FROM student WHERE signup_id = $1 LIMIT 1', [numericId])
  if (bySignupId.rows[0]) return Number(bySignupId.rows[0].student_id)

  const signupRow = await dbPool.query(
    `
    SELECT s.signup_id, s.email
    FROM signup s
    WHERE s.signup_id = $1
      AND LOWER(COALESCE(s.role, s.role_name, '')) = 'student'
    LIMIT 1
    `,
    [numericId]
  )

  if (!signupRow.rows[0]) return null

  const signup = signupRow.rows[0]
  const username = buildStudentUsername(signup.email)
  const inserted = await dbPool.query(
    `
    INSERT INTO student (signup_id, email, username)
    VALUES ($1, $2, $3)
    ON CONFLICT (signup_id)
    DO UPDATE SET email = EXCLUDED.email
    RETURNING student_id
    `,
    [Number(signup.signup_id), String(signup.email), username]
  )

  return inserted.rows[0] ? Number(inserted.rows[0].student_id) : null
}

async function syncLegacyStudentTableIfPresent(dbPool, studentId) {
  return
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

async function resolveOrRepairRoleProfileRow(dbPool, { role, table, userIdCol, signupId, email }) {
  if (role === 'admin') {
    await dbPool.query('ALTER TABLE admins ADD COLUMN IF NOT EXISTS signup_id INT UNIQUE')
    const adminBySignup = await dbPool.query('SELECT admin_id AS user_id FROM admins WHERE signup_id = $1 LIMIT 1', [
      Number(signupId),
    ])
    return adminBySignup.rows[0] ? String(adminBySignup.rows[0].user_id) : null
  }

  const bySignup = await dbPool.query(`SELECT ${userIdCol} AS user_id FROM ${table} WHERE signup_id = $1 LIMIT 1`, [signupId])
  if (bySignup.rows[0]) return String(bySignup.rows[0].user_id)

  const byEmail = await dbPool.query(
    `SELECT ${userIdCol} AS user_id, signup_id FROM ${table} WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  )

  if (byEmail.rows[0]) {
    const existing = byEmail.rows[0]
    const existingSignupId = existing.signup_id != null ? Number(existing.signup_id) : null
    const currentSignupId = Number(signupId)

    if (existingSignupId == null || existingSignupId === currentSignupId) {
      await dbPool.query(`UPDATE ${table} SET signup_id = $1 WHERE ${userIdCol} = $2`, [
        currentSignupId,
        Number(existing.user_id),
      ])
      return String(existing.user_id)
    }

    // A different signup_id already owns this profile row; do not auto-relink.
    return null
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

      return res.json({
        ok: true,
        role: normalizedRole,
        signupId: String(signupId),
        userId: null,
        profileComplete: false,
        redirectTo: profilePath(normalizedRole),
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

      const userId = await resolveOrRepairRoleProfileRow(dbPool, {
        role: normalizedRole,
        table,
        userIdCol,
        signupId: Number(signupId),
        email,
      })

      if (!userId) {
        const sessionToken = createSessionToken({ userId: String(signupId), role: normalizedRole })
        return res.json({
          ok: true,
          role: normalizedRole,
          userId: null,
          signupId: String(signupId),
          profileComplete: false,
          needsQuestionnaire: normalizedRole === 'student',
          redirectTo: profilePath(normalizedRole),
          sessionToken,
        })
      }

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
        profileComplete: true,
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

      await ensureQuestionnaireWriteSchema(dbPool)

      const requiredFields = [
        'mentalHealthSupport',
        'concerns',
        'period_affected',
        'support_type',
        'support_preferences',
        'religion',
        'religion_type',
        'spiritual_status',
        'therapy_status',
        'seek_support',
        'expectations',
        'session_structure',
        'communication',
      ]

      const missingField = requiredFields.find((field) => !String(answers[field] || '').trim())
      if (missingField) {
        return res.status(400).json({ error: `Missing questionnaire field: ${missingField}` })
      }

      const resolvedStudentId = await resolveStudentIdForQuestionnaire(dbPool, parsedStudentId)
      if (!resolvedStudentId) {
        return res.status(400).json({ error: 'Could not resolve student profile for questionnaire submission' })
      }

      await syncLegacyStudentTableIfPresent(dbPool, resolvedStudentId)

      const studentResult = await dbPool.query('SELECT username FROM student WHERE student_id = $1 LIMIT 1', [resolvedStudentId])
      if (!studentResult.rows[0]) {
        return res.status(404).json({ error: 'Student profile not found' })
      }

      const decision = computeAssignmentDecision(answers)
      const assigneeRole = decision.assignedRole

      const assigneeId = assigneeRole ? await findLeastLoadedAssignee(dbPool, assigneeRole) : null

      const mentorId =
        assigneeRole === 'mentor' && assigneeId != null
          ? await resolveQuestionnaireAssigneeId(dbPool, 'mentor', assigneeId)
          : null
      const psychiatristId =
        assigneeRole === 'psychiatrist' && assigneeId != null
          ? await resolveQuestionnaireAssigneeId(dbPool, 'psychiatrist', assigneeId)
          : null

      const legacyAnswersJsonCheck = await dbPool.query(
        `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'questionnaire'
            AND column_name = 'answers_json'
        ) AS exists
        `
      )
      const hasLegacyAnswersJson = Boolean(legacyAnswersJsonCheck.rows[0] && legacyAnswersJsonCheck.rows[0].exists)

      const legacyUpdatedAtCheck = await dbPool.query(
        `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'questionnaire'
            AND column_name = 'updated_at'
        ) AS exists
        `
      )
      const hasLegacyUpdatedAt = Boolean(legacyUpdatedAtCheck.rows[0] && legacyUpdatedAtCheck.rows[0].exists)

      const legacySupportPreferenceCheck = await dbPool.query(
        `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'questionnaire'
            AND column_name = 'support_preference'
        ) AS exists
        `
      )
      const hasLegacySupportPreference = Boolean(
        legacySupportPreferenceCheck.rows[0] && legacySupportPreferenceCheck.rows[0].exists
      )

      const structuredValues = [
        resolvedStudentId,
        String(answers.mentalHealthSupport),
        String(answers.concerns),
        String(answers.period_affected),
        String(answers.support_type),
        String(answers.support_preferences),
        String(answers.religion),
        String(answers.religion_type),
        String(answers.spiritual_status),
        String(answers.therapy_status),
        String(answers.seek_support),
        String(answers.expectations),
        String(answers.session_structure),
        String(answers.communication),
        mentorId,
        psychiatristId,
      ]

      if (hasLegacyAnswersJson && hasLegacyUpdatedAt) {
        await dbPool.query(
          `
          INSERT INTO questionnaire (
            student_id,
            mentalhealthsupport,
            concerns,
            period_affected,
            support_type,
            support_preferences,
            religion,
            religion_type,
            spiritual_status,
            therapy_status,
            seek_support,
            expectations,
            session_structure,
            communication,
            mentor_id,
            psychiatrist_id,
            answers_json,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, NOW(), NOW())
          ON CONFLICT (student_id)
          DO UPDATE SET
            mentalhealthsupport = EXCLUDED.mentalhealthsupport,
            concerns = EXCLUDED.concerns,
            period_affected = EXCLUDED.period_affected,
            support_type = EXCLUDED.support_type,
            support_preferences = EXCLUDED.support_preferences,
            religion = EXCLUDED.religion,
            religion_type = EXCLUDED.religion_type,
            spiritual_status = EXCLUDED.spiritual_status,
            therapy_status = EXCLUDED.therapy_status,
            seek_support = EXCLUDED.seek_support,
            expectations = EXCLUDED.expectations,
            session_structure = EXCLUDED.session_structure,
            communication = EXCLUDED.communication,
            mentor_id = EXCLUDED.mentor_id,
            psychiatrist_id = EXCLUDED.psychiatrist_id,
            answers_json = EXCLUDED.answers_json,
            created_at = NOW(),
            updated_at = NOW()
          `,
          [...structuredValues, JSON.stringify(answers)]
        )
      } else if (hasLegacyAnswersJson) {
        await dbPool.query(
          `
          INSERT INTO questionnaire (
            student_id,
            mentalhealthsupport,
            concerns,
            period_affected,
            support_type,
            support_preferences,
            religion,
            religion_type,
            spiritual_status,
            therapy_status,
            seek_support,
            expectations,
            session_structure,
            communication,
            mentor_id,
            psychiatrist_id,
            answers_json,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, NOW())
          ON CONFLICT (student_id)
          DO UPDATE SET
            mentalhealthsupport = EXCLUDED.mentalhealthsupport,
            concerns = EXCLUDED.concerns,
            period_affected = EXCLUDED.period_affected,
            support_type = EXCLUDED.support_type,
            support_preferences = EXCLUDED.support_preferences,
            religion = EXCLUDED.religion,
            religion_type = EXCLUDED.religion_type,
            spiritual_status = EXCLUDED.spiritual_status,
            therapy_status = EXCLUDED.therapy_status,
            seek_support = EXCLUDED.seek_support,
            expectations = EXCLUDED.expectations,
            session_structure = EXCLUDED.session_structure,
            communication = EXCLUDED.communication,
            mentor_id = EXCLUDED.mentor_id,
            psychiatrist_id = EXCLUDED.psychiatrist_id,
            answers_json = EXCLUDED.answers_json,
            created_at = NOW()
          `,
          [...structuredValues, JSON.stringify(answers)]
        )
      } else if (hasLegacyUpdatedAt) {
        await dbPool.query(
          `
          INSERT INTO questionnaire (
            student_id,
            mentalhealthsupport,
            concerns,
            period_affected,
            support_type,
            support_preferences,
            religion,
            religion_type,
            spiritual_status,
            therapy_status,
            seek_support,
            expectations,
            session_structure,
            communication,
            mentor_id,
            psychiatrist_id,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
          ON CONFLICT (student_id)
          DO UPDATE SET
            mentalhealthsupport = EXCLUDED.mentalhealthsupport,
            concerns = EXCLUDED.concerns,
            period_affected = EXCLUDED.period_affected,
            support_type = EXCLUDED.support_type,
            support_preferences = EXCLUDED.support_preferences,
            religion = EXCLUDED.religion,
            religion_type = EXCLUDED.religion_type,
            spiritual_status = EXCLUDED.spiritual_status,
            therapy_status = EXCLUDED.therapy_status,
            seek_support = EXCLUDED.seek_support,
            expectations = EXCLUDED.expectations,
            session_structure = EXCLUDED.session_structure,
            communication = EXCLUDED.communication,
            mentor_id = EXCLUDED.mentor_id,
            psychiatrist_id = EXCLUDED.psychiatrist_id,
            created_at = NOW(),
            updated_at = NOW()
          `,
          structuredValues
        )
      } else {
        await dbPool.query(
          `
          INSERT INTO questionnaire (
            student_id,
            mentalhealthsupport,
            concerns,
            period_affected,
            support_type,
            support_preferences,
            religion,
            religion_type,
            spiritual_status,
            therapy_status,
            seek_support,
            expectations,
            session_structure,
            communication,
            mentor_id,
            psychiatrist_id,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
          ON CONFLICT (student_id)
          DO UPDATE SET
            mentalhealthsupport = EXCLUDED.mentalhealthsupport,
            concerns = EXCLUDED.concerns,
            period_affected = EXCLUDED.period_affected,
            support_type = EXCLUDED.support_type,
            support_preferences = EXCLUDED.support_preferences,
            religion = EXCLUDED.religion,
            religion_type = EXCLUDED.religion_type,
            spiritual_status = EXCLUDED.spiritual_status,
            therapy_status = EXCLUDED.therapy_status,
            seek_support = EXCLUDED.seek_support,
            expectations = EXCLUDED.expectations,
            session_structure = EXCLUDED.session_structure,
            communication = EXCLUDED.communication,
            mentor_id = EXCLUDED.mentor_id,
            psychiatrist_id = EXCLUDED.psychiatrist_id,
            created_at = NOW()
          `,
          structuredValues
        )
      }

      if (hasLegacySupportPreference) {
        await dbPool.query('UPDATE questionnaire SET support_preference = $1 WHERE student_id = $2', [
          String(answers.support_preferences),
          resolvedStudentId,
        ])
      }

      await dbPool.query(
        `
        INSERT INTO assignments (username, student_id, mentor_id, psychiatrist_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (username)
        DO UPDATE SET
          student_id = EXCLUDED.student_id,
          mentor_id = EXCLUDED.mentor_id,
          psychiatrist_id = EXCLUDED.psychiatrist_id
        `,
        [studentResult.rows[0].username, resolvedStudentId, mentorId, psychiatristId]
      )

      const assignedTo = assigneeRole === 'mentor' ? 'mentor' : assigneeRole === 'psychiatrist' ? 'psychiatrist' : 'pending'

      return res.json({
        ok: true,
        message: 'Questionnaire saved successfully.',
        assignedTo,
        mentorScore: decision.mentorScore,
        psychiatristScore: decision.psychiatristScore,
      })
    } catch (err) {
      console.error('Questionnaire save failed:', err.message)
      return res.status(500).json({ error: `Failed to save questionnaire: ${err.message}` })
    }
  })

  app.post('/api/profile', async (req, res) => {
    try {
      const {
        signupId,
        role,
        fullName,
        username,
        gender,
        phoneNo,
        questionnaire,
        modeOfPayment,
        certification,
        licenceNumber,
        yearsOfExperience,
        billingDetails,
        bio,
        contactId,
        resourceId,
      } = req.body || {}
      const normalizedRole = sanitizeRole(role)
      const parsedSignupId = Number(signupId)

      if (!normalizedRole) return res.status(400).json({ error: 'Invalid role' })
      if (!Number.isInteger(parsedSignupId) || parsedSignupId <= 0) {
        return res.status(400).json({ error: 'Valid signupId is required' })
      }

      const signupRow = await dbPool.query(
        `
        SELECT signup_id, email, role, role_name, password_hash
        FROM signup
        WHERE signup_id = $1
        LIMIT 1
        `,
        [parsedSignupId]
      )
      if (!signupRow.rows[0]) return res.status(404).json({ error: 'Signup account not found' })

      const signup = signupRow.rows[0]
      const signupRole = sanitizeRole(signup.role || signup.role_name)
      if (signupRole !== normalizedRole) {
        return res.status(400).json({ error: 'Role does not match signup account' })
      }

      const email = String(signup.email || '')
      const passwordHash = String(signup.password_hash || '')

      let profileUserId = null
      if (normalizedRole === 'student') {
        const safeFullName = String(fullName || '').trim() || buildDisplayName(email)
        const safeUsername = String(username || '').trim() || buildStudentUsername(email)
        const safeGender = String(gender || '').trim() || null
        const safePhoneNo = phoneNo == null || String(phoneNo).trim() === '' ? null : Number(phoneNo)
        const safeQuestionnaire = String(questionnaire || '').trim() || null
        const safeModeOfPayment = String(modeOfPayment || '').trim() || null

        await dbPool.query(
          `
          CREATE TABLE IF NOT EXISTS student (
            student_id INT PRIMARY KEY,
            full_name VARCHAR(100) NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            username VARCHAR(100) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            gender VARCHAR(20),
            phone_no INT,
            questionnaire VARCHAR(250),
            mode_of_payment VARCHAR(50)
          )
          `
        )

        await dbPool.query(
          `
          INSERT INTO student (
            student_id, full_name, email, username, password_hash, gender, phone_no, questionnaire, mode_of_payment
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (student_id)
          DO UPDATE SET
            full_name = EXCLUDED.full_name,
            email = EXCLUDED.email,
            username = EXCLUDED.username,
            password_hash = EXCLUDED.password_hash,
            gender = EXCLUDED.gender,
            phone_no = EXCLUDED.phone_no,
            questionnaire = EXCLUDED.questionnaire,
            mode_of_payment = EXCLUDED.mode_of_payment
          `,
          [
            parsedSignupId,
            safeFullName,
            email,
            safeUsername,
            passwordHash,
            safeGender,
            safePhoneNo,
            safeQuestionnaire,
            safeModeOfPayment,
          ]
        )

        profileUserId = String(parsedSignupId)
        await syncLegacyStudentTableIfPresent(dbPool, Number(profileUserId))
      } else if (normalizedRole === 'mentor' || normalizedRole === 'psychiatrist') {
        const safeFullName = String(fullName || '').trim() || buildDisplayName(email)
        const safePhoneNo = phoneNo == null || String(phoneNo).trim() === '' ? null : Number(phoneNo)

        if (normalizedRole === 'mentor') {
          const safeBio = String(bio || '').trim() || null

          await dbPool.query(
            `
            CREATE TABLE IF NOT EXISTS mentor (
              mentor_id INT PRIMARY KEY,
              full_name VARCHAR(100) NOT NULL,
              email VARCHAR(100) UNIQUE NOT NULL,
              password_hash VARCHAR(255) NOT NULL,
              phone_no INT,
              bio VARCHAR(100),
              student_id INT,
              CONSTRAINT fk_mentor_student FOREIGN KEY (student_id) REFERENCES student(student_id)
            )
            `
          )

          await dbPool.query(
            `
            INSERT INTO mentor (mentor_id, full_name, email, password_hash, phone_no, bio, student_id)
            VALUES ($1, $2, $3, $4, $5, $6, NULL)
            ON CONFLICT (mentor_id)
            DO UPDATE SET
              full_name = EXCLUDED.full_name,
              email = EXCLUDED.email,
              password_hash = EXCLUDED.password_hash,
              phone_no = EXCLUDED.phone_no,
              bio = EXCLUDED.bio
            `,
            [parsedSignupId, safeFullName, email, passwordHash, safePhoneNo, safeBio]
          )

          profileUserId = String(parsedSignupId)
        } else {
          const safeCertification = String(certification || '').trim() || null
          const safeLicenceNumber = licenceNumber == null || String(licenceNumber).trim() === '' ? null : Number(licenceNumber)
          const safeYearsOfExperience =
            yearsOfExperience == null || String(yearsOfExperience).trim() === '' ? null : Number(yearsOfExperience)
          const safeBillingDetails = String(billingDetails || '').trim() || null

          await dbPool.query(
            `
            CREATE TABLE IF NOT EXISTS psychiatrist (
              psychiatrist_id INT PRIMARY KEY,
              full_name VARCHAR(100) NOT NULL,
              email VARCHAR(100) UNIQUE NOT NULL,
              password_hash VARCHAR(255) NOT NULL,
              phone_no INT,
              certification VARCHAR(100),
              licence_number INT,
              years_of_experience INT,
              billing_details VARCHAR(50),
              student_id INT,
              CONSTRAINT fk_psychiatrist_student FOREIGN KEY (student_id) REFERENCES student(student_id)
            )
            `
          )

          await dbPool.query(
            `
            INSERT INTO psychiatrist (
              psychiatrist_id,
              full_name,
              email,
              password_hash,
              phone_no,
              certification,
              licence_number,
              years_of_experience,
              billing_details,
              student_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)
            ON CONFLICT (psychiatrist_id)
            DO UPDATE SET
              full_name = EXCLUDED.full_name,
              email = EXCLUDED.email,
              password_hash = EXCLUDED.password_hash,
              phone_no = EXCLUDED.phone_no,
              certification = EXCLUDED.certification,
              licence_number = EXCLUDED.licence_number,
              years_of_experience = EXCLUDED.years_of_experience,
              billing_details = EXCLUDED.billing_details
            `,
            [
              parsedSignupId,
              safeFullName,
              email,
              passwordHash,
              safePhoneNo,
              safeCertification,
              safeLicenceNumber,
              safeYearsOfExperience,
              safeBillingDetails,
            ]
          )

          profileUserId = String(parsedSignupId)
        }
      } else if (normalizedRole === 'admin') {
        const safeContactId = contactId == null || String(contactId).trim() === '' ? null : Number(contactId)
        const safeResourceId = resourceId == null || String(resourceId).trim() === '' ? null : Number(resourceId)

        await dbPool.query('ALTER TABLE admins ADD COLUMN IF NOT EXISTS signup_id INT UNIQUE')

        const adminExisting = await dbPool.query('SELECT admin_id FROM admins WHERE signup_id = $1 LIMIT 1', [parsedSignupId])

        if (adminExisting.rows[0]) {
          const updated = await dbPool.query(
            `
            UPDATE admins
            SET password_hash = $1,
                contact_id = $2,
                resource_id = $3
            WHERE signup_id = $4
            RETURNING admin_id
            `,
            [passwordHash, safeContactId, safeResourceId, parsedSignupId]
          )
          profileUserId = String(updated.rows[0].admin_id)
        } else {
          const created = await dbPool.query(
            `
            INSERT INTO admins (password_hash, contact_id, resource_id, signup_id)
            VALUES ($1, $2, $3, $4)
            RETURNING admin_id
            `,
            [passwordHash, safeContactId, safeResourceId, parsedSignupId]
          )
          profileUserId = String(created.rows[0].admin_id)
        }
      }

      if (!profileUserId) return res.status(500).json({ error: 'Failed to create profile' })

      let redirectTo = dashboardPath(normalizedRole)
      let needsQuestionnaire = false
      if (normalizedRole === 'student') {
        const q = await dbPool.query('SELECT questionnaire_id FROM questionnaire WHERE student_id = $1 LIMIT 1', [Number(profileUserId)])
        needsQuestionnaire = !q.rows[0]
        redirectTo = needsQuestionnaire ? 'questionnaire.html' : 'student.html'
      }

      return res.json({
        ok: true,
        role: normalizedRole,
        signupId: String(parsedSignupId),
        userId: profileUserId,
        profileComplete: true,
        needsQuestionnaire,
        redirectTo,
      })
    } catch (err) {
      console.error('Profile save failed:', err.message)
      return res.status(500).json({ error: 'Failed to save profile' })
    }
  })

  app.get('/api/questionnaire/assigned-view', async (req, res) => {
    try {
      const role = sanitizeRole(req.query.role)
      const userId = Number(req.query.userId)
      if (!role || !Number.isInteger(userId)) return res.status(400).json({ error: 'role and userId are required' })

      if (role === 'mentor') {
        const result = await dbPool.query(
          `
          SELECT
            q.student_id,
            s.username,
            q.created_at,
            q.mentalhealthsupport,
            q.concerns,
            q.religion,
            q.religion_type,
            q.spiritual_status,
            q.seek_support,
            q.expectations,
            EXISTS (
              SELECT 1
              FROM messages m
              WHERE m.student_id = q.student_id
                AND m.mentor_id = q.mentor_id
            ) AS has_contact
          FROM questionnaire q
          INNER JOIN student s ON s.student_id = q.student_id
          WHERE q.mentor_id = $1
          ORDER BY q.created_at DESC
          `,
          [userId]
        )
        return res.json({ ok: true, rows: result.rows })
      }

      if (role === 'psychiatrist') {
        const result = await dbPool.query(
          `
          SELECT
            q.student_id,
            s.username,
            q.created_at,
            q.mentalhealthsupport,
            q.concerns,
            q.religion,
            q.religion_type,
            q.spiritual_status,
            q.therapy_status,
            q.seek_support,
            q.expectations,
            EXISTS (
              SELECT 1
              FROM messages m
              WHERE m.student_id = q.student_id
                AND m.psychiatrist_id = q.psychiatrist_id
            ) AS has_contact
          FROM questionnaire q
          INNER JOIN student s ON s.student_id = q.student_id
          WHERE q.psychiatrist_id = $1
          ORDER BY q.created_at DESC
          `,
          [userId]
        )
        return res.json({ ok: true, rows: result.rows })
      }

      return res.status(400).json({ error: 'Only mentor or psychiatrist can access assigned questionnaire view' })
    } catch (err) {
      console.error('Failed to load assigned questionnaire view:', err.message)
      return res.status(500).json({ error: 'Failed to load assigned questionnaire view' })
    }
  })

  app.get('/api/student/assigned-support', async (req, res) => {
    try {
      const studentId = Number(req.query.studentId)
      if (!Number.isInteger(studentId) || studentId <= 0) {
        return res.status(400).json({ error: 'Valid studentId is required' })
      }

      const tableExists = async (tableName) => {
        const check = await dbPool.query('SELECT to_regclass($1) AS reg', [`public.${tableName}`])
        return Boolean(check.rows[0] && check.rows[0].reg)
      }

      const questionnaireHasId = await dbPool.query(
        `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'questionnaire'
            AND column_name = 'questionnaire_id'
        ) AS exists
        `
      )

      let resolvedStudentId = studentId

      const studentTable = (await tableExists('student')) ? 'student' : (await tableExists('students')) ? 'students' : null
      if (studentTable === 'student') {
        const bySignup = await dbPool.query('SELECT student_id FROM student WHERE signup_id = $1 LIMIT 1', [studentId])
        if (bySignup.rows[0]) resolvedStudentId = Number(bySignup.rows[0].student_id)
      } else if (studentTable === 'students') {
        const bySignup = await dbPool.query('SELECT student_id FROM students WHERE signup_id = $1 LIMIT 1', [studentId])
        if (bySignup.rows[0]) resolvedStudentId = Number(bySignup.rows[0].student_id)
      }

      const assignment = await dbPool.query(
        `
        SELECT mentor_id, psychiatrist_id
        FROM questionnaire
        WHERE student_id = $1
        ${questionnaireHasId.rows[0] && questionnaireHasId.rows[0].exists ? 'ORDER BY questionnaire_id DESC' : ''}
        LIMIT 1
        `,
        [resolvedStudentId]
      )

      const row = assignment.rows[0]
      if (!row || (!row.mentor_id && !row.psychiatrist_id)) {
        return res.json({ ok: true, assigned: false })
      }

      if (row.mentor_id) {
        const mentorTable = (await tableExists('mentor')) ? 'mentor' : (await tableExists('mentors')) ? 'mentors' : null
        if (!mentorTable) {
          return res.json({ ok: true, assigned: false })
        }

        const mentorProfile = await dbPool.query(
          `
          SELECT to_jsonb(m) AS profile
          FROM ${mentorTable} m
          WHERE m.mentor_id = $1
          LIMIT 1
          `,
          [Number(row.mentor_id)]
        )

        if (!mentorProfile.rows[0]) {
          return res.json({ ok: true, assigned: false })
        }

        return res.json({
          ok: true,
          assigned: true,
          assignedRole: 'mentor',
          assignedId: Number(row.mentor_id),
          profile: mentorProfile.rows[0].profile || {},
        })
      }

      const psychiatristTable = (await tableExists('psychiatrist'))
        ? 'psychiatrist'
        : (await tableExists('psychiatrists'))
          ? 'psychiatrists'
          : null
      if (!psychiatristTable) {
        return res.json({ ok: true, assigned: false })
      }

      const psychiatristProfile = await dbPool.query(
        `
        SELECT to_jsonb(p) AS profile
        FROM ${psychiatristTable} p
        WHERE p.psychiatrist_id = $1
        LIMIT 1
        `,
        [Number(row.psychiatrist_id)]
      )

      if (!psychiatristProfile.rows[0]) {
        return res.json({ ok: true, assigned: false })
      }

      return res.json({
        ok: true,
        assigned: true,
        assignedRole: 'psychiatrist',
        assignedId: Number(row.psychiatrist_id),
        profile: psychiatristProfile.rows[0].profile || {},
      })
    } catch (err) {
      console.error('Failed to load student assigned support:', err.message)
      return res.status(500).json({ error: 'Failed to load assigned support profile' })
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

