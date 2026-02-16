function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normTag(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

function extractResponsibilities(notes) {
  const lines = String(notes || '')
    .split(/\n+/g)
    .map((x) => x.trim())
    .filter(Boolean);
  return lines.slice(0, 8);
}

function deriveCvSignals(interview) {
  const cvName = String(interview?.cv?.originalName || '').toLowerCase();
  if (!cvName) return [];
  const signals = [];
  if (cvName.includes('ml') || cvName.includes('ai')) signals.push('ml_delivery');
  if (cvName.includes('lead') || cvName.includes('manager')) signals.push('leadership_scope');
  if (cvName.includes('platform') || cvName.includes('infra')) signals.push('platform_engineering');
  return signals;
}

function buildContextPack(interview) {
  const position = interview?.positionSnapshot || {};
  const mustHaves = toArray(position.must_haves).map(normTag).filter(Boolean);
  const focusAreas = toArray(position.focus_areas).map(normTag).filter(Boolean);
  const responsibilities = extractResponsibilities(position.notes_for_interviewer || interview?.notes);
  const cvSignals = deriveCvSignals(interview);

  return {
    role_title: String(position.role_title || interview?.jobTitle || 'Software Engineer'),
    role_family: String(position.role_family || 'full_stack'),
    level: String(position.level || 'mid'),
    interview_round_type: String(position.interview_round_type || 'standard'),
    must_haves: mustHaves,
    focus_areas: focusAreas,
    responsibilities,
    cv_signals: cvSignals,
    candidate_name: String(interview?.candidateName || 'Candidate'),
    interviewer_name: String(interview?.interviewerName || 'Interviewer'),
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  buildContextPack,
};
