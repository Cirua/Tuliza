import pg from "pg";

const pool = new pg.Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
})

export default pool;

async function getUsers() {
  try {
    // Use parameterized queries ($1, $2) to prevent SQL injection
    const res = await pool.query('SELECT * FROM users WHERE email = $1', ['user@example.com']);
    console.log(res.rows); // This is an array containing the result rows
    return res.rows;
  } catch (err) {
    console.error('Error executing query', err.stack);
  }
}

getUsers();