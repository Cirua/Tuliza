const { Pool } = require('pg')

const dbPool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT || 5433),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
})

module.exports = { dbPool }

