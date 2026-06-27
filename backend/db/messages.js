const { dbPool } = require('./pool')
const { toIsoString } = require('../config')

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
  const mentorsId =
    context.role === 'mentor' ? Number(context.userId) : context.peerRole === 'mentor' ? Number(context.peerUserId) : null
  const psychiatristsId =
    context.role === 'psychiatrist'
      ? Number(context.userId)
      : context.peerRole === 'psychiatrist'
        ? Number(context.peerUserId)
        : null

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

module.exports = {
  loadConversationHistory,
  persistMessage,
}

