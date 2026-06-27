const { dbPool } = require('./pool')
const { normalizeRole } = require('../config')

async function findByIdAcrossRoles(userIdNumber, roleHint) {
  const normalizedHint = normalizeRole(roleHint)

  const checks = []
  if (!normalizedHint || normalizedHint === 'student') {
    checks.push(
      dbPool
        .query(
          'SELECT student_id AS id, username AS display_name FROM students WHERE student_id = $1 LIMIT 1',
          [userIdNumber]
        )
        .then((res) => ({ role: 'student', rows: res.rows }))
    )
  }

  if (!normalizedHint || normalizedHint === 'mentor') {
    checks.push(
      dbPool
        .query(
          'SELECT mentor_id AS id, full_name AS display_name FROM mentors WHERE mentor_id = $1 LIMIT 1',
          [userIdNumber]
        )
        .then((res) => ({ role: 'mentor', rows: res.rows }))
    )
  }

  if (!normalizedHint || normalizedHint === 'psychiatrist') {
    checks.push(
      dbPool
        .query(
          'SELECT psychiatrist_id AS id, full_name AS display_name FROM psychiatrists WHERE psychiatrist_id = $1 LIMIT 1',
          [userIdNumber]
        )
        .then((res) => ({ role: 'psychiatrist', rows: res.rows }))
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
      SELECT mentor_id, psychiatrist_id
      FROM messages
      WHERE student_id = $1
      ORDER BY sent_at DESC NULLS LAST, message_id DESC
      LIMIT 1
      `,
      [Number(userId)]
    )

    const row = result.rows[0]
    if (!row) return { peerUserId: null, peerRole: null }
    if (row.mentor_id != null) return { peerUserId: String(row.mentor_id), peerRole: 'mentor' }
    if (row.psychiatrist_id != null)
      return { peerUserId: String(row.psychiatrist_id), peerRole: 'psychiatrist' }
    return { peerUserId: null, peerRole: null }
  }

  if (role === 'mentor') {
    const result = await dbPool.query(
      `
      SELECT student_id
      FROM messages
      WHERE mentor_id = $1
      ORDER BY sent_at DESC NULLS LAST, message_id DESC
      LIMIT 1
      `,
      [Number(userId)]
    )

    const row = result.rows[0]
    return { peerUserId: row?.student_id != null ? String(row.student_id) : null, peerRole: 'student' }
  }

  const result = await dbPool.query(
    `
    SELECT student_id
    FROM messages
    WHERE psychiatrist_id = $1
    ORDER BY sent_at DESC NULLS LAST, message_id DESC
    LIMIT 1
    `,
    [Number(userId)]
  )

  const row = result.rows[0]
  return { peerUserId: row?.student_id != null ? String(row.student_id) : null, peerRole: 'student' }
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

module.exports = {
  findByIdAcrossRoles,
  findLatestPeer,
  resolveParticipantContext,
}

