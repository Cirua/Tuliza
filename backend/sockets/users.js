const userSockets = new Map() // role:userId -> Set<WebSocket>

function socketKey(role, userId) {
  return `${String(role || '').toLowerCase()}:${String(userId || '')}`
}

function addSocketForUser(role, userId, ws) {
  const key = socketKey(role, userId)
  const current = userSockets.get(key) || new Set()
  current.add(ws)
  userSockets.set(key, current)
}

function removeSocketForUser(role, userId, ws) {
  const key = socketKey(role, userId)
  const current = userSockets.get(key)
  if (!current) return
  current.delete(ws)
  if (current.size === 0) {
    userSockets.delete(key)
  }
}

function deliverToUser(role, userId, payload) {
  const key = socketKey(role, userId)
  const targets = userSockets.get(key)
  if (!targets) return
  targets.forEach((client) => {
    if (client.readyState === require('ws').OPEN) {
      client.send(JSON.stringify(payload))
    }
  })
}


module.exports = {
  addSocketForUser,
  removeSocketForUser,
  deliverToUser,
}

