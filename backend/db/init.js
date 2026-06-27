async function initializeDatabase(dbPool) {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      role_id SERIAL PRIMARY KEY,
      role_name VARCHAR(30) UNIQUE NOT NULL
    )
  `)

  await dbPool.query(`
    INSERT INTO roles (role_name)
    VALUES ('student'), ('mentor'), ('psychiatrist'), ('psychologist'), ('admin')
    ON CONFLICT (role_name) DO NOTHING
  `)

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS signup (
      signup_id SERIAL PRIMARY KEY,
      email VARCHAR(150) UNIQUE NOT NULL,
      role VARCHAR(30) NOT NULL,
      role_id INT,
      role_name VARCHAR(30),
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await dbPool.query('ALTER TABLE signup ADD COLUMN IF NOT EXISTS signup_id SERIAL')
  await dbPool.query('ALTER TABLE signup ADD COLUMN IF NOT EXISTS email VARCHAR(150)')
  await dbPool.query('ALTER TABLE signup ADD COLUMN IF NOT EXISTS role VARCHAR(30)')
  await dbPool.query('ALTER TABLE signup ADD COLUMN IF NOT EXISTS role_id INT')
  await dbPool.query('ALTER TABLE signup ADD COLUMN IF NOT EXISTS role_name VARCHAR(30)')
  await dbPool.query('ALTER TABLE signup ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)')
  await dbPool.query('ALTER TABLE signup ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()')

  await dbPool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'signup'
          AND constraint_name = 'signup_role_id_fk'
      ) THEN
        ALTER TABLE signup
          ADD CONSTRAINT signup_role_id_fk
          FOREIGN KEY (role_id) REFERENCES roles(role_id);
      END IF;
    END $$;
  `)

  await dbPool.query(`
    UPDATE signup s
    SET role_name = COALESCE(s.role_name, r.role_name)
    FROM roles r
    WHERE s.role_id = r.role_id
      AND (s.role_name IS NULL OR s.role_name = '')
  `)

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS students (
      student_id SERIAL PRIMARY KEY,
      signup_id INT UNIQUE NOT NULL REFERENCES signup(signup_id) ON DELETE CASCADE,
      email VARCHAR(150) UNIQUE NOT NULL,
      username VARCHAR(100) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await dbPool.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS student_id SERIAL')
  await dbPool.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS signup_id INT')
  await dbPool.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS email VARCHAR(150)')
  await dbPool.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS username VARCHAR(100)')

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS mentors (
      mentor_id SERIAL PRIMARY KEY,
      signup_id INT UNIQUE NOT NULL REFERENCES signup(signup_id) ON DELETE CASCADE,
      email VARCHAR(150) UNIQUE NOT NULL,
      full_name VARCHAR(120) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await dbPool.query('ALTER TABLE mentors ADD COLUMN IF NOT EXISTS mentor_id SERIAL')
  await dbPool.query('ALTER TABLE mentors ADD COLUMN IF NOT EXISTS signup_id INT')
  await dbPool.query('ALTER TABLE mentors ADD COLUMN IF NOT EXISTS email VARCHAR(150)')
  await dbPool.query('ALTER TABLE mentors ADD COLUMN IF NOT EXISTS full_name VARCHAR(120)')

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS psychiatrists (
      psychiatrist_id SERIAL PRIMARY KEY,
      signup_id INT UNIQUE NOT NULL REFERENCES signup(signup_id) ON DELETE CASCADE,
      email VARCHAR(150) UNIQUE NOT NULL,
      full_name VARCHAR(120) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await dbPool.query('ALTER TABLE psychiatrists ADD COLUMN IF NOT EXISTS psychiatrist_id SERIAL')
  await dbPool.query('ALTER TABLE psychiatrists ADD COLUMN IF NOT EXISTS signup_id INT')
  await dbPool.query('ALTER TABLE psychiatrists ADD COLUMN IF NOT EXISTS email VARCHAR(150)')
  await dbPool.query('ALTER TABLE psychiatrists ADD COLUMN IF NOT EXISTS full_name VARCHAR(120)')

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS questionnaire (
      questionnaire_id SERIAL PRIMARY KEY,
      student_id INT UNIQUE NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
      answers_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      message_id SERIAL PRIMARY KEY,
      sent_message TEXT,
      received_message TEXT,
      sent_at TIMESTAMPTZ,
      student_id INT,
      mentor_id INT,
      psychiatrist_id INT,
      CONSTRAINT fk_msg_student FOREIGN KEY (student_id) REFERENCES students(student_id),
      CONSTRAINT fk_msg_mentor FOREIGN KEY (mentor_id) REFERENCES mentors(mentor_id),
      CONSTRAINT fk_msg_psychiatrist FOREIGN KEY (psychiatrist_id) REFERENCES psychiatrists(psychiatrist_id)
    )
  `)

  await dbPool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS student_id INT')
  await dbPool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS mentor_id INT')
  await dbPool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS psychiatrist_id INT')

  await dbPool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'students_id'
      ) THEN
        UPDATE messages SET student_id = students_id WHERE student_id IS NULL AND students_id IS NOT NULL;
      END IF;
    END $$;
  `)

  await dbPool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'mentors_id'
      ) THEN
        UPDATE messages SET mentor_id = mentors_id WHERE mentor_id IS NULL AND mentors_id IS NOT NULL;
      END IF;
    END $$;
  `)

  await dbPool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'psychiatrists_id'
      ) THEN
        UPDATE messages SET psychiatrist_id = psychiatrists_id WHERE psychiatrist_id IS NULL AND psychiatrists_id IS NOT NULL;
      END IF;
    END $$;
  `)

  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS idx_signup_email_role_id ON signup(email, role_id)
  `)

  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_student_mentor ON messages(student_id, mentor_id)
  `)

  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_student_psychiatrist ON messages(student_id, psychiatrist_id)
  `)
}

module.exports = { initializeDatabase }
