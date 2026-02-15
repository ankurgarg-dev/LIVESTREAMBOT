const DEFAULT_AGENT_CONTROL_URL = 'http://127.0.0.1:8787/join';

export async function ensureAgentInRoom(roomName: string): Promise<void> {
  const targetRoom = String(roomName || '').trim();
  if (!targetRoom) return;

  const controlUrl = String(process.env.AGENT_CONTROL_URL || DEFAULT_AGENT_CONTROL_URL).trim();
  if (!controlUrl || controlUrl.toLowerCase() === 'disabled') return;

  const token = String(process.env.AGENT_CONTROL_TOKEN || '').trim();
  const timeoutMs = Math.max(500, Number(process.env.AGENT_CONTROL_TIMEOUT_MS || 3000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(controlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-agent-token': token } : {}),
      },
      body: JSON.stringify({ roomName: targetRoom }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Agent join request failed (${response.status}): ${body || response.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
