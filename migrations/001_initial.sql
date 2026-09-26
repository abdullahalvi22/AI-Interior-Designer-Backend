CREATE TABLE IF NOT EXISTS users (
  id varchar(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  name varchar(100) NOT NULL,
  email varchar(254) NOT NULL UNIQUE,
  password_hash varchar(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  credits int NOT NULL DEFAULT 30,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT users_name_length_chk CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT users_credits_chk CHECK (credits >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS projects (
  id varchar(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name varchar(120) NOT NULL,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT projects_name_length_chk CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT projects_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX projects_user_created_idx (user_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS rooms (
  id varchar(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  project_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name varchar(120) NOT NULL,
  room_type varchar(60) NOT NULL,
  original_image_key varchar(1024) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  original_image_url text,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT rooms_name_length_chk CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT rooms_type_length_chk CHECK (char_length(room_type) BETWEEN 1 AND 60),
  CONSTRAINT rooms_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT rooms_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE KEY rooms_original_image_key_uq (original_image_key),
  INDEX rooms_project_idx (project_id, created_at DESC),
  INDEX rooms_user_idx (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS design_jobs (
  id varchar(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  room_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status enum('queued', 'analyzing_room', 'generating_images', 'completed', 'failed') NOT NULL DEFAULT 'queued',
  progress decimal(4,3) NOT NULL DEFAULT 0.150,
  style varchar(100) NOT NULL,
  palette json NOT NULL DEFAULT (JSON_ARRAY()),
  preserve_items json NOT NULL DEFAULT (JSON_ARRAY()),
  instructions text NOT NULL,
  variants smallint unsigned NOT NULL,
  quality enum('preview', 'final') NOT NULL,
  credit_cost int NOT NULL,
  room_analysis json,
  final_prompt text,
  openai_analysis_request_id varchar(255) CHARACTER SET ascii COLLATE ascii_bin,
  openai_image_request_ids json NOT NULL DEFAULT (JSON_ARRAY()),
  openai_usage json,
  actual_ai_cost_usd decimal(12,6),
  error_message text,
  attempts int unsigned NOT NULL DEFAULT 0,
  available_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  locked_at datetime(3),
  locked_by varchar(128) CHARACTER SET ascii COLLATE ascii_bin,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at datetime(3),
  CONSTRAINT design_jobs_progress_chk CHECK (progress BETWEEN 0 AND 1),
  CONSTRAINT design_jobs_variants_chk CHECK (variants BETWEEN 1 AND 10),
  CONSTRAINT design_jobs_credit_cost_chk CHECK (credit_cost > 0),
  CONSTRAINT design_jobs_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT design_jobs_room_fk FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  INDEX design_jobs_user_created_idx (user_id, created_at DESC),
  INDEX design_jobs_queue_idx (status, available_at, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS designs (
  id varchar(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  job_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  variant_index smallint unsigned NOT NULL,
  image_key varchar(1024) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  image_url text,
  style varchar(100) NOT NULL,
  prompt text NOT NULL,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT designs_job_fk FOREIGN KEY (job_id) REFERENCES design_jobs(id) ON DELETE CASCADE,
  CONSTRAINT designs_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY designs_job_variant_uq (job_id, variant_index),
  INDEX designs_job_idx (job_id, variant_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS credit_transactions (
  id varchar(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  job_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin,
  kind enum('design_charge', 'design_refund', 'adjustment') NOT NULL,
  amount int NOT NULL,
  balance_after int NOT NULL,
  description varchar(255) NOT NULL,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT credit_transactions_amount_chk CHECK (amount <> 0),
  CONSTRAINT credit_transactions_balance_chk CHECK (balance_after >= 0),
  CONSTRAINT credit_transactions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT credit_transactions_job_fk FOREIGN KEY (job_id) REFERENCES design_jobs(id) ON DELETE SET NULL,
  UNIQUE KEY credit_transactions_job_kind_uq (job_id, kind),
  INDEX credit_transactions_user_created_idx (user_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
