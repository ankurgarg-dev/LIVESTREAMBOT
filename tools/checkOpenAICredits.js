#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function readEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const out = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function getApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const root = path.resolve(__dirname, '..');
  const envLocal = readEnvFile(path.join(root, '.env.local'));
  if (envLocal.OPENAI_API_KEY) return envLocal.OPENAI_API_KEY;
  const env = readEnvFile(path.join(root, '.env'));
  if (env.OPENAI_API_KEY) return env.OPENAI_API_KEY;
  return '';
}

async function getCreditGrants(apiKey) {
  const res = await fetch('https://api.openai.com/v1/dashboard/billing/credit_grants', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    return { ok: false, status: res.status, body: await res.text() };
  }

  const json = await res.json();
  const total = Number(json.total_granted || 0);
  const used = Number(json.total_used || 0);
  const available = Number(json.total_available || total - used || 0);
  return {
    ok: true,
    total,
    used,
    available,
  };
}

async function probeQuota(apiKey, model) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: 'ping',
      max_output_tokens: 16,
    }),
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (res.ok) {
    return { status: 'has_credits', detail: 'Tiny request succeeded.' };
  }

  const errorCode = json?.error?.code || '';
  const errorType = json?.error?.type || '';
  const message = json?.error?.message || `HTTP ${res.status}`;

  if (errorCode === 'insufficient_quota' || errorType === 'insufficient_quota') {
    return { status: 'no_credits', detail: message };
  }

  return {
    status: 'unknown',
    detail: `${message}${errorCode ? ` (code: ${errorCode})` : ''}`,
  };
}

async function main() {
  const apiKey = getApiKey();
  const args = process.argv.slice(2);
  const probeOnly = args.includes('--probe-only');
  const modelArg = args.find((x) => !x.startsWith('--'));
  const model = modelArg || process.env.OPENAI_CREDIT_CHECK_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    console.error('OPENAI_API_KEY not found in env, .env.local, or .env');
    process.exit(2);
  }

  try {
    if (!probeOnly) {
      const billing = await getCreditGrants(apiKey);
      if (billing.ok) {
        console.log('status: billing_endpoint_available');
        console.log(`total_granted_usd: ${billing.total.toFixed(4)}`);
        console.log(`total_used_usd: ${billing.used.toFixed(4)}`);
        console.log(`total_available_usd: ${billing.available.toFixed(4)}`);
        console.log(`has_credits: ${billing.available > 0 ? 'yes' : 'no'}`);
        process.exit(0);
      }

      const probe = await probeQuota(apiKey, model);
      console.log('status: billing_endpoint_unavailable');
      console.log(`billing_http_status: ${billing.status}`);
      console.log(`quota_probe_model: ${model}`);
      console.log(`quota_probe_result: ${probe.status}`);
      console.log(`detail: ${probe.detail}`);
      process.exit(probe.status === 'unknown' ? 1 : 0);
    }

    const probe = await probeQuota(apiKey, model);
    console.log('status: probe_only');
    console.log(`quota_probe_model: ${model}`);
    console.log(`quota_probe_result: ${probe.status}`);
    console.log(`detail: ${probe.detail}`);
    process.exit(probe.status === 'unknown' ? 1 : 0);
  } catch (err) {
    console.error(`check_failed: ${err?.message || String(err)}`);
    process.exit(1);
  }
}

main();
