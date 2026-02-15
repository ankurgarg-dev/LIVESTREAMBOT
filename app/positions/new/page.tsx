'use client';

import React from 'react';
import {
  ARCHETYPES,
  DEEP_DIVE_MODES,
  DURATIONS,
  EVALUATION_POLICIES,
  FOCUS_AREAS,
  INTERVIEW_ROUND_TYPES,
  LEVELS,
  ROLE_FAMILIES,
  STRICTNESS_LEVELS,
  type PositionConfigCore,
} from '@/lib/position/types';
import { applyDeterministicMapping } from '@/lib/position/logic';
import styles from './page.module.css';

type PrefillApiResponse = {
  ok: boolean;
  error?: string;
  rawExtraction: unknown;
  normalizedPrefill: PositionConfigCore;
  extractionConfidence: number;
  missingFields: string[];
  warnings: string[];
  summary: string;
};

type PositionRecord = PositionConfigCore & {
  position_id: string;
  normalized_prefill: PositionConfigCore;
  extraction_confidence: number;
  missing_fields: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
};

function emptyConfig(): PositionConfigCore {
  return {
    role_title: '',
    role_family: 'full_stack',
    level: 'mid',
    interview_round_type: 'standard',
    archetype_id: 'full_stack_general',
    duration_minutes: 60,
    must_haves: [],
    nice_to_haves: [],
    tech_stack: [],
    focus_areas: [],
    deep_dive_mode: 'none',
    strictness: 'balanced',
    evaluation_policy: 'holistic',
    notes_for_interviewer: '',
  };
}

function TagInput(props: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = React.useState('');
  const addTag = () => {
    const value = draft.trim();
    if (!value) return;
    const next = Array.from(new Set([...props.values, value]));
    props.onChange(next);
    setDraft('');
  };

  return (
    <div className={styles.tagWrap}>
      <strong>{props.label}</strong>
      <div className={styles.tags}>
        {props.values.map((tag) => (
          <span className={styles.tag} key={tag}>
            {tag}
            <button type="button" onClick={() => props.onChange(props.values.filter((v) => v !== tag))}>
              x
            </button>
          </span>
        ))}
      </div>
      <div className={styles.row}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={props.placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            }
          }}
        />
        <button type="button" className="lk-button" onClick={addTag}>
          Add
        </button>
      </div>
    </div>
  );
}

export default function NewPositionPage() {
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const [roleTitle, setRoleTitle] = React.useState('');
  const [jdText, setJdText] = React.useState('');
  const [jdFile, setJdFile] = React.useState<File | null>(null);
  const [createdBy, setCreatedBy] = React.useState('moderator');

  const [rawExtraction, setRawExtraction] = React.useState<unknown>(null);
  const [editingPositionId, setEditingPositionId] = React.useState('');
  const [prefill, setPrefill] = React.useState<PositionConfigCore>(emptyConfig());
  const [finalConfig, setFinalConfig] = React.useState<PositionConfigCore>(emptyConfig());
  const [missingFields, setMissingFields] = React.useState<string[]>([]);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [summary, setSummary] = React.useState('');
  const [confidence, setConfidence] = React.useState(0);
  const [positions, setPositions] = React.useState<PositionRecord[]>([]);

  const loadPositions = React.useCallback(async () => {
    const response = await fetch('/api/positions', { cache: 'no-store' });
    const json = (await response.json()) as { ok: boolean; error?: string; positions?: PositionRecord[] };
    if (!response.ok || !json.ok) throw new Error(json.error || 'Failed to load positions');
    setPositions(json.positions || []);
  }, []);

  React.useEffect(() => {
    loadPositions().catch((e) => {
      setError(e instanceof Error ? e.message : 'Failed to load positions');
    });
  }, [loadPositions]);

  const runPrefill = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const form = new FormData();
      form.set('roleTitle', roleTitle);
      form.set('jdText', jdText);
      if (jdFile) form.set('jdFile', jdFile);

      const response = await fetch('/api/positions/prefill', { method: 'POST', body: form });
      const json = (await response.json()) as PrefillApiResponse;
      if (!response.ok || !json.ok) throw new Error(json.error || 'Failed to prefill');

      setRawExtraction(json.rawExtraction);
      setPrefill(json.normalizedPrefill);
      setFinalConfig(json.normalizedPrefill);
      setEditingPositionId('');
      setMissingFields(json.missingFields || []);
      setWarnings(json.warnings || []);
      setSummary(json.summary || 'Prefill completed.');
      setConfidence(json.extractionConfidence || 0);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to prefill');
    } finally {
      setLoading(false);
    }
  };

  const onRoleOrLevelChange = (patch: Partial<PositionConfigCore>) => {
    const next = { ...finalConfig, ...patch };
    const mapped = applyDeterministicMapping(next);
    setFinalConfig({
      ...next,
      archetype_id: mapped.archetype_id,
      duration_minutes: mapped.duration_minutes,
    });
  };

  const savePosition = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(editingPositionId ? `/api/positions/${editingPositionId}` : '/api/positions', {
        method: editingPositionId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawExtraction,
          normalizedPrefill: prefill,
          finalConfig,
          extractionConfidence: confidence,
          missingFields,
          createdBy,
        }),
      });
      const json = (await response.json()) as { ok: boolean; error?: string; position?: { position_id: string } };
      if (!response.ok || !json.ok) throw new Error(json.error || 'Failed to save position');
      setSuccess(
        editingPositionId
          ? `Position ${editingPositionId} updated`
          : `Position saved with ID ${json.position?.position_id}`,
      );
      await loadPositions();
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save position');
    } finally {
      setSaving(false);
    }
  };

  const startNew = () => {
    setStep(1);
    setEditingPositionId('');
    setRawExtraction(null);
    setPrefill(emptyConfig());
    setFinalConfig(emptyConfig());
    setMissingFields([]);
    setWarnings([]);
    setSummary('');
    setConfidence(0);
    setError('');
    setSuccess('');
  };

  const startEdit = (position: PositionRecord) => {
    setEditingPositionId(position.position_id);
    setPrefill(position.normalized_prefill);
    setFinalConfig({
      role_title: position.role_title,
      role_family: position.role_family,
      level: position.level,
      interview_round_type: position.interview_round_type,
      archetype_id: position.archetype_id,
      duration_minutes: position.duration_minutes,
      must_haves: position.must_haves,
      nice_to_haves: position.nice_to_haves,
      tech_stack: position.tech_stack,
      focus_areas: position.focus_areas,
      deep_dive_mode: position.deep_dive_mode,
      strictness: position.strictness,
      evaluation_policy: position.evaluation_policy,
      notes_for_interviewer: position.notes_for_interviewer,
    });
    setMissingFields(position.missing_fields || []);
    setConfidence(position.extraction_confidence || 0);
    setSummary(`Editing saved position ${position.position_id}`);
    setWarnings([]);
    setStep(2);
    setError('');
    setSuccess('');
  };

  return (
    <main className={styles.main} data-lk-theme="default">
      <h2 style={{ margin: 0 }}>New Position</h2>
      <p className={styles.subtle}>Step {step} of 3: JD ingest, review/edit, save configuration.</p>

      <section className={styles.panel}>
        <h3 style={{ margin: 0 }}>Step 1: JD input</h3>
        <div className={styles.grid2}>
          <input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Role title (optional)" />
          <input value={createdBy} onChange={(e) => setCreatedBy(e.target.value)} placeholder="Created by" />
        </div>
        <textarea
          rows={8}
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
          placeholder="Paste JD text here"
        />
        <input type="file" accept=".txt,.md,.json,.csv,.pdf,.doc,.docx" onChange={(e) => setJdFile(e.target.files?.[0] || null)} />
        <div className={styles.row}>
          <button type="button" className="lk-button" onClick={runPrefill} disabled={loading}>
            {loading ? 'Prefilling...' : 'Prefill from JD'}
          </button>
          <button type="button" className="lk-button" onClick={startNew}>
            New Draft
          </button>
        </div>
      </section>

      <section className={styles.panel}>
        <h3 style={{ margin: 0 }}>Created Positions</h3>
        {positions.length === 0 ? <p className={styles.subtle}>No positions saved yet.</p> : null}
        <div className={styles.list}>
          {positions.map((position) => (
            <div key={position.position_id} className={styles.card}>
              <strong>{position.role_title}</strong>
              <p className={styles.subtle}>
                {position.role_family} / {position.level} / {position.interview_round_type} / {position.duration_minutes}
                m
              </p>
              <p className={styles.subtle}>
                Updated: {new Date(position.updated_at).toLocaleString()} | v{position.version}
              </p>
              <div className={styles.row}>
                <button type="button" className="lk-button" onClick={() => startEdit(position)}>
                  View / Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {step >= 2 ? (
        <section className={styles.panel}>
          <h3 style={{ margin: 0 }}>Step 2: Review & edit</h3>
          <p className={styles.subtle}>{summary}</p>
          <p className={styles.subtle}>{`Extraction confidence: ${(confidence * 100).toFixed(0)}%`}</p>
          {missingFields.length > 0 ? <p className={styles.warn}>{`Missing: ${missingFields.join(', ')}`}</p> : null}
          {warnings.map((w) => (
            <p className={styles.warn} key={w}>
              {w}
            </p>
          ))}

          <div className={styles.grid3}>
            <input
              value={finalConfig.role_title}
              onChange={(e) => setFinalConfig((prev) => ({ ...prev, role_title: e.target.value }))}
              placeholder="Role title"
            />
            <select value={finalConfig.role_family} onChange={(e) => onRoleOrLevelChange({ role_family: e.target.value as PositionConfigCore['role_family'] })}>
              {ROLE_FAMILIES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select value={finalConfig.level} onChange={(e) => onRoleOrLevelChange({ level: e.target.value as PositionConfigCore['level'] })}>
              {LEVELS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select
              value={finalConfig.interview_round_type}
              onChange={(e) => setFinalConfig((prev) => ({ ...prev, interview_round_type: e.target.value as PositionConfigCore['interview_round_type'] }))}
            >
              {INTERVIEW_ROUND_TYPES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select value={finalConfig.archetype_id} onChange={(e) => setFinalConfig((prev) => ({ ...prev, archetype_id: e.target.value as PositionConfigCore['archetype_id'] }))}>
              {ARCHETYPES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select
              value={finalConfig.duration_minutes}
              onChange={(e) => setFinalConfig((prev) => ({ ...prev, duration_minutes: Number(e.target.value) as PositionConfigCore['duration_minutes'] }))}
            >
              {DURATIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select
              value={finalConfig.deep_dive_mode}
              onChange={(e) => setFinalConfig((prev) => ({ ...prev, deep_dive_mode: e.target.value as PositionConfigCore['deep_dive_mode'] }))}
            >
              {DEEP_DIVE_MODES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select value={finalConfig.strictness} onChange={(e) => setFinalConfig((prev) => ({ ...prev, strictness: e.target.value as PositionConfigCore['strictness'] }))}>
              {STRICTNESS_LEVELS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select
              value={finalConfig.evaluation_policy}
              onChange={(e) => setFinalConfig((prev) => ({ ...prev, evaluation_policy: e.target.value as PositionConfigCore['evaluation_policy'] }))}
            >
              {EVALUATION_POLICIES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <TagInput
            label="Must haves"
            values={finalConfig.must_haves}
            onChange={(next) => setFinalConfig((prev) => ({ ...prev, must_haves: next.slice(0, 8) }))}
            placeholder="Add must-have skill"
          />
          <TagInput
            label="Nice to haves"
            values={finalConfig.nice_to_haves}
            onChange={(next) => setFinalConfig((prev) => ({ ...prev, nice_to_haves: next.slice(0, 8) }))}
            placeholder="Add nice-to-have skill"
          />
          <TagInput
            label="Tech stack"
            values={finalConfig.tech_stack}
            onChange={(next) => setFinalConfig((prev) => ({ ...prev, tech_stack: next.slice(0, 15) }))}
            placeholder="Add tech"
          />
          <TagInput
            label="Focus areas"
            values={finalConfig.focus_areas}
            onChange={(next) =>
              setFinalConfig((prev) => ({
                ...prev,
                focus_areas: next
                  .map((v) => v.trim().toLowerCase().replace(/\s+/g, '_'))
                  .filter((v): v is PositionConfigCore['focus_areas'][number] => FOCUS_AREAS.includes(v as PositionConfigCore['focus_areas'][number]))
                  .slice(0, 4),
              }))
            }
            placeholder="Add focus area"
          />

          <textarea
            rows={4}
            value={finalConfig.notes_for_interviewer}
            onChange={(e) => setFinalConfig((prev) => ({ ...prev, notes_for_interviewer: e.target.value.slice(0, 600) }))}
            placeholder="Notes for interviewer (max 600 chars)"
          />

          <div className={styles.row}>
            <button type="button" className="lk-button" onClick={() => setFinalConfig(applyDeterministicMapping(finalConfig))}>
              Reset Suggestions
            </button>
            <button type="button" className="lk-button" onClick={savePosition} disabled={saving}>
              {saving ? 'Saving...' : editingPositionId ? 'Update PositionConfig' : 'Save PositionConfig'}
            </button>
          </div>
        </section>
      ) : null}

      {error ? <p className={styles.warn}>{error}</p> : null}
      {success ? <p className={styles.ok}>{success}</p> : null}

      {step === 3 ? (
        <section className={styles.panel}>
          <h3 style={{ margin: 0 }}>Step 3: Completed</h3>
          <p className={styles.ok}>Position configuration saved.</p>
        </section>
      ) : null}
    </main>
  );
}
