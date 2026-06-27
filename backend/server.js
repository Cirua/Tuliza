const path = require('path')
const express = require('express')
const WebSocket = require('ws')
const http = require('http')
require('dotenv').config({ path: path.join(__dirname, '.env') })
const { Pool } = require('pg')

const app = express()
const projectRoot = path.resolve(__dirname, '..')

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

const frontendPages = new Set([
  'tuliza-frontend.html',
  'chat-ui.html',
  'resources.html',
  'resource-detail.html',
  'journal.html',
  'account.html',
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