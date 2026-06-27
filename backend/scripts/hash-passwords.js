const path = require('path')
const bcrypt = require('bcrypt')

require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const { dbPool } = require('../db/pool')

const BCRYPT_PREFIX = /^\$2[aby]\$\d{2}\$/

const TABLES = [
  { table: 'students', idColumn: 'students_id' },
  { table: 'mentors', idColumn: 'mentors_id' },
  { table: 'psychiatrists', idColumn: 'psychiatrists_id' },
  { table: 'admins', idColumn: 'admin_id' },
]

async function hasTable(tableName) {
  const sql = `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists
  `
  const r = await dbPool.query(sql, [tableName])
  return Boolean(r.rows[0] && r.rows[0].exists)
}

async function hasColumn(tableName, columnName) {
  const sql = `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    ) AS exists
  `
  const r = await dbPool.query(sql, [tableName, columnName])
  return Boolean(r.rows[0] && r.rows[0].exists)
}

async function ensurePasswordHashColumn(tableName) {
  const exists = await hasColumn(tableName, 'password_hash')
  if (exists) return
  await dbPool.query(`ALTER TABLE ${tableName} ADD COLUMN password_hash VARCHAR(255)`)
}

function pickSourcePassword(row, hasPasswordColumn) {
  if (row.password_hash && !BCRYPT_PREFIX.test(row.password_hash)) {
    return String(row.password_hash)
  }
  if (hasPasswordColumn && row.password) {
    return String(row.password)
  }
  return null
}

async function migrateTable({ table, idColumn }) {
  const tableExists = await hasTable(table)
  if (!tableExists) {
    return { table, scanned: 0, updated: 0, skipped: true }
  }

  await ensurePasswordHashColumn(table)

  const hasPasswordColumn = await hasColumn(table, 'password')

  const selectSql = hasPasswordColumn
    ? `SELECT ${idColumn} AS id, password, password_hash FROM ${table}`
    : `SELECT ${idColumn} AS id, NULL::text AS password, password_hash FROM ${table}`

  const rows = (await dbPool.query(selectSql)).rows

  let updated = 0
  for (const row of rows) {
    if (row.password_hash && BCRYPT_PREFIX.test(row.password_hash)) continue

    const sourcePassword = pickSourcePassword(row, hasPasswordColumn)
    if (!sourcePassword) continue

    const hashed = await bcrypt.hash(sourcePassword, 10)
    await dbPool.query(`UPDATE ${table} SET password_hash = $1 WHERE ${idColumn} = $2`, [hashed, row.id])
    updated += 1
  }

  return { table, scanned: rows.length, updated, skipped: false }
}

async function main() {
  try {
    const results = []
    for (const entry of TABLES) {
      const result = await migrateTable(entry)
      results.push(result)
    }

    console.log('Password hash migration finished.')
    for (const result of results) {
      if (result.skipped) {
        console.log(`- ${result.table}: skipped (table not found)`)
        continue
      }
      console.log(`- ${result.table}: scanned=${result.scanned}, updated=${result.updated}`)
    }
    console.log('Note: if your schema still has a plaintext password column, remove it after verifying login works.')
  } catch (err) {
    console.error('Password hash migration failed:', err.message)
    process.exitCode = 1
  } finally {
    await dbPool.end()
  }
}

main()
