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
    CREATE TABLE IF NOT EXISTS student (
      student_id SERIAL PRIMARY KEY,
      signup_id INT UNIQUE NOT NULL REFERENCES signup(signup_id) ON DELETE CASCADE,
      email VARCHAR(150) UNIQUE NOT NULL,
      username VARCHAR(100) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await dbPool.query('ALTER TABLE student ADD COLUMN IF NOT EXISTS student_id SERIAL')
  await dbPool.query('ALTER TABLE student ADD COLUMN IF NOT EXISTS signup_id INT')
  await dbPool.query('ALTER TABLE student ADD COLUMN IF NOT EXISTS email VARCHAR(150)')
  await dbPool.query('ALTER TABLE student ADD COLUMN IF NOT EXISTS username VARCHAR(100)')

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS mentor (
      mentor_id SERIAL PRIMARY KEY,
      signup_id INT UNIQUE NOT NULL REFERENCES signup(signup_id) ON DELETE CASCADE,
      email VARCHAR(150) UNIQUE NOT NULL,
      full_name VARCHAR(120) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await dbPool.query('ALTER TABLE mentor ADD COLUMN IF NOT EXISTS mentor_id SERIAL')
  await dbPool.query('ALTER TABLE mentor ADD COLUMN IF NOT EXISTS signup_id INT')
  await dbPool.query('ALTER TABLE mentor ADD COLUMN IF NOT EXISTS email VARCHAR(150)')
  await dbPool.query('ALTER TABLE mentor ADD COLUMN IF NOT EXISTS full_name VARCHAR(120)')

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS psychiatrist (
      psychiatrist_id SERIAL PRIMARY KEY,
      signup_id INT UNIQUE NOT NULL REFERENCES signup(signup_id) ON DELETE CASCADE,
      email VARCHAR(150) UNIQUE NOT NULL,
      full_name VARCHAR(120) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await dbPool.query('ALTER TABLE psychiatrist ADD COLUMN IF NOT EXISTS psychiatrist_id SERIAL')
  await dbPool.query('ALTER TABLE psychiatrist ADD COLUMN IF NOT EXISTS signup_id INT')
  await dbPool.query('ALTER TABLE psychiatrist ADD COLUMN IF NOT EXISTS email VARCHAR(150)')
  await dbPool.query('ALTER TABLE psychiatrist ADD COLUMN IF NOT EXISTS full_name VARCHAR(120)')

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS questionnaire (
      questionnaire_id SERIAL PRIMARY KEY,
      mentalhealthsupport VARCHAR(10) NOT NULL,
      concerns VARCHAR(200) NOT NULL,
      period_affected VARCHAR(50) NOT NULL,
      support_type VARCHAR(50) NOT NULL,
      support_preferences VARCHAR(50) NOT NULL,
      religion TEXT NOT NULL,
      religion_type VARCHAR(50) NOT NULL,
      spiritual_status VARCHAR(50) NOT NULL,
      therapy_status VARCHAR(10) NOT NULL,
      seek_support TEXT NOT NULL,
      expectations TEXT NOT NULL,
      session_structure VARCHAR(50) NOT NULL,
      communication VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      student_id INT UNIQUE NOT NULL REFERENCES student(student_id) ON DELETE CASCADE,
      mentor_id INT REFERENCES mentor(mentor_id),
      psychiatrist_id INT REFERENCES psychiatrist(psychiatrist_id)
    )
  `)

  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS mentalhealthsupport VARCHAR(10)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS concerns VARCHAR(200)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS period_affected VARCHAR(50)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS support_type VARCHAR(50)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS support_preferences VARCHAR(50)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS religion TEXT')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS religion_type VARCHAR(50)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS spiritual_status VARCHAR(50)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS therapy_status VARCHAR(10)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS seek_support TEXT')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS expectations TEXT')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS session_structure VARCHAR(50)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS communication VARCHAR(50)')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS student_id INT')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS mentor_id INT')
  await dbPool.query('ALTER TABLE questionnaire ADD COLUMN IF NOT EXISTS psychiatrist_id INT')

  await dbPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_questionnaire_student_unique ON questionnaire(student_id)
  `)

  await dbPool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'questionnaire'
          AND constraint_name = 'fk_qst_student'
      ) THEN
        ALTER TABLE questionnaire
          ADD CONSTRAINT fk_qst_student
          FOREIGN KEY (student_id) REFERENCES student(student_id);
      END IF;
    END $$;
  `)

  await dbPool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'questionnaire'
          AND constraint_name = 'fk_qst_mentor'
      ) THEN
        ALTER TABLE questionnaire
          ADD CONSTRAINT fk_qst_mentor
          FOREIGN KEY (mentor_id) REFERENCES mentor(mentor_id);
      END IF;
    END $$;
  `)

  await dbPool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'questionnaire'
          AND constraint_name = 'fk_qst_psychiatrist'
      ) THEN
        ALTER TABLE questionnaire
          ADD CONSTRAINT fk_qst_psychiatrist
          FOREIGN KEY (psychiatrist_id) REFERENCES psychiatrist(psychiatrist_id);
      END IF;
    END $$;
  `)

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS assignments (
      assignment_id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      student_id INT REFERENCES student(student_id),
      mentor_id INT REFERENCES mentor(mentor_id),
      psychiatrist_id INT REFERENCES psychiatrist(psychiatrist_id)
    )
  `)

  await dbPool.query('ALTER TABLE assignments ADD COLUMN IF NOT EXISTS assignment_id SERIAL')
  await dbPool.query('ALTER TABLE assignments ADD COLUMN IF NOT EXISTS username VARCHAR(100)')
  await dbPool.query('ALTER TABLE assignments ADD COLUMN IF NOT EXISTS student_id INT')
  await dbPool.query('ALTER TABLE assignments ADD COLUMN IF NOT EXISTS mentor_id INT')
  await dbPool.query('ALTER TABLE assignments ADD COLUMN IF NOT EXISTS psychiatrist_id INT')

  await dbPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_username_unique ON assignments(username)
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
      CONSTRAINT fk_msg_student FOREIGN KEY (student_id) REFERENCES student(student_id),
      CONSTRAINT fk_msg_mentor FOREIGN KEY (mentor_id) REFERENCES mentor(mentor_id),
      CONSTRAINT fk_msg_psychiatrist FOREIGN KEY (psychiatrist_id) REFERENCES psychiatrist(psychiatrist_id)
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
