const { dbPool } = require('./pool')
const { normalizeRole } = require('../config')

async function queryRoleIdentity(primaryTable, legacyTable, idColumn, displayColumn, userIdNumber) {
  const baseSql = (tableName) => `
    SELECT ${idColumn} AS id, ${displayColumn} AS display_name
    FROM ${tableName}
    WHERE ${idColumn} = $1 OR signup_id = $1
    ORDER BY CASE WHEN ${idColumn} = $1 THEN 0 ELSE 1 END
    LIMIT 1
  `

  try {
    return await dbPool.query(baseSql(primaryTable), [userIdNumber])
  } catch (_) {
    if (!legacyTable) return { rows: [] }
  }

  try {
    return await dbPool.query(baseSql(legacyTable), [userIdNumber])
  } catch (_) {
    return { rows: [] }
  }
}

async function findByIdAcrossRoles(userIdNumber, roleHint) {
  const normalizedHint = normalizeRole(roleHint)

  const checks = []
  if (!normalizedHint || normalizedHint === 'student') {
    checks.push(
      queryRoleIdentity('student', 'students', 'student_id', 'username', userIdNumber)
        .then((res) => ({ role: 'student', rows: res.rows }))
    )
  }

  if (!normalizedHint || normalizedHint === 'mentor') {
    checks.push(
      queryRoleIdentity('mentor', 'mentors', 'mentor_id', 'full_name', userIdNumber)
        .then((res) => ({ role: 'mentor', rows: res.rows }))
    )
  }

  if (!normalizedHint || normalizedHint === 'psychiatrist') {
    checks.push(
      queryRoleIdentity('psychiatrist', 'psychiatrists', 'psychiatrist_id', 'full_name', userIdNumber)
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
    let result = { rows: [] }
    try {
      result = await dbPool.query(
        `
        SELECT mentor_id, psychiatrist_id
        FROM assignments
        WHERE student_id = $1
        ORDER BY assignment_id DESC
        LIMIT 1
        `,
        [Number(userId)]
      )
    } catch (_) {
      return { peerUserId: null, peerRole: null }
    }

    const row = result.rows[0]
    if (!row) return { peerUserId: null, peerRole: null }
    if (row.mentor_id != null) return { peerUserId: String(row.mentor_id), peerRole: 'mentor' }
    if (row.psychiatrist_id != null)
      return { peerUserId: String(row.psychiatrist_id), peerRole: 'psychiatrist' }
    return { peerUserId: null, peerRole: null }
  }

  if (role === 'mentor') {
    let result = { rows: [] }
    try {
      result = await dbPool.query(
        `
        SELECT student_id
        FROM assignments
        WHERE mentor_id = $1
        ORDER BY assignment_id DESC
        LIMIT 1
        `,
        [Number(userId)]
      )
    } catch (_) {
      return { peerUserId: null, peerRole: 'student' }
    }

    const row = result.rows[0]
    return { peerUserId: row?.student_id != null ? String(row.student_id) : null, peerRole: 'student' }
  }

  let result = { rows: [] }
  try {
    result = await dbPool.query(
      `
      SELECT student_id
      FROM assignments
      WHERE psychiatrist_id = $1
      ORDER BY assignment_id DESC
      LIMIT 1
      `,
      [Number(userId)]
    )
  } catch (_) {
    return { peerUserId: null, peerRole: 'student' }
  }

  const row = result.rows[0]
  return { peerUserId: row?.student_id != null ? String(row.student_id) : null, peerRole: 'student' }
}

async function isAssignedPair(baseRole, baseUserId, peerRole, peerUserId) {
  if (baseRole === 'student' && peerRole === 'mentor') {
    let match = { rows: [] }
    try {
      match = await dbPool.query(
        'SELECT 1 FROM assignments WHERE student_id = $1 AND mentor_id = $2 LIMIT 1',
        [Number(baseUserId), Number(peerUserId)]
      )
    } catch (_) {
      return false
    }
    return Boolean(match.rows[0])
  }

  if (baseRole === 'student' && peerRole === 'psychiatrist') {
    let match = { rows: [] }
    try {
      match = await dbPool.query(
        'SELECT 1 FROM assignments WHERE student_id = $1 AND psychiatrist_id = $2 LIMIT 1',
        [Number(baseUserId), Number(peerUserId)]
      )
    } catch (_) {
      return false
    }
    return Boolean(match.rows[0])
  }

  if (baseRole === 'mentor' && peerRole === 'student') {
    let match = { rows: [] }
    try {
      match = await dbPool.query(
        'SELECT 1 FROM assignments WHERE mentor_id = $1 AND student_id = $2 LIMIT 1',
        [Number(baseUserId), Number(peerUserId)]
      )
    } catch (_) {
      return false
    }
    return Boolean(match.rows[0])
  }

  if (baseRole === 'psychiatrist' && peerRole === 'student') {
    let match = { rows: [] }
    try {
      match = await dbPool.query(
        'SELECT 1 FROM assignments WHERE psychiatrist_id = $1 AND student_id = $2 LIMIT 1',
        [Number(baseUserId), Number(peerUserId)]
      )
    } catch (_) {
      return false
    }
    return Boolean(match.rows[0])
  }

  return false
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
          const assigned = await isAssignedPair(base.role, base.userId, peer.role, peer.userId)
          if (assigned) {
            peerUserId = peer.userId
            peerRole = peer.role
          }
        }
        if (base.role !== 'student' && peer.role === 'student') {
          const assigned = await isAssignedPair(base.role, base.userId, peer.role, peer.userId)
          if (assigned) {
            peerUserId = peer.userId
            peerRole = peer.role
          }
        }
      }
    }
  }

  if (!peerUserId || !peerRole) {
    const latestPeer = await findLatestPeer(base.userId, base.role)
    peerUserId = latestPeer.peerUserId
    peerRole = latestPeer.peerRole
  }

  let peerDisplayName = null
  if (peerUserId && peerRole) {
    const peerMatch = await findByIdAcrossRoles(Number(peerUserId), peerRole)
    if (peerMatch) {
      peerDisplayName = peerMatch.displayName
    }
  }

  return {
    userId: base.userId,
    role: base.role,
    displayName: base.displayName,
    peerUserId,
    peerRole,
    peerDisplayName,
  }
}

module.exports = {
  findByIdAcrossRoles,
  findLatestPeer,
  resolveParticipantContext,
}

