const path = require('path')
const express = require('express')
const WebSocket = require('ws')
const http = require('http')
require('dotenv').config({ path: path.join(__dirname, '.env') })
const { Pool } = require('pg')

const app = express()
const projectRoot = path.resolve(__dirname, '..')
app.use(express.json())

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

function normalizeTherapistType(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'psychologist') return 'psychiatrist'
  if (normalized === 'mentor' || normalized === 'psychiatrist') return normalized
  return ''
}

function toUtcDateFloor(dateInput) {
  const date = new Date(dateInput)
  if (Number.isNaN(date.getTime())) return null
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0))
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value), 10)
  if (Number.isNaN(parsed) || parsed <= 0) return null
  return parsed
}

function canMutateAppointmentDate(dateInput) {
  const slotDay = toUtcDateFloor(dateInput)
  if (!slotDay) return false
  const today = toUtcDateFloor(new Date())
  return slotDay >= today
}

function getWorkingWindowForDate(dateInput) {
  const date = new Date(dateInput)
  if (Number.isNaN(date.getTime())) return null

  const day = date.getUTCDay()
  if (day === 0) {
    return null // Sunday: closed
  }
  if (day === 6) {
    return { startMinutes: 9 * 60, endMinutes: 12 * 60 } // Saturday: 09:00-12:00
  }
  return { startMinutes: 8 * 60, endMinutes: 17 * 60 } // Monday-Friday: 08:00-17:00
}

function toUtcMinutes(dateInput) {
  const date = new Date(dateInput)
  if (Number.isNaN(date.getTime())) return null
  return (date.getUTCHours() * 60) + date.getUTCMinutes()
}

function isWithinWorkingHours(startAt, endAt) {
  const start = new Date(startAt)
  const end = new Date(endAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return false
  }

  // Appointments must start and end on the same UTC calendar day.
  if (
    start.getUTCFullYear() !== end.getUTCFullYear()
    || start.getUTCMonth() !== end.getUTCMonth()
    || start.getUTCDate() !== end.getUTCDate()
  ) {
    return false
  }

  const window = getWorkingWindowForDate(start)
  if (!window) return false

  const startMinutes = toUtcMinutes(start)
  const endMinutes = toUtcMinutes(end)
  if (startMinutes == null || endMinutes == null) return false

  return startMinutes >= window.startMinutes && endMinutes <= window.endMinutes
}

async function createGoogleCalendarEvent({ summary, description, startAt, endAt }) {
  const enabled = String(process.env.GOOGLE_CALENDAR_SYNC_ENABLED || '').toLowerCase() === 'true'
  if (!enabled) {
    return { eventId: null, syncStatus: 'not_configured', syncError: null }
  }

  const calendarId = process.env.GOOGLE_CALENDAR_ID
  const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
  if (!calendarId || !serviceAccountPath) {
    return {
      eventId: null,
      syncStatus: 'failed',
      syncError: 'Missing GOOGLE_CALENDAR_ID or GOOGLE_SERVICE_ACCOUNT_KEY_PATH',
    }
  }

  try {
    const { google } = require('googleapis')
    const auth = new google.auth.GoogleAuth({
      keyFile: serviceAccountPath,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    })

    const calendar = google.calendar({ version: 'v3', auth })
    const response = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary,
        description,
        start: { dateTime: new Date(startAt).toISOString() },
        end: { dateTime: new Date(endAt).toISOString() },
      },
    })

    return {
      eventId: response.data?.id || null,
      syncStatus: response.data?.id ? 'synced' : 'failed',
      syncError: response.data?.id ? null : 'Google Calendar did not return an event id',
    }
  } catch (err) {
    return {
      eventId: null,
      syncStatus: 'failed',
      syncError: err?.message || 'Google Calendar sync failed',
    }
  }
}

const frontendPages = new Set([
  'tuliza-frontend.html',
  'chat-ui.html',
  'resources.html',
  'resource-detail.html',
  'journal.html',
  'account.html',
  'mentor.html',
  'psychologist.html',
  'admin.html',
])

/* Serve static files from the root directory */
app.use(express.static(projectRoot))

/* Route to serve HTML file from root directory */
app.get('/', (req, res) => {
  res.sendFile(path.join(projectRoot, 'frontend', 'tuliza-frontend.html'))
})

// Support clean page URLs such as /chat-ui.html used by navbar links.
app.get('/:page', (req, res, next) => {
  const { page } = req.params
  if (!frontendPages.has(page)) {
    next()
    return
  }
  res.sendFile(path.join(projectRoot, 'frontend', page))
})

// Keep compatibility with direct /frontend/*.html links.
app.get('/frontend/:page', (req, res, next) => {
  const { page } = req.params
  if (!frontendPages.has(page)) {
    next()
    return
  }
  res.sendFile(path.join(projectRoot, 'frontend', page))
})

/* Route to indicate chat server is running */
app.get('/server', (req, res) => {
  res.send('Chat server running')
})

app.get('/api/users/resolve-id', async (req, res) => {
  const role = normalizeRole(req.query.role)
  const identifier = String(req.query.identifier || '').trim()

  if (!identifier || (role !== 'student' && role !== 'mentor' && role !== 'psychiatrist')) {
    res.status(400).json({ error: 'role (student|mentor|psychiatrist) and identifier are required.' })
    return
  }

  try {
    if (role === 'student') {
      const result = await dbPool.query(
        `
        SELECT students_id AS id
        FROM students
        WHERE LOWER(email) = LOWER($1)
           OR LOWER(username) = LOWER($1)
        LIMIT 1
        `,
        [identifier]
      )

      if (!result.rows.length) {
        res.status(404).json({ error: 'No student record matches this account.' })
        return
      }

      res.json({ role: 'student', userId: Number(result.rows[0].id) })
      return
    }

    if (role === 'mentor') {
      const result = await dbPool.query(
        `
        SELECT mentors_id AS id
        FROM mentors
        WHERE LOWER(email) = LOWER($1)
           OR LOWER(full_name) = LOWER($1)
        LIMIT 1
        `,
        [identifier]
      )

      if (!result.rows.length) {
        res.status(404).json({ error: 'No mentor record matches this account.' })
        return
      }

      res.json({ role: 'mentor', userId: Number(result.rows[0].id) })
      return
    }

    const result = await dbPool.query(
      `
      SELECT psychiatrists_id AS id
      FROM psychiatrists
      WHERE LOWER(email) = LOWER($1)
         OR LOWER(full_name) = LOWER($1)
      LIMIT 1
      `,
      [identifier]
    )

    if (!result.rows.length) {
      res.status(404).json({ error: 'No psychologist record matches this account.' })
      return
    }

    res.json({ role: 'psychiatrist', userId: Number(result.rows[0].id) })
  } catch (err) {
    console.error('Failed to resolve user id:', err.message)
    res.status(500).json({ error: 'Could not resolve user ID.' })
  }
})

app.get('/api/therapists', async (req, res) => {
  const type = normalizeTherapistType(req.query.type)
  if (!type) {
    res.status(400).json({ error: 'type (mentor|psychiatrist) is required.' })
    return
  }

  try {
    if (type === 'mentor') {
      const result = await dbPool.query(
        `
        SELECT mentors_id AS therapist_id, full_name AS display_name
        FROM mentors
        ORDER BY mentors_id ASC
        `
      )

      res.json({
        type,
        therapists: result.rows.map((row) => ({
          therapistId: Number(row.therapist_id),
          displayName: row.display_name || `Mentor ${row.therapist_id}`,
        })),
      })
      return
    }

    const result = await dbPool.query(
      `
      SELECT psychiatrists_id AS therapist_id, full_name AS display_name
      FROM psychiatrists
      ORDER BY psychiatrists_id ASC
      `
    )

    res.json({
      type,
      therapists: result.rows.map((row) => ({
        therapistId: Number(row.therapist_id),
        displayName: row.display_name || `Psychologist ${row.therapist_id}`,
      })),
    })
  } catch (err) {
    console.error('Failed to load therapists:', err.message)
    res.status(500).json({ error: 'Failed to load therapists.' })
  }
})

app.get('/api/appointments/availability', async (req, res) => {
  const therapistType = normalizeTherapistType(req.query.therapistType)
  const therapistId = parsePositiveInt(req.query.therapistId)
  const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : new Date()
  const days = Math.min(parsePositiveInt(req.query.days) || 14, 31)

  if (!therapistType || !therapistId) {
    res.status(400).json({ error: 'therapistType and therapistId are required.' })
    return
  }

  const startDateFloor = toUtcDateFloor(startDate)
  if (!startDateFloor) {
    res.status(400).json({ error: 'Invalid startDate.' })
    return
  }

  const todayFloor = toUtcDateFloor(new Date())
  const effectiveStart = startDateFloor < todayFloor ? todayFloor : startDateFloor
  const endDate = new Date(effectiveStart)
  endDate.setUTCDate(endDate.getUTCDate() + days)

  try {
    const availabilityRows = await dbPool.query(
      `
      SELECT
        availability_id,
        start_at,
        end_at,
        is_available
      FROM therapist_availability
      WHERE therapist_type = $1
        AND therapist_id = $2
        AND start_at >= $3
        AND start_at < $4
      ORDER BY start_at ASC
      `,
      [therapistType, therapistId, effectiveStart.toISOString(), endDate.toISOString()]
    )

    const bookedRows = await dbPool.query(
      `
      SELECT availability_id
      FROM appointments
      WHERE therapist_type = $1
        AND therapist_id = $2
        AND slot_start >= $3
        AND slot_start < $4
        AND status = 'booked'
      `,
      [therapistType, therapistId, effectiveStart.toISOString(), endDate.toISOString()]
    )

    const bookedIds = new Set(bookedRows.rows.map((row) => Number(row.availability_id)))
    const slots = availabilityRows.rows.map((row) => {
      if (!isWithinWorkingHours(row.start_at, row.end_at)) {
        return null
      }

      const availableFlag = Boolean(row.is_available) && !bookedIds.has(Number(row.availability_id))
      return {
        availabilityId: Number(row.availability_id),
        startAt: toIsoString(row.start_at),
        endAt: toIsoString(row.end_at),
        status: availableFlag ? 'available' : 'unavailable',
      }
    }).filter(Boolean)

    res.json({
      therapistType,
      therapistId,
      range: {
        from: effectiveStart.toISOString(),
        to: endDate.toISOString(),
      },
      slots,
    })
  } catch (err) {
    console.error('Failed to load therapist availability:', err.message)
    res.status(500).json({ error: 'Failed to load therapist availability.' })
  }
})

app.post('/api/appointments/availability', async (req, res) => {
  const therapistType = normalizeTherapistType(req.body?.therapistType)
  const therapistId = parsePositiveInt(req.body?.therapistId)
  const slots = Array.isArray(req.body?.slots) ? req.body.slots : []

  if (!therapistType || !therapistId || slots.length === 0) {
    res.status(400).json({ error: 'therapistType, therapistId, and at least one slot are required.' })
    return
  }

  const normalizedSlots = []
  for (const slot of slots) {
    const startAt = new Date(slot?.startAt)
    const endAt = new Date(slot?.endAt)
    const isAvailable = slot?.isAvailable !== false

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      res.status(400).json({ error: 'Each slot must include valid startAt and endAt values.' })
      return
    }

    if (!canMutateAppointmentDate(startAt)) {
      res.status(400).json({ error: 'Only upcoming days can be updated for availability.' })
      return
    }

    if (!isWithinWorkingHours(startAt, endAt)) {
      res.status(400).json({ error: 'Working hours are Monday-Friday 08:00-17:00, Saturday 09:00-12:00, Sunday closed.' })
      return
    }

    normalizedSlots.push({
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      isAvailable,
    })
  }

  const client = await dbPool.connect()
  try {
    await client.query('BEGIN')

    for (const slot of normalizedSlots) {
      await client.query(
        `
        INSERT INTO therapist_availability (
          therapist_type,
          therapist_id,
          start_at,
          end_at,
          is_available,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (therapist_type, therapist_id, start_at, end_at)
        DO UPDATE
        SET is_available = EXCLUDED.is_available,
            updated_at = NOW()
        `,
        [therapistType, therapistId, slot.startAt, slot.endAt, slot.isAvailable]
      )
    }

    await client.query('COMMIT')
    res.status(201).json({
      therapistType,
      therapistId,
      updatedSlots: normalizedSlots.length,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Failed to update availability:', err.message)
    res.status(500).json({ error: 'Failed to update therapist availability.' })
  } finally {
    client.release()
  }
})

app.post('/api/appointments', async (req, res) => {
  const studentId = parsePositiveInt(req.body?.studentId)
  const therapistType = normalizeTherapistType(req.body?.therapistType)
  const therapistId = parsePositiveInt(req.body?.therapistId)
  const availabilityId = parsePositiveInt(req.body?.availabilityId)
  const note = String(req.body?.note || '').slice(0, 500)

  if (!studentId || !therapistType || !therapistId || !availabilityId) {
    res.status(400).json({ error: 'studentId, therapistType, therapistId, and availabilityId are required.' })
    return
  }

  const client = await dbPool.connect()
  try {
    await client.query('BEGIN')

    const availabilityResult = await client.query(
      `
      SELECT availability_id, start_at, end_at, is_available
      FROM therapist_availability
      WHERE availability_id = $1
        AND therapist_type = $2
        AND therapist_id = $3
      FOR UPDATE
      `,
      [availabilityId, therapistType, therapistId]
    )

    if (availabilityResult.rows.length === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Selected slot was not found.' })
      return
    }

    const slot = availabilityResult.rows[0]
    if (!canMutateAppointmentDate(slot.start_at)) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'Past-day slots cannot be booked or updated.' })
      return
    }

    if (!isWithinWorkingHours(slot.start_at, slot.end_at)) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: 'This slot is outside therapist working hours.' })
      return
    }

    if (!slot.is_available) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'This slot is no longer available.' })
      return
    }

    const existingAppointment = await client.query(
      `
      SELECT appointment_id
      FROM appointments
      WHERE availability_id = $1
        AND status = 'booked'
      FOR UPDATE
      `,
      [availabilityId]
    )

    if (existingAppointment.rows.length > 0) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'This slot has already been booked.' })
      return
    }

    const appointmentInsert = await client.query(
      `
      INSERT INTO appointments (
        students_id,
        therapist_type,
        therapist_id,
        availability_id,
        slot_start,
        slot_end,
        status,
        note
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'booked', $7)
      RETURNING appointment_id, slot_start, slot_end
      `,
      [studentId, therapistType, therapistId, availabilityId, slot.start_at, slot.end_at, note || null]
    )

    await client.query(
      `
      UPDATE therapist_availability
      SET is_available = FALSE,
          updated_at = NOW()
      WHERE availability_id = $1
      `,
      [availabilityId]
    )

    const appointment = appointmentInsert.rows[0]
    const googleSync = await createGoogleCalendarEvent({
      summary: `Tuliza Appointment (${therapistType})`,
      description: `Student ${studentId} booked with ${therapistType} ${therapistId}`,
      startAt: appointment.slot_start,
      endAt: appointment.slot_end,
    })

    await client.query(
      `
      UPDATE appointments
      SET google_event_id = $2,
          google_sync_status = $3,
          google_sync_error = $4,
          updated_at = NOW()
      WHERE appointment_id = $1
      `,
      [appointment.appointment_id, googleSync.eventId, googleSync.syncStatus, googleSync.syncError]
    )

    await client.query('COMMIT')

    res.status(201).json({
      appointmentId: Number(appointment.appointment_id),
      slotStart: toIsoString(appointment.slot_start),
      slotEnd: toIsoString(appointment.slot_end),
      googleCalendar: {
        status: googleSync.syncStatus,
        eventId: googleSync.eventId,
        error: googleSync.syncError,
      },
    })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Failed to book appointment:', err.message)
    res.status(500).json({ error: 'Failed to book appointment.' })
  } finally {
    client.release()
  }
})

app.get('/api/appointments/booked', async (req, res) => {
  const therapistType = normalizeTherapistType(req.query.therapistType)
  const therapistId = parsePositiveInt(req.query.therapistId)
  const days = Math.min(parsePositiveInt(req.query.days) || 30, 90)

  if (!therapistType || !therapistId) {
    res.status(400).json({ error: 'therapistType and therapistId are required.' })
    return
  }

  const startDate = toUtcDateFloor(new Date())
  const endDate = new Date(startDate)
  endDate.setUTCDate(endDate.getUTCDate() + days)

  try {
    const result = await dbPool.query(
      `
      SELECT
        a.appointment_id,
        a.students_id,
        s.username AS student_name,
        a.slot_start,
        a.slot_end,
        a.status,
        a.note
      FROM appointments a
      LEFT JOIN students s ON s.students_id = a.students_id
      WHERE a.therapist_type = $1
        AND a.therapist_id = $2
        AND a.slot_start >= $3
        AND a.slot_start < $4
      ORDER BY a.slot_start ASC
      `,
      [therapistType, therapistId, startDate.toISOString(), endDate.toISOString()]
    )

    const appointments = result.rows.map((row) => ({
      appointmentId: Number(row.appointment_id),
      studentId: Number(row.students_id),
      studentName: row.student_name || `Student ${row.students_id}`,
      slotStart: toIsoString(row.slot_start),
      slotEnd: toIsoString(row.slot_end),
      status: row.status,
      note: row.note,
    }))

    res.json({
      therapistType,
      therapistId,
      appointments,
    })
  } catch (err) {
    console.error('Failed to load booked appointments:', err.message)
    res.status(500).json({ error: 'Failed to load booked appointments.' })
  }
})

/* Create an HTTP server with Express app */
const server = http.createServer(app)

/* Initialize WebSocket server and bind it to the HTTP server */
const wss = new WebSocket.Server({
  server,
  verifyClient: (info, done) => {
    const origin = info.origin || info.req.headers.origin
    const path = info.req.url || ''
    if (!path.startsWith('/server')) {
      done(false, 404, 'Invalid websocket path')
      return
    }

    if (!isAllowedOrigin(origin)) {
      done(false, 403, 'Forbidden origin')
      return
    }

    done(true)
  },
})

// Prevent unhandled WebSocketServer errors during server startup retries.
wss.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') {
    console.error('WebSocket server error:', err.message)
  }
})

const dbPool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
})

async function findByIdAcrossRoles(userIdNumber, roleHint) {
  const normalizedHint = normalizeRole(roleHint)

  const checks = []
  if (!normalizedHint || normalizedHint === 'student') {
    checks.push(
      dbPool.query(
        'SELECT students_id AS id, username AS display_name FROM students WHERE students_id = $1 LIMIT 1',
        [userIdNumber]
      ).then((res) => ({ role: 'student', rows: res.rows }))
    )
  }

  if (!normalizedHint || normalizedHint === 'mentor') {
    checks.push(
      dbPool.query(
        'SELECT mentors_id AS id, full_name AS display_name FROM mentors WHERE mentors_id = $1 LIMIT 1',
        [userIdNumber]
      ).then((res) => ({ role: 'mentor', rows: res.rows }))
    )
  }

  if (!normalizedHint || normalizedHint === 'psychiatrist') {
    checks.push(
      dbPool.query(
        'SELECT psychiatrists_id AS id, full_name AS display_name FROM psychiatrists WHERE psychiatrists_id = $1 LIMIT 1',
        [userIdNumber]
      ).then((res) => ({ role: 'psychiatrist', rows: res.rows }))
    )
  }

  const results = await Promise.all(checks)
  const matches = results.filter((entry) => entry.rows.length > 0)
  if (matches.length !== 1) return null

  const matched = matches[0]
  return {
    userId: String(matched.rows[0].id),
    role: matched.role,
    displayName: matched.rows[0].display_name || String(matched.rows[0].id),
  }
}

async function findLatestPeer(userId, role) {
  if (role === 'student') {
    const result = await dbPool.query(
      `
      SELECT mentors_id, psychiatrists_id
      FROM messages
      WHERE students_id = $1
      ORDER BY sent_at DESC NULLS LAST, message_id DESC
      LIMIT 1
      `,
      [Number(userId)]
    )

    const row = result.rows[0]
    if (!row) return { peerUserId: null, peerRole: null }
    if (row.mentors_id != null) return { peerUserId: String(row.mentors_id), peerRole: 'mentor' }
    if (row.psychiatrists_id != null) return { peerUserId: String(row.psychiatrists_id), peerRole: 'psychiatrist' }
    return { peerUserId: null, peerRole: null }
  }

  if (role === 'mentor') {
    const result = await dbPool.query(
      `
      SELECT students_id
      FROM messages
      WHERE mentors_id = $1
      ORDER BY sent_at DESC NULLS LAST, message_id DESC
      LIMIT 1
      `,
      [Number(userId)]
    )

    const row = result.rows[0]
    return { peerUserId: row?.students_id != null ? String(row.students_id) : null, peerRole: 'student' }
  }

  const result = await dbPool.query(
    `
    SELECT students_id
    FROM messages
    WHERE psychiatrists_id = $1
    ORDER BY sent_at DESC NULLS LAST, message_id DESC
    LIMIT 1
    `,
    [Number(userId)]
  )

  const row = result.rows[0]
  return { peerUserId: row?.students_id != null ? String(row.students_id) : null, peerRole: 'student' }
}

async function resolveParticipantContext(userId, roleHint, peerUserIdHint, peerRoleHint) {
  const parsedUserId = Number.parseInt(String(userId), 10)
  if (Number.isNaN(parsedUserId)) return null

  const base = await findByIdAcrossRoles(parsedUserId, roleHint)
  if (!base) return null

  let peerUserId = null
  let peerRole = null

  const hintedPeerRole = normalizeRole(peerRoleHint)
  if (peerUserIdHint) {
    const parsedPeer = Number.parseInt(String(peerUserIdHint), 10)
    if (!Number.isNaN(parsedPeer)) {
      const peer = await findByIdAcrossRoles(parsedPeer, hintedPeerRole)
      if (peer) {
        if (base.role === 'student' && (peer.role === 'mentor' || peer.role === 'psychiatrist')) {
          peerUserId = peer.userId
          peerRole = peer.role
        }
        if (base.role !== 'student' && peer.role === 'student') {
          peerUserId = peer.userId
          peerRole = peer.role
        }
      }
    }
  }

  if (!peerUserId || !peerRole) {
    const latestPeer = await findLatestPeer(base.userId, base.role)
    peerUserId = latestPeer.peerUserId
    peerRole = latestPeer.peerRole
  }

  return {
    userId: base.userId,
    role: base.role,
    displayName: base.displayName,
    peerUserId,
    peerRole,
  }
}

async function loadConversationHistory(context, limit = 100) {
  if (!context.peerUserId || !context.peerRole) return []

  const params = [Number(context.userId), Number(context.peerUserId), Number(limit)]
  let sql

  if (context.role === 'student' && context.peerRole === 'mentor') {
    sql = `
      SELECT message_id, sent_message, received_message, sent_at, students_id, mentors_id, psychiatrists_id
      FROM messages
      WHERE students_id = $1 AND mentors_id = $2
      ORDER BY sent_at ASC NULLS FIRST, message_id ASC
      LIMIT $3
    `
  } else if (context.role === 'student' && context.peerRole === 'psychiatrist') {
    sql = `
      SELECT message_id, sent_message, received_message, sent_at, students_id, mentors_id, psychiatrists_id
      FROM messages
      WHERE students_id = $1 AND psychiatrists_id = $2
      ORDER BY sent_at ASC NULLS FIRST, message_id ASC
      LIMIT $3
    `
  } else if (context.role === 'mentor' && context.peerRole === 'student') {
    sql = `
      SELECT message_id, sent_message, received_message, sent_at, students_id, mentors_id, psychiatrists_id
      FROM messages
      WHERE mentors_id = $1 AND students_id = $2
      ORDER BY sent_at ASC NULLS FIRST, message_id ASC
      LIMIT $3
    `
  } else {
    sql = `
      SELECT message_id, sent_message, received_message, sent_at, students_id, mentors_id, psychiatrists_id
      FROM messages
      WHERE psychiatrists_id = $1 AND students_id = $2
      ORDER BY sent_at ASC NULLS FIRST, message_id ASC
      LIMIT $3
    `
  }

  const result = await dbPool.query(sql, params)

  return result.rows
    .map((row) => {
      const isStudentMessage = row.sent_message != null && String(row.sent_message).trim().length > 0
      const text = isStudentMessage ? row.sent_message : row.received_message
      if (!text || String(text).trim().length === 0) return null

      let fromRole = 'student'
      let sender = row.students_id != null ? String(row.students_id) : ''
      if (!isStudentMessage) {
        if (row.mentors_id != null) {
          fromRole = 'mentor'
          sender = String(row.mentors_id)
        } else {
          fromRole = 'psychiatrist'
          sender = row.psychiatrists_id != null ? String(row.psychiatrists_id) : ''
        }
      }

      return {
        type: 'message',
        messageId: String(row.message_id),
        sender,
        text: String(text),
        timestamp: toIsoString(row.sent_at),
        fromRole,
      }
    })
    .filter(Boolean)
}

async function persistMessage(context, text) {
  const isStudentSender = context.role === 'student'
  const sentMessage = isStudentSender ? text : null
  const receivedMessage = isStudentSender ? null : text
  const studentsId = context.role === 'student' ? Number(context.userId) : Number(context.peerUserId)
  const mentorsId = context.role === 'mentor' ? Number(context.userId) : (context.peerRole === 'mentor' ? Number(context.peerUserId) : null)
  const psychiatristsId = context.role === 'psychiatrist' ? Number(context.userId) : (context.peerRole === 'psychiatrist' ? Number(context.peerUserId) : null)

  const result = await dbPool.query(
    `
    INSERT INTO messages (sent_message, received_message, sent_at, students_id, mentors_id, psychiatrists_id)
    VALUES ($1, $2, NOW(), $3, $4, $5)
    RETURNING message_id, sent_at
    `,
    [sentMessage, receivedMessage, studentsId, mentorsId, psychiatristsId]
  )

  return result.rows[0]
}

// Map: userId -> Set<WebSocket>
const userSockets = new Map()

function addSocketForUser(userId, ws) {
  const current = userSockets.get(userId) || new Set()
  current.add(ws)
  userSockets.set(userId, current)
}

function removeSocketForUser(userId, ws) {
  const current = userSockets.get(userId)
  if (!current) return
  current.delete(ws)
  if (current.size === 0) {
    userSockets.delete(userId)
  }
}

function deliverToUser(userId, payload) {
  const targets = userSockets.get(userId)
  if (!targets) return

  targets.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(payload))
    }
  })
}

function sendWsError(ws, reason) {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(
    JSON.stringify({
      type: 'error',
      reason,
    })
  )
}

/* Handle WebSocket connections */
wss.on('connection', (ws) => {
  ws.userContext = null
  ws.isAuthorized = false

  ws.on('error', (err) => {
    console.warn('WebSocket client error:', err.message)
  })

  ws.on('message', async (message) => {
    let messageObject
    try {
      messageObject = JSON.parse(message.toString())
    } catch (_) {
      return
    }

    const { type } = messageObject

    // JOIN: { type:'join', userId }
    if (type === 'join') {
      const { userId, roleHint, peerUserId, peerRole, authToken } = messageObject
      if (!userId) return

      const expectedToken = process.env.TULIZA_WS_TOKEN
      if (expectedToken && authToken !== expectedToken) {
        ws.close(1008, 'Unauthorized')
        return
      }

      let context
      try {
        context = await resolveParticipantContext(String(userId), roleHint, peerUserId, peerRole)
      } catch (err) {
        console.error('Failed to resolve chat context:', err.message)
        ws.close(1011, 'Failed to resolve user context')
        return
      }

      if (!context) {
        ws.close(1008, 'Unknown user ID or role')
        return
      }

      ws.isAuthorized = true
      ws.userContext = context
      addSocketForUser(context.userId, ws)

      ws.send(JSON.stringify({
        type: 'joined',
        userId: context.userId,
        displayName: context.displayName,
        role: context.role,
        peerUserId: context.peerUserId,
        peerRole: context.peerRole,
      }))

      try {
        const history = await loadConversationHistory(context)
        ws.send(
          JSON.stringify({
            type: 'history',
            messages: history,
          })
        )
      } catch (err) {
        console.warn('Failed to load message history:', err.message)
      }

      return
    }

    if (!ws.isAuthorized || !ws.userContext) return

    if (type !== 'message') {
      return
    }

    const { sender, text } = messageObject
    if (!sender || !text) return
    if (String(sender) !== String(ws.userContext.userId)) return
    if (!ws.userContext.peerUserId || !ws.userContext.peerRole) {
      sendWsError(ws, 'No active counterpart found for this user ID.')
      return
    }

    let stored
    try {
      stored = await persistMessage(ws.userContext, String(text))
    } catch (err) {
      console.warn('Failed to store message:', err.message)
      sendWsError(ws, 'Message could not be saved to the database.')
      return
    }

    const outboundMessage = {
      type: 'message',
      messageId: String(stored.message_id),
      sender: String(sender),
      text: String(text),
      timestamp: toIsoString(stored.sent_at),
      fromRole: roleLabel(ws.userContext.role),
      toRole: roleLabel(ws.userContext.peerRole),
      toUserId: String(ws.userContext.peerUserId),
    }

    // Echo to all tabs of sender + receiver so both dashboards stay consistent.
    deliverToUser(ws.userContext.userId, outboundMessage)
    deliverToUser(ws.userContext.peerUserId, outboundMessage)
  })

  ws.on('close', () => {
    const ctx = ws.userContext
    if (!ctx) return

    removeSocketForUser(ctx.userId, ws)
  })
})

/* Start the HTTP server with fallback when a port is already in use */
const basePort = Number(process.env.PORT) || 3000;
const maxPortAttempts = 10;

function startServer(port, attempt = 1) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < maxPortAttempts) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is busy, trying ${nextPort}...`);
      startServer(nextPort, attempt + 1);
      return;
    }

    console.error('Failed to start server:', err.message);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`Server started on http://localhost:${port}`);
  });
}

startServer(basePort);