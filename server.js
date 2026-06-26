const path = require('path')
const express = require('express')
const WebSocket = require('ws')
const http = require('http')

const app = express()

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

/* Serve static files from the root directory */
app.use(express.static(__dirname))

/* Route to serve HTML file from root directory */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
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
    console.error('WebSocket server error:', err.message);
  }
});

/*
Map: chatCode -> role -> userId -> Set<WebSocket>
This supports “Option B” (each dashboard sees only what is addressed to them).
*/
const userRooms = {};

function getOrCreateSet(map, key1, key2, key3) {
  if (!map[key1]) map[key1] = {};
  if (!map[key1][key2]) map[key1][key2] = {};
  if (!map[key1][key2][key3]) map[key1][key2][key3] = new Set();
  return map[key1][key2][key3];
}

/* Handle WebSocket connections */
wss.on('connection', (ws) => {
  ws.userContext = null;
  ws.isAuthorized = false;

  ws.on('error', (err) => {
    console.warn('WebSocket client error:', err.message)
  })

  ws.on('message', (message) => {
    let messageObject
    try {
      messageObject = JSON.parse(message.toString())
    } catch (_) {
      return
    }

    const { type } = messageObject;

    // JOIN: { type:'join', userId, role }
    if (type === 'join') {
      const { userId, role, authToken } = messageObject;
      if (!userId || !role) return;

      if (!['student', 'mentor', 'psychiatrist'].includes(role)) return;

      const expectedToken = process.env.TULIZA_WS_TOKEN;
      if (expectedToken && authToken !== expectedToken) {
        ws.close(1008, 'Unauthorized');
        return;
      }

      ws.isAuthorized = true;

      ws.userContext = { userId, role };

      // store socket by intended recipient (no chatCode)
      getOrCreateSet(userRooms, '__global__', role, userId).add(ws);
      return;
    }

    if (!ws.isAuthorized || !ws.userContext) return;

    // SEND:
    // Student -> { fromRole:'student', toRole:'mentor'|'psychiatrist', toUserId?:string, chatCode, sender, text }
    // Mentor/Psychiatrist -> { fromRole:'mentor'|'psychiatrist', toRole:'student', toUserId:string, chatCode, sender, text }
    const { fromRole, toRole, toUserId, sender, text, timestamp } = messageObject;

    if (!fromRole || !toRole || !text) return;
    if (fromRole !== ws.userContext.role) return;
    if (sender !== ws.userContext.userId) return;

    const targetRoleMap = userRooms['__global__']?.[toRole];

    // If toUserId is missing, we’ll deliver to all users of that toRole in that chatCode.
    // (Useful for student -> all mentors/psychiatrists.)
    if (!toUserId) {
      Object.keys(targetRoleMap || {}).forEach((uid) => {
        const set = targetRoleMap[uid];
        set?.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                sender,
                text,
                timestamp,
                fromRole,
                toRole,
              })
            );
          }
        });
      });
      return;
    }

    const targets = targetRoleMap?.[toUserId];
    targets?.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            sender,
            text,
            timestamp,
            fromRole,
            toRole,
          })
        );
      }
    });
  });

  ws.on('close', () => {
    const ctx = ws.userContext;
    if (!ctx) return;

    const { userId, role } = ctx;
    const set = userRooms['__global__']?.[role]?.[userId];
    set?.delete(ws);
  });
});

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