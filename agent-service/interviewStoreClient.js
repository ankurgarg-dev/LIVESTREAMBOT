const { readFile, writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');

const baseDir =
  process.env.INTERVIEW_DATA_DIR || path.join('/tmp', 'bristlecone-interviews');
const dbPath = path.join(baseDir, 'interviews.json');

async function ensureDir() {
  await mkdir(baseDir, { recursive: true });
}

async function readPayload() {
  await ensureDir();
  try {
    const raw = await readFile(dbPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.interviews)) {
      return { interviews: [] };
    }
    return parsed;
  } catch {
    return { interviews: [] };
  }
}

async function writePayload(payload) {
  await ensureDir();
  await writeFile(dbPath, JSON.stringify(payload, null, 2), 'utf8');
}

async function getInterviewByRoomName(roomName) {
  const payload = await readPayload();
  return (
    payload.interviews.find((entry) => entry.roomName === roomName) || null
  );
}

async function patchInterviewByRoomName(roomName, updates) {
  const payload = await readPayload();
  const idx = payload.interviews.findIndex((entry) => entry.roomName === roomName);
  if (idx < 0) return null;

  const current = payload.interviews[idx];
  const next = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  payload.interviews[idx] = next;
  await writePayload(payload);
  return next;
}

module.exports = {
  getInterviewByRoomName,
  patchInterviewByRoomName,
};

