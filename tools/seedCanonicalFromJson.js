#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

function normalizeText(value) {
  return String(value || '').trim();
}

function lower(value) {
  return normalizeText(value).toLowerCase();
}

function readPayload(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(absolute, 'utf8');
  const parsed = JSON.parse(raw);
  return parsed;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node tools/seedCanonicalFromJson.js <json-file-path>');
    process.exit(1);
  }

  const payload = readPayload(inputPath);
  const prisma = new PrismaClient();

  try {
    const skillsInput = Array.isArray(payload.skills) ? payload.skills : [];
    const aliasesInput = Array.isArray(payload.aliases) ? payload.aliases : [];
    const blockRulesInput = Array.isArray(payload.blockRules) ? payload.blockRules : [];
    const rulesetVersion = payload.rulesetVersion || null;

    const summary = {
      ruleset: { created: 0, updated: 0, skipped: 0 },
      skills: { created: 0, updated: 0, skipped: 0 },
      aliases: { created: 0, updated: 0, skipped: 0 },
      blockRules: { created: 0, updated: 0, skipped: 0 },
    };

    if (rulesetVersion && normalizeText(rulesetVersion.versionName) && normalizeText(rulesetVersion.versionHash)) {
      const versionName = normalizeText(rulesetVersion.versionName);
      const versionHash = normalizeText(rulesetVersion.versionHash);
      const existingByName = await prisma.skillRulesetVersion.findFirst({
        where: { versionName },
      });
      const existingByHash = await prisma.skillRulesetVersion.findFirst({
        where: { versionHash },
      });
      const existing = existingByName || existingByHash;
      if (existing) {
        if (existing.versionName !== versionName || existing.versionHash !== versionHash) {
          await prisma.skillRulesetVersion.update({
            where: { id: existing.id },
            data: { versionName, versionHash },
          });
          summary.ruleset.updated += 1;
        } else {
          summary.ruleset.skipped += 1;
        }
      } else {
        await prisma.skillRulesetVersion.create({
          data: { versionName, versionHash },
        });
        summary.ruleset.created += 1;
      }
    } else {
      summary.ruleset.skipped += 1;
    }

    const existingSkills = await prisma.skill.findMany({
      select: { id: true, canonicalName: true, skillType: true, status: true },
    });
    const skillByNameLower = new Map(existingSkills.map((s) => [lower(s.canonicalName), s]));

    for (const row of skillsInput) {
      const canonicalName = normalizeText(row?.canonicalName);
      const skillType = normalizeText(row?.skillType) || 'general';
      if (!canonicalName) {
        summary.skills.skipped += 1;
        continue;
      }

      const key = lower(canonicalName);
      const existing = skillByNameLower.get(key);
      if (existing) {
        if (
          existing.canonicalName !== canonicalName ||
          lower(existing.skillType) !== lower(skillType) ||
          upper(existing.status) !== 'ACTIVE'
        ) {
          const updated = await prisma.skill.update({
            where: { id: existing.id },
            data: {
              canonicalName,
              skillType,
              status: 'ACTIVE',
              updatedAt: new Date(),
            },
          });
          skillByNameLower.set(key, updated);
          summary.skills.updated += 1;
        } else {
          summary.skills.skipped += 1;
        }
      } else {
        const created = await prisma.skill.create({
          data: {
            canonicalName,
            skillType,
            status: 'ACTIVE',
          },
        });
        skillByNameLower.set(key, created);
        summary.skills.created += 1;
      }
    }

    const allSkillsAfterUpsert = await prisma.skill.findMany({
      select: { id: true, canonicalName: true },
    });
    const skillIdByCanonicalLower = new Map(allSkillsAfterUpsert.map((s) => [lower(s.canonicalName), s.id]));

    const existingAliases = await prisma.skillAlias.findMany({
      where: { tenantId: null },
      select: { id: true, skillId: true, aliasText: true, matchType: true, confidence: true },
    });
    const aliasByLowerText = new Map(existingAliases.map((a) => [lower(a.aliasText), a]));

    for (const row of aliasesInput) {
      const canonicalName = normalizeText(row?.canonicalName);
      const aliasText = normalizeText(row?.aliasText);
      const matchType = normalizeText(row?.matchType || 'PHRASE').toUpperCase();
      const confidence = Number(row?.confidence);
      const normalizedConfidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 1;
      if (!canonicalName || !aliasText) {
        summary.aliases.skipped += 1;
        continue;
      }

      const skillId = skillIdByCanonicalLower.get(lower(canonicalName));
      if (!skillId) {
        summary.aliases.skipped += 1;
        continue;
      }

      const existing = aliasByLowerText.get(lower(aliasText));
      if (existing) {
        if (
          existing.skillId !== skillId ||
          upper(existing.matchType) !== matchType ||
          Number(existing.confidence) !== normalizedConfidence
        ) {
          const updated = await prisma.skillAlias.update({
            where: { id: existing.id },
            data: {
              skillId,
              aliasText,
              matchType,
              confidence: normalizedConfidence,
              updatedAt: new Date(),
            },
          });
          aliasByLowerText.set(lower(aliasText), updated);
          summary.aliases.updated += 1;
        } else {
          summary.aliases.skipped += 1;
        }
      } else {
        const created = await prisma.skillAlias.create({
          data: {
            skillId,
            aliasText,
            matchType,
            confidence: normalizedConfidence,
            tenantId: null,
          },
        });
        aliasByLowerText.set(lower(aliasText), created);
        summary.aliases.created += 1;
      }
    }

    const existingRules = await prisma.skillBlockRule.findMany({
      where: { tenantId: null },
      select: { id: true, blocksSkillId: true, patternText: true, matchType: true },
    });
    const blockByKey = new Map(
      existingRules.map((r) => [`${r.blocksSkillId}::${lower(r.patternText)}`, r]),
    );

    for (const row of blockRulesInput) {
      const canonicalName = normalizeText(row?.blocksCanonicalName);
      const patternText = normalizeText(row?.patternText);
      const matchType = normalizeText(row?.matchType || 'EXACT').toUpperCase();
      if (!canonicalName || !patternText) {
        summary.blockRules.skipped += 1;
        continue;
      }

      const blocksSkillId = skillIdByCanonicalLower.get(lower(canonicalName));
      if (!blocksSkillId) {
        summary.blockRules.skipped += 1;
        continue;
      }

      const key = `${blocksSkillId}::${lower(patternText)}`;
      const existing = blockByKey.get(key);
      if (existing) {
        if (upper(existing.matchType) !== matchType || existing.patternText !== patternText) {
          const updated = await prisma.skillBlockRule.update({
            where: { id: existing.id },
            data: {
              patternText,
              matchType,
              updatedAt: new Date(),
            },
          });
          blockByKey.set(key, updated);
          summary.blockRules.updated += 1;
        } else {
          summary.blockRules.skipped += 1;
        }
      } else {
        const created = await prisma.skillBlockRule.create({
          data: {
            blocksSkillId,
            patternText,
            matchType,
            tenantId: null,
          },
        });
        blockByKey.set(key, created);
        summary.blockRules.created += 1;
      }
    }

    console.log(JSON.stringify({ ok: true, summary }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

function upper(value) {
  return normalizeText(value).toUpperCase();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

