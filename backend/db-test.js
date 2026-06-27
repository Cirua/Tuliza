const { pool } = require('./connect')

async function runDbTest() {
  try {
    const ping = await pool.query('SELECT NOW() AS server_time')
    const studentsCount = await pool.query('SELECT COUNT(*)::int AS total FROM students')
    const mentorsCount = await pool.query('SELECT COUNT(*)::int AS total FROM mentors')
    const psychiatristsCount = await pool.query('SELECT COUNT(*)::int AS total FROM psychiatrists')

    console.log('Database connection: OK')
    console.log('Server time:', ping.rows[0].server_time)
    console.log('students count:', studentsCount.rows[0].total)
    console.log('mentors count:', mentorsCount.rows[0].total)
    console.log('psychiatrists count:', psychiatristsCount.rows[0].total)
  } catch (error) {
    console.error('Database connection: FAILED')
    console.error(error.message)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

runDbTest()
