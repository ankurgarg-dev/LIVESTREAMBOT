const OpenAI = require('openai');
const { getDefaultLlmSystemPrompt } = require('./promptTemplates');

const DEFAULT_SYSTEM_PROMPT = getDefaultLlmSystemPrompt();

class LLMService {
  constructor({
    apiKey,
    model = 'gpt-4o-mini',
    fallbackModel = '',
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    maxTurns = 10,
  }) {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }

    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.fallbackModel = String(fallbackModel || '').trim();
    this.systemPrompt = systemPrompt;
    this.maxTurns = maxTurns;
    this.history = [];
  }

  _messages(runtimeInstruction = '') {
    const extra = runtimeInstruction && runtimeInstruction.trim()
      ? [{ role: 'system', content: runtimeInstruction.trim() }]
      : [];
    return [{ role: 'system', content: this.systemPrompt }, ...extra, ...this.history];
  }

  _trimHistory() {
    const maxMessages = this.maxTurns * 2;
    if (this.history.length > maxMessages) {
      this.history = this.history.slice(this.history.length - maxMessages);
    }
  }

  async _createChatCompletion(params) {
    try {
      return await this.client.chat.completions.create(params);
    } catch (error) {
      const fallback = this.fallbackModel;
      if (!fallback || fallback === params.model) throw error;
      console.warn(`[llm] primary model '${params.model}' failed, retrying with fallback '${fallback}'`);
      this.model = fallback;
      return this.client.chat.completions.create({ ...params, model: fallback });
    }
  }

  async *streamAssistantReply(userText, options = {}) {
    const runtimeInstruction = String(options.runtimeInstruction || '');
    if (!userText || !userText.trim()) {
      return;
    }

    this.history.push({ role: 'user', content: userText.trim() });
    this._trimHistory();

    const streamIdleTimeoutMs = Math.max(2000, Number(process.env.LLM_STREAM_IDLE_TIMEOUT_MS || 12000));
    const streamMaxDurationMs = Math.max(streamIdleTimeoutMs, Number(process.env.LLM_STREAM_MAX_DURATION_MS || 90000));
    const stream = await this._createChatCompletion({
      model: this.model,
      messages: this._messages(runtimeInstruction),
      temperature: 0.6,
      stream: true,
    });

    let assistantText = '';
    let streamTimedOut = false;
    const startedAt = Date.now();
    const iterator = stream[Symbol.asyncIterator]();

    while (true) {
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = streamMaxDurationMs - elapsedMs;
      if (remainingMs <= 0) {
        streamTimedOut = true;
        console.warn(`[llm] stream exceeded max duration (${streamMaxDurationMs}ms), aborting`);
        break;
      }

      let idleTimer = null;
      try {
        const nextResult = await Promise.race([
          iterator.next(),
          new Promise((_, reject) => {
            idleTimer = setTimeout(
              () => reject(new Error(`LLM stream idle timeout after ${streamIdleTimeoutMs}ms`)),
              Math.min(streamIdleTimeoutMs, remainingMs),
            );
          }),
        ]);

        if (idleTimer) clearTimeout(idleTimer);
        if (nextResult?.done) break;

        const chunk = nextResult?.value;
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (!delta) continue;
        assistantText += delta;
        yield delta;
      } catch (error) {
        if (idleTimer) clearTimeout(idleTimer);
        streamTimedOut = true;
        console.warn('[llm] stream aborted due to timeout/error:', error?.message || error);
        break;
      }
    }

    // Some providers/models can complete a streamed response with no text deltas,
    // or can stall mid-stream. Fall back to a non-stream turn to avoid silent replies.
    if (!assistantText.trim() || streamTimedOut) {
      const fallback = await this._createChatCompletion({
        model: this.model,
        messages: this._messages(runtimeInstruction),
        temperature: 0.6,
        stream: false,
      });
      const fallbackText = String(fallback?.choices?.[0]?.message?.content || '').trim();
      if (fallbackText) {
        if (!assistantText.trim()) {
          assistantText = fallbackText;
          yield fallbackText;
        } else {
          const remaining = fallbackText.replace(assistantText, '').trim();
          if (remaining) {
            assistantText = `${assistantText} ${remaining}`.trim();
            yield remaining;
          }
        }
      }
    }

    this.history.push({ role: 'assistant', content: assistantText.trim() });
    this._trimHistory();
  }

  async callText(prompt, options = {}) {
    const model = options.model || this.model;
    const response = await this._createChatCompletion({
      model,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: String(prompt || '') },
      ],
      temperature: options.temperature ?? 0.2,
      stream: false,
    });
    return String(response?.choices?.[0]?.message?.content || '').trim();
  }

  async callJson(prompt, options = {}) {
    const parse = (text) => {
      const raw = String(text || '').trim();
      const normalized = raw.startsWith('```')
        ? raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
        : raw;
      return JSON.parse(normalized);
    };

    const text = await this.callText(prompt, options);
    try {
      return parse(text);
    } catch {
      const fixPrompt = [
        'Fix this into valid JSON only. No markdown, no commentary.',
        'Input:',
        text,
      ].join('\n');
      const fixedText = await this.callText(fixPrompt, options);
      return parse(fixedText);
    }
  }
}

module.exports = {
  LLMService,
  DEFAULT_SYSTEM_PROMPT,
};
