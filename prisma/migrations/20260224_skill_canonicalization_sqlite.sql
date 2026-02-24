-- Skill canonicalization schema (SQLite)
-- Includes UP migration and rollback section.
-- Notes:
-- - Uses SQLite-friendly constraints/checks.
-- - tenant_id is nullable for future multi-tenant support.

PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

-- 1) Canonical skills
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_name TEXT NOT NULL,
  skill_type TEXT NOT NULL DEFAULT 'GENERAL',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Case-insensitive uniqueness on canonical skill names
CREATE UNIQUE INDEX IF NOT EXISTS ux_skills_canonical_name_ci
  ON skills (canonical_name COLLATE NOCASE);

-- Requested lookup index
CREATE INDEX IF NOT EXISTS ix_skills_canonical_name
  ON skills (canonical_name);

-- 2) Skill aliases (synonyms)
CREATE TABLE IF NOT EXISTS skill_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id INTEGER NOT NULL,
  alias_text TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('EXACT', 'PHRASE', 'REGEX')),
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  tenant_id TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

-- Case-insensitive unique alias per tenant.
-- IFNULL handles NULL tenant_id deterministically for uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS ux_skill_aliases_tenant_alias_ci
  ON skill_aliases (IFNULL(tenant_id, ''), alias_text COLLATE NOCASE);

-- Requested lookup index
CREATE INDEX IF NOT EXISTS ix_skill_aliases_alias_text
  ON skill_aliases (alias_text);

-- 3) Block rules for false positives (e.g. Java alias blocked by JavaScript context)
CREATE TABLE IF NOT EXISTS skill_block_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blocks_skill_id INTEGER NOT NULL,
  pattern_text TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('EXACT', 'PHRASE', 'REGEX')),
  tenant_id TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (blocks_skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

-- Unique block rule per tenant + blocked skill + pattern
CREATE UNIQUE INDEX IF NOT EXISTS ux_skill_block_rules_unique
  ON skill_block_rules (IFNULL(tenant_id, ''), blocks_skill_id, pattern_text);

-- Requested lookup index
CREATE INDEX IF NOT EXISTS ix_skill_block_rules_pattern_text
  ON skill_block_rules (pattern_text);

-- 4) Ruleset versioning (for run-time traceability)
CREATE TABLE IF NOT EXISTS skill_ruleset_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_name TEXT NOT NULL,
  version_hash TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_skill_ruleset_versions_name
  ON skill_ruleset_versions (version_name);

CREATE UNIQUE INDEX IF NOT EXISTS ux_skill_ruleset_versions_hash
  ON skill_ruleset_versions (version_hash);

COMMIT;

-- =====================================================================
-- DOWN / ROLLBACK (run separately)
-- =====================================================================
-- BEGIN TRANSACTION;
-- DROP TABLE IF EXISTS skill_aliases;
-- DROP TABLE IF EXISTS skill_block_rules;
-- DROP TABLE IF EXISTS skill_ruleset_versions;
-- DROP TABLE IF EXISTS skills;
-- COMMIT;
