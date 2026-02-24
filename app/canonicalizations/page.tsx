'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import styles from './page.module.css';

type SkillAlias = {
  id: number;
  skillId: number;
  aliasText: string;
  matchType: 'EXACT' | 'PHRASE' | 'REGEX';
  confidence: number;
  tenantId: string | null;
};

type SkillBlockRule = {
  id: number;
  blocksSkillId: number;
  patternText: string;
  matchType: 'EXACT' | 'PHRASE' | 'REGEX';
  tenantId: string | null;
};

type Skill = {
  id: number;
  canonicalName: string;
  skillType: string;
  status: string;
  aliases: SkillAlias[];
  blockRules: SkillBlockRule[];
};

type PrefillResponse = {
  ok: boolean;
  normalizedPrefill?: {
    must_haves: string[];
    nice_to_haves: string[];
    tech_stack: string[];
  };
  error?: string;
};

type CvSuggestion = {
  action: 'add_alias' | 'add_skill';
  sourceText: string;
  canonicalName: string;
  canonicalSkillId: number | null;
  confidence: number;
  reason: string;
  suggestedMatchType: 'EXACT' | 'PHRASE' | 'REGEX';
  suggestedSkillType: string;
};

export default function CanonicalizationsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');

  const [newSkill, setNewSkill] = useState({ canonicalName: '', skillType: 'concept', status: 'ACTIVE' });
  const [jdText, setJdText] = useState('');
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [analyzingCv, setAnalyzingCv] = useState(false);
  const [applyingCv, setApplyingCv] = useState(false);
  const [cvSuggestions, setCvSuggestions] = useState<CvSuggestion[]>([]);

  const [aliasDraft, setAliasDraft] = useState<Record<number, { aliasText: string; matchType: 'EXACT' | 'PHRASE' | 'REGEX'; confidence: number }>>({});
  const [blockDraft, setBlockDraft] = useState<Record<number, { patternText: string; matchType: 'EXACT' | 'PHRASE' | 'REGEX' }>>({});

  async function loadSkills() {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/skills', { cache: 'no-store' });
      const json = (await res.json()) as { ok: boolean; skills?: Skill[]; error?: string };
      if (!json.ok) throw new Error(json.error || 'Failed to load skills');
      setSkills(Array.isArray(json.skills) ? json.skills : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load skills');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSkills();
  }, []);

  const filteredSkills = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((skill) => {
      if (skill.canonicalName.toLowerCase().includes(q)) return true;
      if (skill.skillType.toLowerCase().includes(q)) return true;
      if (skill.aliases.some((alias) => alias.aliasText.toLowerCase().includes(q))) return true;
      if (skill.blockRules.some((rule) => rule.patternText.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [search, skills]);

  async function createSkill() {
    setMessage('');
    const canonicalName = newSkill.canonicalName.trim();
    if (!canonicalName) {
      setMessage('Canonical name is required.');
      return;
    }

    const res = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSkill),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      setMessage(json.error || 'Failed to save skill');
      return;
    }

    setNewSkill({ canonicalName: '', skillType: 'concept', status: 'ACTIVE' });
    setMessage('Skill saved.');
    await loadSkills();
  }

  async function updateSkill(skill: Skill, patch: Partial<Skill>) {
    setMessage('');
    const res = await fetch(`/api/skills/${skill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      setMessage(json.error || 'Failed to update skill');
      return;
    }
    setMessage('Skill updated.');
    await loadSkills();
  }

  async function deleteSkill(skillId: number) {
    setMessage('');
    const res = await fetch(`/api/skills/${skillId}`, { method: 'DELETE' });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      setMessage(json.error || 'Failed to delete skill');
      return;
    }
    setMessage('Skill deleted.');
    await loadSkills();
  }

  async function addAlias(skillId: number) {
    const draft = aliasDraft[skillId];
    if (!draft || !draft.aliasText.trim()) return;

    const res = await fetch('/api/skills/aliases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillId,
        aliasText: draft.aliasText,
        matchType: draft.matchType,
        confidence: draft.confidence,
        tenantId: null,
      }),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      setMessage(json.error || 'Failed to add alias');
      return;
    }

    setAliasDraft((prev) => ({ ...prev, [skillId]: { aliasText: '', matchType: 'EXACT', confidence: 1 } }));
    setMessage('Alias saved.');
    await loadSkills();
  }

  async function updateAlias(alias: SkillAlias, patch: Partial<SkillAlias>) {
    const res = await fetch(`/api/skills/aliases/${alias.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      setMessage(json.error || 'Failed to update alias');
      return;
    }
    setMessage('Alias updated.');
    await loadSkills();
  }

  async function deleteAlias(aliasId: number) {
    const res = await fetch(`/api/skills/aliases/${aliasId}`, { method: 'DELETE' });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      setMessage(json.error || 'Failed to delete alias');
      return;
    }
    setMessage('Alias deleted.');
    await loadSkills();
  }

  async function addBlockRule(skillId: number) {
    const draft = blockDraft[skillId];
    if (!draft || !draft.patternText.trim()) return;

    const res = await fetch('/api/skills/block-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blocksSkillId: skillId,
        patternText: draft.patternText,
        matchType: draft.matchType,
        tenantId: null,
      }),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      setMessage(json.error || 'Failed to add block rule');
      return;
    }

    setBlockDraft((prev) => ({ ...prev, [skillId]: { patternText: '', matchType: 'EXACT' } }));
    setMessage('Block rule saved.');
    await loadSkills();
  }

  async function updateBlockRule(rule: SkillBlockRule, patch: Partial<SkillBlockRule>) {
    const res = await fetch(`/api/skills/block-rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      setMessage(json.error || 'Failed to update block rule');
      return;
    }
    setMessage('Block rule updated.');
    await loadSkills();
  }

  async function deleteBlockRule(ruleId: number) {
    const res = await fetch(`/api/skills/block-rules/${ruleId}`, { method: 'DELETE' });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      setMessage(json.error || 'Failed to delete block rule');
      return;
    }
    setMessage('Block rule deleted.');
    await loadSkills();
  }

  async function importFromJd() {
    setMessage('');
    setImporting(true);
    try {
      const form = new FormData();
      form.set('roleTitle', 'Imported JD');
      form.set('jdText', jdText);
      if (jdFile) form.set('jdFile', jdFile);

      const prefillRes = await fetch('/api/positions/prefill', {
        method: 'POST',
        body: form,
      });
      const prefill = (await prefillRes.json()) as PrefillResponse;
      if (!prefill.ok || !prefill.normalizedPrefill) {
        throw new Error(prefill.error || 'Failed to parse JD');
      }

      const importRes = await fetch('/api/skills/import-jd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefill.normalizedPrefill),
      });
      const imported = (await importRes.json()) as {
        ok: boolean;
        importedCount?: number;
        addedCount?: number;
        updatedCount?: number;
        error?: string;
      };

      if (!imported.ok) {
        throw new Error(imported.error || 'Import failed');
      }

      setMessage(
        `JD import complete. Imported ${imported.importedCount || 0} skills (added ${imported.addedCount || 0}, updated ${imported.updatedCount || 0}).`,
      );
      await loadSkills();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function analyzeCv() {
    setMessage('');
    setAnalyzingCv(true);
    try {
      if (!cvFile) throw new Error('Please choose a CV file first.');
      const form = new FormData();
      form.set('cvFile', cvFile);
      const res = await fetch('/api/skills/import-cv', { method: 'POST', body: form });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        suggestions?: CvSuggestion[];
        extractedTermCount?: number;
      };
      if (!json.ok) throw new Error(json.error || 'Failed to analyze CV');
      const suggestions = Array.isArray(json.suggestions) ? json.suggestions : [];
      setCvSuggestions(suggestions);
      setMessage(`CV analyzed. Found ${suggestions.length} mapping suggestions.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to analyze CV');
    } finally {
      setAnalyzingCv(false);
    }
  }

  async function applyCvSuggestions() {
    setMessage('');
    setApplyingCv(true);
    try {
      if (!cvSuggestions.length) throw new Error('No suggestions to apply.');
      const res = await fetch('/api/skills/import-cv', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestions: cvSuggestions }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        appliedCount?: number;
        addedSkills?: number;
        addedAliases?: number;
      };
      if (!json.ok) throw new Error(json.error || 'Failed to apply CV suggestions');
      setMessage(
        `Applied ${json.appliedCount || 0} suggestions (skills ${json.addedSkills || 0}, aliases ${json.addedAliases || 0}).`,
      );
      setCvSuggestions([]);
      await loadSkills();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to apply CV suggestions');
    } finally {
      setApplyingCv(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <Link href="/" className={styles.homeButton}>
          Home
        </Link>
      </div>
      <h1>Canonical Skills Manager</h1>

      <section className={styles.panel}>
        <h2>Import From JD</h2>
        <p className={styles.help}>Upload/paste a JD. System parses skills and upserts canonical skills.</p>
        <textarea
          className={styles.textarea}
          placeholder="Paste JD text (optional if file is uploaded)"
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
        />
        <input type="file" onChange={(e) => setJdFile(e.target.files?.[0] || null)} />
        <button type="button" className={styles.button} onClick={importFromJd} disabled={importing}>
          {importing ? 'Importing...' : 'Import JD'}
        </button>
      </section>

      <section className={styles.panel}>
        <h2>Import From CV</h2>
        <p className={styles.help}>Analyze CV text to suggest new canonical skills and synonym aliases.</p>
        <div className={styles.row}>
          <input type="file" onChange={(e) => setCvFile(e.target.files?.[0] || null)} />
          <button type="button" className={styles.button} onClick={analyzeCv} disabled={analyzingCv}>
            {analyzingCv ? 'Analyzing...' : 'Analyze CV'}
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={applyCvSuggestions}
            disabled={applyingCv || cvSuggestions.length === 0}
          >
            {applyingCv ? 'Applying...' : `Apply Suggestions (${cvSuggestions.length})`}
          </button>
        </div>
        {cvSuggestions.length > 0 ? (
          <div className={styles.suggestionList}>
            {cvSuggestions.map((s, idx) => (
              <div key={`${s.sourceText}-${s.canonicalName}-${idx}`} className={styles.suggestionRow}>
                <span className={styles.tag}>{s.action === 'add_alias' ? 'Alias' : 'New Skill'}</span>
                <span className={styles.sourceText}>{s.sourceText}</span>
                <span>{s.action === 'add_alias' ? `-> ${s.canonicalName}` : `-> ${s.suggestedSkillType}`}</span>
                <span className={styles.confidence}>{Math.round(s.confidence * 100)}%</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className={styles.panel}>
        <h2>Create / Upsert Skill</h2>
        <div className={styles.row}>
          <input
            className={styles.input}
            placeholder="Canonical name"
            value={newSkill.canonicalName}
            onChange={(e) => setNewSkill((prev) => ({ ...prev, canonicalName: e.target.value }))}
          />
          <input
            className={styles.input}
            placeholder="Skill type"
            value={newSkill.skillType}
            onChange={(e) => setNewSkill((prev) => ({ ...prev, skillType: e.target.value }))}
          />
          <select
            className={styles.input}
            value={newSkill.status}
            onChange={(e) => setNewSkill((prev) => ({ ...prev, status: e.target.value }))}
          >
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>
          <button type="button" className={styles.button} onClick={createSkill}>Save</button>
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Skill Catalog</h2>
        <input
          className={styles.input}
          placeholder="Search skills/aliases/block rules"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {loading ? <p>Loading...</p> : null}
        {message ? <p className={styles.message}>{message}</p> : null}

        {filteredSkills.map((skill) => (
          <article key={skill.id} className={styles.skillCard}>
            <div className={styles.skillHeader}>
              <input
                className={styles.input}
                value={skill.canonicalName}
                onChange={(e) =>
                  setSkills((prev) => prev.map((s) => (s.id === skill.id ? { ...s, canonicalName: e.target.value } : s)))
                }
              />
              <input
                className={styles.input}
                value={skill.skillType}
                onChange={(e) =>
                  setSkills((prev) => prev.map((s) => (s.id === skill.id ? { ...s, skillType: e.target.value } : s)))
                }
              />
              <select
                className={styles.input}
                value={skill.status}
                onChange={(e) =>
                  setSkills((prev) => prev.map((s) => (s.id === skill.id ? { ...s, status: e.target.value } : s)))
                }
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
              <button type="button" className={styles.button} onClick={() => updateSkill(skill, skill)}>Update</button>
              <button type="button" className={styles.buttonDanger} onClick={() => deleteSkill(skill.id)}>Delete</button>
            </div>

            <div className={styles.grid2}>
              <div>
                <h3>Aliases</h3>
                {skill.aliases.map((alias) => (
                  <div key={alias.id} className={styles.row}>
                    <input
                      className={styles.input}
                      value={alias.aliasText}
                      onChange={(e) =>
                        setSkills((prev) =>
                          prev.map((s) =>
                            s.id !== skill.id
                              ? s
                              : {
                                  ...s,
                                  aliases: s.aliases.map((a) => (a.id === alias.id ? { ...a, aliasText: e.target.value } : a)),
                                },
                          ),
                        )
                      }
                    />
                    <select
                      className={styles.input}
                      value={alias.matchType}
                      onChange={(e) =>
                        updateAlias(alias, { matchType: e.target.value as SkillAlias['matchType'] })
                      }
                    >
                      <option value="EXACT">EXACT</option>
                      <option value="PHRASE">PHRASE</option>
                      <option value="REGEX">REGEX</option>
                    </select>
                    <input
                      className={styles.input}
                      type="number"
                      min={0}
                      max={1}
                      step={0.1}
                      value={alias.confidence}
                      onChange={(e) => updateAlias(alias, { confidence: Number(e.target.value) })}
                    />
                    <button type="button" className={styles.button} onClick={() => updateAlias(alias, { aliasText: alias.aliasText })}>
                      Save
                    </button>
                    <button type="button" className={styles.buttonDanger} onClick={() => deleteAlias(alias.id)}>
                      Delete
                    </button>
                  </div>
                ))}
                <div className={styles.row}>
                  <input
                    className={styles.input}
                    placeholder="New alias"
                    value={aliasDraft[skill.id]?.aliasText || ''}
                    onChange={(e) =>
                      setAliasDraft((prev) => ({
                        ...prev,
                        [skill.id]: {
                          aliasText: e.target.value,
                          matchType: prev[skill.id]?.matchType || 'EXACT',
                          confidence: prev[skill.id]?.confidence ?? 1,
                        },
                      }))
                    }
                  />
                  <select
                    className={styles.input}
                    value={aliasDraft[skill.id]?.matchType || 'EXACT'}
                    onChange={(e) =>
                      setAliasDraft((prev) => ({
                        ...prev,
                        [skill.id]: {
                          aliasText: prev[skill.id]?.aliasText || '',
                          matchType: e.target.value as SkillAlias['matchType'],
                          confidence: prev[skill.id]?.confidence ?? 1,
                        },
                      }))
                    }
                  >
                    <option value="EXACT">EXACT</option>
                    <option value="PHRASE">PHRASE</option>
                    <option value="REGEX">REGEX</option>
                  </select>
                  <input
                    className={styles.input}
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={aliasDraft[skill.id]?.confidence ?? 1}
                    onChange={(e) =>
                      setAliasDraft((prev) => ({
                        ...prev,
                        [skill.id]: {
                          aliasText: prev[skill.id]?.aliasText || '',
                          matchType: prev[skill.id]?.matchType || 'EXACT',
                          confidence: Number(e.target.value),
                        },
                      }))
                    }
                  />
                  <button type="button" className={styles.button} onClick={() => addAlias(skill.id)}>
                    Add Alias
                  </button>
                </div>
              </div>

              <div>
                <h3>Block Rules</h3>
                {skill.blockRules.map((rule) => (
                  <div key={rule.id} className={styles.row}>
                    <input
                      className={styles.input}
                      value={rule.patternText}
                      onChange={(e) =>
                        setSkills((prev) =>
                          prev.map((s) =>
                            s.id !== skill.id
                              ? s
                              : {
                                  ...s,
                                  blockRules: s.blockRules.map((r) => (r.id === rule.id ? { ...r, patternText: e.target.value } : r)),
                                },
                          ),
                        )
                      }
                    />
                    <select
                      className={styles.input}
                      value={rule.matchType}
                      onChange={(e) => updateBlockRule(rule, { matchType: e.target.value as SkillBlockRule['matchType'] })}
                    >
                      <option value="EXACT">EXACT</option>
                      <option value="PHRASE">PHRASE</option>
                      <option value="REGEX">REGEX</option>
                    </select>
                    <button type="button" className={styles.button} onClick={() => updateBlockRule(rule, { patternText: rule.patternText })}>
                      Save
                    </button>
                    <button type="button" className={styles.buttonDanger} onClick={() => deleteBlockRule(rule.id)}>
                      Delete
                    </button>
                  </div>
                ))}
                <div className={styles.row}>
                  <input
                    className={styles.input}
                    placeholder="New block pattern"
                    value={blockDraft[skill.id]?.patternText || ''}
                    onChange={(e) =>
                      setBlockDraft((prev) => ({
                        ...prev,
                        [skill.id]: {
                          patternText: e.target.value,
                          matchType: prev[skill.id]?.matchType || 'EXACT',
                        },
                      }))
                    }
                  />
                  <select
                    className={styles.input}
                    value={blockDraft[skill.id]?.matchType || 'EXACT'}
                    onChange={(e) =>
                      setBlockDraft((prev) => ({
                        ...prev,
                        [skill.id]: {
                          patternText: prev[skill.id]?.patternText || '',
                          matchType: e.target.value as SkillBlockRule['matchType'],
                        },
                      }))
                    }
                  >
                    <option value="EXACT">EXACT</option>
                    <option value="PHRASE">PHRASE</option>
                    <option value="REGEX">REGEX</option>
                  </select>
                  <button type="button" className={styles.button} onClick={() => addBlockRule(skill.id)}>
                    Add Block Rule
                  </button>
                </div>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
