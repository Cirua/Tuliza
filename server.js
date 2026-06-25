const path = require('path')
const express = require('express')
const WebSocket = require('ws')
const http = require('http')

const app = express()

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
const wss = new WebSocket.Server({ server })

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

  ws.on('message', (message) => {
    const messageObject = JSON.parse(message.toString());
    const { type } = messageObject;

    // JOIN: { type:'join', userId, role }
    if (type === 'join') {
      const { userId, role } = messageObject;
      if (!userId || !role) return;

      ws.userContext = { userId, role };

      // store socket by intended recipient (no chatCode)
      getOrCreateSet(userRooms, '__global__', role, userId).add(ws);
      return;
    }

    // SEND:
    // Student -> { fromRole:'student', toRole:'mentor'|'psychiatrist', toUserId?:string, chatCode, sender, text }
    // Mentor/Psychiatrist -> { fromRole:'mentor'|'psychiatrist', toRole:'student', toUserId:string, chatCode, sender, text }
    const { fromRole, toRole, toUserId, sender, text, timestamp } = messageObject;

    if (!fromRole || !toRole || !text) return;

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