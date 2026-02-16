function roleFamilyAlias(roleFamily) {
  const key = String(roleFamily || '').trim().toLowerCase();
  if (key.includes('machine') || key.includes('ml') || key.includes('ai')) return 'ml';
  if (key.includes('backend')) return 'backend';
  if (key.includes('frontend') || key.includes('front_end')) return 'frontend';
  return 'full_stack';
}

const BANK = {
  full_stack: {
    behavioral: [
      'Tell me about a project where you had to align frontend and backend teams under tight deadlines. What did you do and what did you learn?',
      'Describe a time when a production issue required you to coordinate across services. What was your STAR-L breakdown?'
    ],
    technical_validation: [
      'Walk me through how you would design and implement a resilient API endpoint with validation, observability, and rollback strategy.',
      'Describe a real feature you shipped end-to-end and explain key architecture and tradeoff decisions.'
    ],
    deep_dive: [
      'Pick one high-impact production incident you handled. Explain root cause analysis, mitigation, and long-term fixes with metrics.',
      'How would you redesign one bottleneck in your recent stack for scale and reliability?'
    ],
    wrapup: [
      'Before we close, what would you improve first in your current architecture and why?',
    ],
  },
  backend: {
    behavioral: [
      'Tell me about a time you improved reliability of a backend service under pressure. What did you learn?',
    ],
    technical_validation: [
      'Explain how you would build an idempotent, observable backend workflow with retries and dead-letter handling.',
      'Describe how you optimize a slow query path in production while minimizing risk.'
    ],
    deep_dive: [
      'Walk through a service design you built: storage choice, consistency tradeoffs, and failure handling.',
    ],
    wrapup: ['Any backend design decision you would revisit now and why?'],
  },
  frontend: {
    behavioral: [
      'Tell me about a time you handled conflicting UX and engineering constraints. What did you do?',
    ],
    technical_validation: [
      'Explain how you would structure a large React feature for maintainability, performance, and testability.',
      'Describe your approach to frontend observability and production debugging.'
    ],
    deep_dive: [
      'Walk through a performance optimization you shipped and how you validated impact.',
    ],
    wrapup: ['What frontend quality or architecture improvement would you prioritize next?'],
  },
  ml: {
    behavioral: [
      'Tell me about an ML project where outcomes did not match expectations. What did you change and what did you learn?',
    ],
    technical_validation: [
      'Walk through an end-to-end ML system you built, from data preparation to deployment and monitoring, including tradeoffs.',
      'How do you evaluate and productionize an LLM or agentic workflow while managing risk and cost?'
    ],
    deep_dive: [
      'Describe a production ML failure you handled and the long-term guardrails you implemented.',
      'How would you design model drift detection and retraining strategy for a business-critical model?'
    ],
    wrapup: ['What would you improve first in your current MLOps lifecycle and why?'],
  },
};

function pickFrom(list, indexSeed = 0) {
  if (!Array.isArray(list) || list.length === 0) return '';
  const idx = Math.abs(Number(indexSeed || 0)) % list.length;
  return list[idx];
}

function buildFallbackQuestion({ roleFamily, section, askedQuestions, uncoveredMustHaves = [] }) {
  const family = roleFamilyAlias(roleFamily);
  const bank = BANK[family] || BANK.full_stack;

  const intent = section === 'intro'
    ? 'behavioral'
    : section === 'wrap_up'
      ? 'wrapup'
      : section === 'deep_dive'
        ? 'deep_dive'
        : 'technical_validation';

  let question = pickFrom(bank[intent], askedQuestions);
  if (!question) {
    question = 'Please share a concrete STAR-L example from your recent work with technical decisions and outcomes.';
  }

  const mustTarget = uncoveredMustHaves.slice(0, 2);
  if (mustTarget.length > 0 && (intent === 'technical_validation' || intent === 'deep_dive')) {
    question = `${question} Please anchor your answer around ${mustTarget.join(' and ')}.`;
  }

  return {
    question,
    question_intent: intent,
    expected_answer_format:
      intent === 'behavioral' ? 'STAR-L' : intent === 'technical_validation' ? 'steps+tradeoffs' : intent === 'wrapup' ? 'short_fact' : 'walkthrough',
    probes: [
      'Can you quantify impact and outcome?',
      'What tradeoffs did you consider?',
      'What would you improve next time?'
    ],
    must_haves_targeted: mustTarget,
    timebox_seconds: intent === 'wrapup' ? 45 : 120,
    rationale: 'deterministic_fallback',
    end_interview: intent === 'wrapup' && askedQuestions >= 12,
  };
}

module.exports = {
  buildFallbackQuestion,
};
