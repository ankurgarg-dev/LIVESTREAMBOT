function int16ArrayFromBufferLE(buffer) {
  const samples = Math.floor(buffer.length / 2);
  const out = new Int16Array(samples);
  for (let i = 0; i < samples; i += 1) {
    out[i] = buffer.readInt16LE(i * 2);
  }
  return out;
}

function int16ArrayToBufferLE(int16) {
  const out = Buffer.alloc(int16.length * 2);
  for (let i = 0; i < int16.length; i += 1) {
    out.writeInt16LE(int16[i], i * 2);
  }
  return out;
}

function resampleInt16Mono(input, inRate, outRate) {
  if (inRate === outRate || input.length === 0) return input;

  const ratio = inRate / outRate;
  const outLength = Math.max(1, Math.floor(input.length * (outRate / inRate)));
  const out = new Int16Array(outLength);

  for (let i = 0; i < outLength; i += 1) {
    const srcPos = i * ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;

    const s1 = input[idx] ?? input[input.length - 1];
    const s2 = input[idx + 1] ?? s1;
    out[i] = Math.round(s1 + (s2 - s1) * frac);
  }

  return out;
}

class TTSService {
  constructor({ apiKey, model = 'gpt-4o-mini-tts', voice = 'coral', inSampleRate = 24000, outSampleRate = 48000 }) {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }

    this.apiKey = apiKey;
    this.model = model;
    this.voice = voice;
    this.inSampleRate = inSampleRate;
    this.outSampleRate = outSampleRate;
  }

  async *streamPcm48kForText(text) {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        voice: this.voice,
        input: text,
        response_format: 'pcm',
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`TTS request failed (${response.status}): ${errText}`);
    }

    if (!response.body) {
      throw new Error('TTS response did not include a stream body');
    }

    const reader = response.body.getReader();
    let pendingByte = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      let chunk = Buffer.from(value);
      if (pendingByte !== null) {
        chunk = Buffer.concat([Buffer.from([pendingByte]), chunk]);
        pendingByte = null;
      }

      if (chunk.length % 2 === 1) {
        pendingByte = chunk[chunk.length - 1];
        chunk = chunk.subarray(0, chunk.length - 1);
      }

      if (chunk.length === 0) continue;

      const inSamples = int16ArrayFromBufferLE(chunk);
      const outSamples = resampleInt16Mono(inSamples, this.inSampleRate, this.outSampleRate);
      yield int16ArrayToBufferLE(outSamples);
    }
  }

  static _splitAtBoundary(textBuffer) {
    const match = textBuffer.match(/[.!?\n]/);
    if (!match || match.index === undefined) {
      return null;
    }

    const idx = match.index;
    const left = textBuffer.slice(0, idx + 1).trim();
    const right = textBuffer.slice(idx + 1);
    if (!left) return { sentence: null, rest: right };
    return { sentence: left, rest: right };
  }

  async *streamFromLlmText(llmDeltaStream) {
    let textBuffer = '';

    for await (const delta of llmDeltaStream) {
      textBuffer += delta;

      while (true) {
        const split = TTSService._splitAtBoundary(textBuffer);
        if (!split) break;
        textBuffer = split.rest;
        if (!split.sentence) continue;

        yield* this.streamPcm48kForText(split.sentence);
      }
    }

    const finalText = textBuffer.trim();
    if (finalText) {
      yield* this.streamPcm48kForText(finalText);
    }
  }
}

module.exports = {
  TTSService,
  resampleInt16Mono,
};
