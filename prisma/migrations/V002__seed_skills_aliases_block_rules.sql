-- V002__seed_skills_aliases_block_rules.sql
-- SQLite-compatible seed for canonical skills, aliases, and block rules.
-- Idempotent: safe to run multiple times.
--
-- Notes:
-- - Uses INSERT OR IGNORE + UPDATE for upsert semantics because some uniqueness
--   in SQLite is enforced via expression indexes (not directly targetable by
--   ON CONFLICT(column_list)).
-- - tenant_id is intentionally NULL for all seed rows.
-- - Assumes tables already exist:
--   skills, skill_aliases, skill_block_rules, skill_ruleset_versions

PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

-- --------------------------------------------------------------------
-- 1) Ruleset version seed (first)
-- --------------------------------------------------------------------
INSERT OR IGNORE INTO skill_ruleset_versions (version_name, version_hash, created_at)
VALUES ('seed_v1', 'seed_v1_java_backend_20260224', CURRENT_TIMESTAMP);

UPDATE skill_ruleset_versions
SET version_hash = 'seed_v1_java_backend_20260224'
WHERE version_name = 'seed_v1';

-- --------------------------------------------------------------------
-- 2) Canonical skills (skills upsert by canonical_name, case-insensitive)
-- --------------------------------------------------------------------
-- Must-haves / concepts
INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Java', 'language', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'language', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Java');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Java EE', 'framework', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'framework', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Java EE');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Object-Oriented Design', 'concept', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'concept', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Object-Oriented Design');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Design Patterns', 'concept', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'concept', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Design Patterns');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Data Structures', 'concept', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'concept', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Data Structures');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('System Design', 'concept', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'concept', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('System Design');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Microservices', 'concept', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'concept', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Microservices');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Distributed Computing', 'concept', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'concept', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Distributed Computing');

-- Tech stack / platform / process
INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('AWS', 'platform', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'platform', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('AWS');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Kubernetes', 'platform', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'platform', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Kubernetes');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Docker', 'tool', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'tool', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Docker');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('REST APIs', 'concept', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'concept', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('REST APIs');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('NoSQL', 'database', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'database', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('NoSQL');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('MQ', 'concept', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'concept', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('MQ');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Kafka', 'tool', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'tool', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Kafka');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Automation Testing', 'concept', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'concept', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Automation Testing');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Integration Testing', 'concept', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'concept', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Integration Testing');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Terraform', 'tool', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'tool', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Terraform');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('CI/CD', 'concept', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'concept', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('CI/CD');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Agile', 'methodology', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'methodology', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Agile');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Batch Processing', 'concept', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'concept', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Batch Processing');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('Analytics Platforms', 'concept', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'concept', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('Analytics Platforms');

INSERT OR IGNORE INTO skills (canonical_name, skill_type, status, created_at, updated_at)
VALUES ('GenAI', 'concept', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
UPDATE skills SET skill_type = 'concept', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE lower(canonical_name) = lower('GenAI');

-- --------------------------------------------------------------------
-- 3) Aliases (upsert by tenant_id + alias_text, case-insensitive)
-- --------------------------------------------------------------------
-- Helper comment:
-- To add aliases later, repeat pattern:
--   INSERT OR IGNORE ... (SELECT id FROM skills WHERE lower(canonical_name)=lower('<CANONICAL>'));
--   UPDATE skill_aliases ... WHERE tenant_id IS NULL AND lower(alias_text)=lower('<ALIAS>');

-- Java EE aliases
INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'J2EE', 'EXACT', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('Java EE');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('Java EE')),
    match_type = 'EXACT', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('J2EE');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'Java Enterprise Edition', 'PHRASE', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('Java EE');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('Java EE')),
    match_type = 'PHRASE', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('Java Enterprise Edition');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'JavaEE', 'EXACT', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('Java EE');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('Java EE')),
    match_type = 'EXACT', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('JavaEE');

-- Object-Oriented Design aliases
INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'OOD', 'EXACT', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('Object-Oriented Design');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('Object-Oriented Design')),
    match_type = 'EXACT', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('OOD');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'OO Design', 'PHRASE', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('Object-Oriented Design');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('Object-Oriented Design')),
    match_type = 'PHRASE', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('OO Design');

-- Other concept/platform aliases
INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'Design Pattern', 'PHRASE', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('Design Patterns');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('Design Patterns')),
    match_type = 'PHRASE', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('Design Pattern');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'Data Structure', 'PHRASE', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('Data Structures');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('Data Structures')),
    match_type = 'PHRASE', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('Data Structure');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'System Design / HLD', 'PHRASE', 0.8, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('System Design');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('System Design')),
    match_type = 'PHRASE', confidence = 0.8, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('System Design / HLD');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'HLD', 'EXACT', 0.8, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('System Design');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('System Design')),
    match_type = 'EXACT', confidence = 0.8, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('HLD');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'Micro-service', 'PHRASE', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('Microservices');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('Microservices')),
    match_type = 'PHRASE', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('Micro-service');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'Distributed Systems', 'PHRASE', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('Distributed Computing');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('Distributed Computing')),
    match_type = 'PHRASE', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('Distributed Systems');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'K8s', 'EXACT', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('Kubernetes');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('Kubernetes')),
    match_type = 'EXACT', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('K8s');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'Kubernets', 'EXACT', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('Kubernetes');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('Kubernetes')),
    match_type = 'EXACT', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('Kubernets');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'REST API', 'PHRASE', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('REST APIs');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('REST APIs')),
    match_type = 'PHRASE', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('REST API');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'RESTful', 'PHRASE', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('REST APIs');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('REST APIs')),
    match_type = 'PHRASE', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('RESTful');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'Message Queue', 'PHRASE', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('MQ');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('MQ')),
    match_type = 'PHRASE', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('Message Queue');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'Message Queues', 'PHRASE', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('MQ');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('MQ')),
    match_type = 'PHRASE', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('Message Queues');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'CICD', 'EXACT', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('CI/CD');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('CI/CD')),
    match_type = 'EXACT', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('CICD');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'CI CD', 'PHRASE', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('CI/CD');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('CI/CD')),
    match_type = 'PHRASE', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('CI CD');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'Generative AI', 'PHRASE', 1.0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('GenAI');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('GenAI')),
    match_type = 'PHRASE', confidence = 1.0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('Generative AI');

INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, match_type, confidence, tenant_id, created_at, updated_at)
SELECT id, 'LLM', 'EXACT', 0.8, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('GenAI');
UPDATE skill_aliases
SET skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('GenAI')),
    match_type = 'EXACT', confidence = 0.8, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL AND lower(alias_text) = lower('LLM');

-- --------------------------------------------------------------------
-- 4) Block rules (upsert by tenant_id + blocks_skill_id + pattern_text)
-- --------------------------------------------------------------------
-- Java should not match JavaScript/TypeScript contexts
INSERT OR IGNORE INTO skill_block_rules
  (blocks_skill_id, pattern_text, match_type, tenant_id, created_at, updated_at)
SELECT id, 'JavaScript', 'EXACT', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('Java');
UPDATE skill_block_rules
SET match_type = 'EXACT', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL
  AND blocks_skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('Java'))
  AND pattern_text = 'JavaScript';

INSERT OR IGNORE INTO skill_block_rules
  (blocks_skill_id, pattern_text, match_type, tenant_id, created_at, updated_at)
SELECT id, 'TypeScript', 'EXACT', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('Java');
UPDATE skill_block_rules
SET match_type = 'EXACT', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL
  AND blocks_skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('Java'))
  AND pattern_text = 'TypeScript';

-- Optional quality guard examples
INSERT OR IGNORE INTO skill_block_rules
  (blocks_skill_id, pattern_text, match_type, tenant_id, created_at, updated_at)
SELECT id, 'SQL', 'EXACT', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('NoSQL');
UPDATE skill_block_rules
SET match_type = 'EXACT', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL
  AND blocks_skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('NoSQL'))
  AND pattern_text = 'SQL';

INSERT OR IGNORE INTO skill_block_rules
  (blocks_skill_id, pattern_text, match_type, tenant_id, created_at, updated_at)
SELECT id, 'Kafkaesque', 'PHRASE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM skills WHERE lower(canonical_name) = lower('Kafka');
UPDATE skill_block_rules
SET match_type = 'PHRASE', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id IS NULL
  AND blocks_skill_id = (SELECT id FROM skills WHERE lower(canonical_name) = lower('Kafka'))
  AND pattern_text = 'Kafkaesque';

COMMIT;

-- --------------------------------------------------------------------
-- Extension guidance
-- --------------------------------------------------------------------
-- 1) Add a new canonical skill:
--    INSERT OR IGNORE INTO skills (...) VALUES (...);
--    UPDATE skills ... WHERE lower(canonical_name)=lower('<name>');
--
-- 2) Add a tenant-specific alias:
--    INSERT OR IGNORE INTO skill_aliases (skill_id, alias_text, ..., tenant_id)
--    SELECT id, '<alias>', ..., '<tenant-id>' FROM skills WHERE lower(canonical_name)=lower('<canonical>');
--
-- 3) Add a tenant-specific block rule:
--    INSERT OR IGNORE INTO skill_block_rules (blocks_skill_id, pattern_text, ..., tenant_id)
--    SELECT id, '<pattern>', ..., '<tenant-id>' FROM skills WHERE lower(canonical_name)=lower('<canonical>');
