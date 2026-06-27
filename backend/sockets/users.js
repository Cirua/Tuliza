const userSockets = new Map() // userId -> Set<WebSocket>

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

