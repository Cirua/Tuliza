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
