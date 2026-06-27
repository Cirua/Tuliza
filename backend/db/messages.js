const { dbPool } = require('./pool')
const { toIsoString } = require('../config')

async function loadConversationHistory(context, limit = 100) {
  if (!context.peerUserId || !context.peerRole) return []

  const params = [Number(context.userId), Number(context.peerUserId), Number(limit)]
  let sql

  if (context.role === 'student' && context.peerRole === 'mentor') {
    sql = `
      SELECT message_id, sent_message, received_message, sent_at, student_id, mentor_id, psychiatrist_id
      FROM (
        SELECT message_id, sent_message, received_message, sent_at, student_id, mentor_id, psychiatrist_id
        FROM messages
        WHERE student_id = $1 AND mentor_id = $2
        ORDER BY sent_at DESC NULLS LAST, message_id DESC
        LIMIT $3
      ) latest
      ORDER BY sent_at ASC NULLS FIRST, message_id ASC
    `
  } else if (context.role === 'student' && context.peerRole === 'psychiatrist') {
    sql = `
      SELECT message_id, sent_message, received_message, sent_at, student_id, mentor_id, psychiatrist_id
      FROM (
        SELECT message_id, sent_message, received_message, sent_at, student_id, mentor_id, psychiatrist_id
        FROM messages
        WHERE student_id = $1 AND psychiatrist_id = $2
        ORDER BY sent_at DESC NULLS LAST, message_id DESC
        LIMIT $3
      ) latest
      ORDER BY sent_at ASC NULLS FIRST, message_id ASC
    `
  } else if (context.role === 'mentor' && context.peerRole === 'student') {
    sql = `
      SELECT message_id, sent_message, received_message, sent_at, student_id, mentor_id, psychiatrist_id
      FROM (
        SELECT message_id, sent_message, received_message, sent_at, student_id, mentor_id, psychiatrist_id
        FROM messages
        WHERE mentor_id = $1 AND student_id = $2
        ORDER BY sent_at DESC NULLS LAST, message_id DESC
        LIMIT $3
      ) latest
      ORDER BY sent_at ASC NULLS FIRST, message_id ASC
    `
  } else {
    sql = `
      SELECT message_id, sent_message, received_message, sent_at, student_id, mentor_id, psychiatrist_id
      FROM (
        SELECT message_id, sent_message, received_message, sent_at, student_id, mentor_id, psychiatrist_id
        FROM messages
        WHERE psychiatrist_id = $1 AND student_id = $2
        ORDER BY sent_at DESC NULLS LAST, message_id DESC
        LIMIT $3
      ) latest
      ORDER BY sent_at ASC NULLS FIRST, message_id ASC
    `
  }

  const result = await dbPool.query(sql, params)

  return result.rows
    .map((row) => {
      const isStudentMessage = row.sent_message != null && String(row.sent_message).trim().length > 0
      const text = isStudentMessage ? row.sent_message : row.received_message
      if (!text || String(text).trim().length === 0) return null

      let fromRole = 'student'
      let sender = row.student_id != null ? String(row.student_id) : ''
      if (!isStudentMessage) {
        if (row.mentor_id != null) {
          fromRole = 'mentor'
          sender = String(row.mentor_id)
        } else {
          fromRole = 'psychiatrist'
          sender = row.psychiatrist_id != null ? String(row.psychiatrist_id) : ''
        }
      }

      return {
        type: 'message',
        messageId: String(row.message_id),
        sender,
        text: String(text),
        timestamp: row.sent_at ? toIsoString(row.sent_at) : null,
        fromRole,
      }
    })
    .filter(Boolean)
}

async function persistMessage(context, text) {
  const isStudentSender = context.role === 'student'
  const sentMessage = isStudentSender ? text : null
  const receivedMessage = isStudentSender ? null : text
  const studentId = context.role === 'student' ? Number(context.userId) : Number(context.peerUserId)
  const mentorId =
    context.role === 'mentor' ? Number(context.userId) : context.peerRole === 'mentor' ? Number(context.peerUserId) : null
  const psychiatristId =
    context.role === 'psychiatrist'
      ? Number(context.userId)
      : context.peerRole === 'psychiatrist'
        ? Number(context.peerUserId)
        : null

  const result = await dbPool.query(
    `
    INSERT INTO messages (sent_message, received_message, sent_at, student_id, mentor_id, psychiatrist_id)
    VALUES ($1, $2, NOW(), $3, $4, $5)
    RETURNING message_id, sent_at
    `,
    [sentMessage, receivedMessage, studentId, mentorId, psychiatristId]
  )

  return result.rows[0]
}

module.exports = {
  loadConversationHistory,
  persistMessage,
}

