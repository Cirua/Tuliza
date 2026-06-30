CREATE TABLE IF NOT EXISTS students (
  students_id INT PRIMARY KEY,
  email VARCHAR(100) UNIQUE NOT NULL,
  username VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS mentors (
  mentors_id SERIAL PRIMARY KEY,
  email VARCHAR(100) UNIQUE NOT NULL,
  full_name VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS psychiatrists (
  psychiatrists_id SERIAL PRIMARY KEY,
  email VARCHAR(100) UNIQUE NOT NULL,
  full_name VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  message_id SERIAL PRIMARY KEY,
  sent_message TEXT,
  received_message TEXT,
  sent_at TIMESTAMP,
  students_id INT,
  mentors_id INT,
  psychiatrists_id INT,
  CONSTRAINT fk_msg_student
    FOREIGN KEY (students_id) REFERENCES students(students_id),
  CONSTRAINT fk_msg_mentor
    FOREIGN KEY (mentors_id) REFERENCES mentors(mentors_id),
  CONSTRAINT fk_msg_psychiatrist
    FOREIGN KEY (psychiatrists_id) REFERENCES psychiatrists(psychiatrists_id)
);

CREATE TABLE IF NOT EXISTS therapist_availability (
  availability_id SERIAL PRIMARY KEY,
  therapist_type VARCHAR(20) NOT NULL CHECK (therapist_type IN ('mentor', 'psychiatrist')),
  therapist_id INT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_time_window CHECK (end_at > start_at),
  CONSTRAINT unique_therapist_slot UNIQUE (therapist_type, therapist_id, start_at, end_at)
);

CREATE INDEX IF NOT EXISTS idx_therapist_availability_lookup
  ON therapist_availability (therapist_type, therapist_id, start_at);

CREATE TABLE IF NOT EXISTS appointments (
  appointment_id SERIAL PRIMARY KEY,
  students_id INT NOT NULL,
  therapist_type VARCHAR(20) NOT NULL CHECK (therapist_type IN ('mentor', 'psychiatrist')),
  therapist_id INT NOT NULL,
  availability_id INT NOT NULL,
  slot_start TIMESTAMPTZ NOT NULL,
  slot_end TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled', 'completed')),
  note TEXT,
  google_event_id VARCHAR(255),
  google_sync_status VARCHAR(30) NOT NULL DEFAULT 'not_configured' CHECK (google_sync_status IN ('not_configured', 'synced', 'failed')),
  google_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_appointments_student FOREIGN KEY (students_id) REFERENCES students(students_id),
  CONSTRAINT fk_appointments_availability FOREIGN KEY (availability_id) REFERENCES therapist_availability(availability_id),
  CONSTRAINT valid_appointment_time CHECK (slot_end > slot_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_booked_slot
  ON appointments (availability_id)
  WHERE status = 'booked';

CREATE INDEX IF NOT EXISTS idx_appointments_lookup
  ON appointments (therapist_type, therapist_id, slot_start, status);
