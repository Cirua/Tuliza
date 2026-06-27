const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env') })
const { Pool } = require('pg')

const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
})

async function getStudentById(studentsId) {
  const result = await pool.query(
    'SELECT students_id, email, username FROM students WHERE student_id = $1 LIMIT 1',
    [Number(studentsId)]
  )
  return result.rows[0] || null
}

async function getMentorById(mentorsId) {
  const result = await pool.query(
    'SELECT mentors_id, email, full_name FROM mentors WHERE mentor_id = $1 LIMIT 1',
    [Number(mentorsId)]
  )
  return result.rows[0] || null
}

async function getPsychiatristById(psychiatristsId) {
  const result = await pool.query(
    'SELECT psychiatrists_id, email, full_name FROM psychiatrists WHERE psychiatrist_id = $1 LIMIT 1',
    [Number(psychiatristsId)]
  )
  return result.rows[0] || null
}
async function getAdminById(adminId) {
  const result = await pool.query(
    'SELECT admin_id, email,FROM admins WHERE admin_id = $1 LIMIT 1',
    [Number(adminId)]
  )
  return result.rows[0] || null
}

module.exports = {
  pool,
  getStudentById,
  getMentorById,
  getPsychiatristById,
}