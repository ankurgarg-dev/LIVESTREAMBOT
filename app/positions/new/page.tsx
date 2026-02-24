'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  DEEP_DIVE_MODES,
  DURATIONS,
  EVALUATION_POLICIES,
  FOCUS_AREAS,
  LEVELS,
  STRICTNESS_LEVELS,
  type PositionConfigCore,
} from '@/lib/position/types';
import { applyDeterministicMapping } from '@/lib/position/logic';
import styles from './page.module.css';

type PrefillApiResponse = {
  ok: boolean;
  error?: string;
  jdTextUsed?: string;
  rawExtraction: unknown;
  normalizedPrefill: PositionConfigCore;
  extractionConfidence: number;
  missingFields: string[];
  warnings: string[];
  summary: string;
};

type PositionLoadResponse = {
  ok: boolean;
  error?: string;
  position?: PositionConfigCore & {
    position_id: string;
    jd_text?: string;
    extracted_from_jd_raw?: unknown;
    normalized_prefill?: PositionConfigCore;
    extraction_confidence?: number;
    missing_fields?: string[];
  };
};

const SUPPORTED_JD_FILE_PATTERN = /\.(txt|md|json|csv|doc|docx|pdf)$/i;

const DEEP_DIVE_LABELS: Record<string, string> = {
  none: 'None',
  coding: 'Coding',
  system_design: 'System Design',
  case_study: 'Case Study',
  domain: 'Domain Expertise',
};

const STRICTNESS_LABELS: Record<string, string> = {
  lenient: 'Lenient',
  balanced: 'Balanced',
  strict: 'Strict',
};

const EVALUATION_POLICY_LABELS: Record<string, string> = {
  skills_only: 'Skills Only',
  holistic: 'Holistic',
  potential_weighted: 'Potential Weighted',
  bar_raiser: 'Bar Raiser',
};

function humanize(value: string): string {
  return value
    .split('_')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function emptyConfig(): PositionConfigCore {
  return {
    role_title: '',
    level: 'mid',
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
  suggestions?: string[];
}) {
  const [draft, setDraft] = React.useState('');
  const datalistId = React.useId();

  const addTagValue = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    const next = Array.from(new Set([...props.values, value]));
    props.onChange(next);
    setDraft('');
  };

  const addTag = () => {
    addTagValue(draft);
  };

  return (
    <div className={styles.tagWrap}>
      <strong className={styles.fieldLabel}>{props.label}</strong>
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
          list={props.suggestions?.length ? datalistId : undefined}
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
      {props.suggestions && props.suggestions.length > 0 ? (
        <>
          <datalist id={datalistId}>
            {props.suggestions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <div className={styles.inlineSuggestions}>
            {props.suggestions.slice(0, 10).map((item) => (
              <button type="button" key={item} className={styles.pill} onClick={() => addTagValue(item)}>
                {item}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function NewPositionPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jdFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const [roleTitle, setRoleTitle] = React.useState('');
  const [jdText, setJdText] = React.useState('');
  const [jdFile, setJdFile] = React.useState<File | null>(null);
  const createdBy = 'moderator';

  const [rawExtraction, setRawExtraction] = React.useState<unknown>(null);
  const [editingPositionId, setEditingPositionId] = React.useState('');
  const [prefill, setPrefill] = React.useState<PositionConfigCore>(emptyConfig());
  const [finalConfig, setFinalConfig] = React.useState<PositionConfigCore>(emptyConfig());
  const [missingFields, setMissingFields] = React.useState<string[]>([]);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [summary, setSummary] = React.useState('');
  const [confidence, setConfidence] = React.useState(0);

  React.useEffect(() => {
    const positionId = searchParams.get('positionId');
    if (!positionId) return;
    let canceled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/positions/${encodeURIComponent(positionId)}`);
        const json = (await response.json()) as PositionLoadResponse;
        if (!response.ok || !json.ok || !json.position) {
          throw new Error(json.error || 'Failed to load position');
        }
        if (canceled) return;
        const loaded = json.position;
        const normalizedPrefill = loaded.normalized_prefill || loaded;
        setEditingPositionId(loaded.position_id);
        setRoleTitle(loaded.role_title || '');
        setJdText(String(loaded.jd_text || ''));
        setRawExtraction(loaded.extracted_from_jd_raw ?? null);
        setPrefill(normalizedPrefill);
        setFinalConfig(loaded);
        setMissingFields(Array.isArray(loaded.missing_fields) ? loaded.missing_fields : []);
        setWarnings([]);
        setSummary(`Editing existing position: ${loaded.role_title}`);
        setConfidence(Number(loaded.extraction_confidence || 0));
        setStep(2);
      } catch (e) {
        if (!canceled) setError(e instanceof Error ? e.message : 'Failed to load position');
      } finally {
        if (!canceled) setLoading(false);
      }
    };
    void load();
    return () => {
      canceled = true;
    };
  }, [searchParams]);

  const runPrefill = async (selectedFile?: File | null) => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const form = new FormData();
      form.set('roleTitle', roleTitle);
      form.set('jdText', jdText);
      const fileForPrefill = selectedFile ?? jdFile;
      if (fileForPrefill) form.set('jdFile', fileForPrefill);

      const response = await fetch('/api/positions/prefill', { method: 'POST', body: form });
      const json = (await response.json()) as PrefillApiResponse;
      if (!response.ok || !json.ok) throw new Error(json.error || 'Failed to prefill');

      if (json.jdTextUsed) setJdText(json.jdTextUsed);
      setRawExtraction(json.rawExtraction);
      setPrefill(json.normalizedPrefill);
      setFinalConfig(json.normalizedPrefill);
      if (!roleTitle.trim() && json.normalizedPrefill.role_title) {
        setRoleTitle(json.normalizedPrefill.role_title);
      }
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

  const onLevelChange = (level: PositionConfigCore['level']) => {
    const patch: Partial<PositionConfigCore> = { level };
    const next = { ...finalConfig, ...patch };
    const mapped = applyDeterministicMapping(next);
    setFinalConfig({
      ...next,
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
          jdText,
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
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save position');
    } finally {
      setSaving(false);
    }
  };

  const startNew = () => {
    setStep(1);
    setRoleTitle('');
    setJdText('');
    setJdFile(null);
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
    if (jdFileInputRef.current) {
      jdFileInputRef.current.value = '';
    }
  };

  const onJdFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      setJdFile(null);
      return;
    }
    const textLike = file.type.startsWith('text/') || SUPPORTED_JD_FILE_PATTERN.test(file.name);
    if (!textLike) {
      setJdFile(null);
      setError(`Unsupported JD file type: ${file.name}. Use .txt/.md/.json/.csv/.doc/.docx/.pdf, or paste JD text.`);
      event.target.value = '';
      return;
    }
    setError('');
    setJdFile(file);
    void runPrefill(file);
  };

  return (
    <main className={styles.main} data-lk-theme="default">
      <div className={styles.row}>
        <h2 style={{ margin: 0 }}>New Position</h2>
        <button type="button" className="lk-button" onClick={() => router.push('/?tab=dashboard')}>
          Back to Home
        </button>
      </div>
      <p className={styles.subtle}>Step {step} of 3: JD ingest, review/edit, save configuration.</p>

      <section className={styles.panel}>
        <h3 style={{ margin: 0 }}>Step 1: JD input</h3>
        <input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Role title (optional)" />
        <textarea
          rows={8}
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
          placeholder="Paste JD text here"
        />
        <input
          ref={jdFileInputRef}
          type="file"
          accept=".txt,.md,.json,.csv,.doc,.docx,.pdf,text/plain,text/markdown,application/json,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
          onChange={onJdFileChange}
        />
        {jdFile ? <p className={styles.subtle}>{`Selected file: ${jdFile.name}`}</p> : null}
        <p className={styles.subtle}>Supported upload formats: .txt, .md, .json, .csv, .doc, .docx, .pdf (or paste JD text).</p>
        <div className={styles.row}>
          <button type="button" className="lk-button" onClick={() => void runPrefill()} disabled={loading}>
            {loading ? 'Prefilling...' : 'Prefill from JD'}
          </button>
          <button type="button" className="lk-button" onClick={startNew}>
            New Draft
          </button>
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

          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Role Title</span>
              <input
                value={finalConfig.role_title}
                onChange={(e) => setFinalConfig((prev) => ({ ...prev, role_title: e.target.value }))}
                placeholder="Role title"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Experience Level</span>
              <select value={finalConfig.level} onChange={(e) => onLevelChange(e.target.value as PositionConfigCore['level'])}>
                {LEVELS.map((v) => (
                  <option key={v} value={v}>
                    {humanize(v)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={styles.grid3}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Duration (Minutes)</span>
              <select
                value={finalConfig.duration_minutes}
                onChange={(e) => setFinalConfig((prev) => ({ ...prev, duration_minutes: Number(e.target.value) as PositionConfigCore['duration_minutes'] }))}
              >
                {DURATIONS.map((v) => (
                  <option key={v} value={v}>
                    {v} minutes
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Deep Dive Mode</span>
              <select
                value={finalConfig.deep_dive_mode}
                onChange={(e) => setFinalConfig((prev) => ({ ...prev, deep_dive_mode: e.target.value as PositionConfigCore['deep_dive_mode'] }))}
              >
                {DEEP_DIVE_MODES.map((v) => (
                  <option key={v} value={v}>
                    {DEEP_DIVE_LABELS[v] || humanize(v)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Assessment Strictness</span>
              <select value={finalConfig.strictness} onChange={(e) => setFinalConfig((prev) => ({ ...prev, strictness: e.target.value as PositionConfigCore['strictness'] }))}>
                {STRICTNESS_LEVELS.map((v) => (
                  <option key={v} value={v}>
                    {STRICTNESS_LABELS[v] || humanize(v)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Evaluation Policy</span>
              <select
                value={finalConfig.evaluation_policy}
                onChange={(e) => setFinalConfig((prev) => ({ ...prev, evaluation_policy: e.target.value as PositionConfigCore['evaluation_policy'] }))}
              >
                {EVALUATION_POLICIES.map((v) => (
                  <option key={v} value={v}>
                    {EVALUATION_POLICY_LABELS[v] || humanize(v)}
                  </option>
                ))}
              </select>
            </label>
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
            suggestions={FOCUS_AREAS.map((f) => humanize(f))}
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

export default function NewPositionPage() {
  return (
    <React.Suspense fallback={<main className={styles.main}>Loading...</main>}>
      <NewPositionPageContent />
    </React.Suspense>
  );
}
