const OpenAI = require('openai');

const DEFAULT_SYSTEM_PROMPT =
  'You are a concise, natural-sounding AI assistant in a live video meeting. Keep responses short and conversational. Avoid markdown, lists, or emojis.';

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

    const stream = await this._createChatCompletion({
      model: this.model,
      messages: this._messages(runtimeInstruction),
      temperature: 0.6,
      stream: true,
    });

    let assistantText = '';

    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (!delta) continue;
      assistantText += delta;
      yield delta;
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
