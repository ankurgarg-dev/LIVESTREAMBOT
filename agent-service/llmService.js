const OpenAI = require('openai');

const DEFAULT_SYSTEM_PROMPT =
  'You are a concise, natural-sounding AI assistant in a live video meeting. Keep responses short and conversational. Avoid markdown, lists, or emojis.';

class LLMService {
  constructor({ apiKey, model = 'gpt-4o-mini', systemPrompt = DEFAULT_SYSTEM_PROMPT, maxTurns = 10 }) {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }

    this.client = new OpenAI({ apiKey });
    this.model = model;
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

  async *streamAssistantReply(userText, options = {}) {
    const runtimeInstruction = String(options.runtimeInstruction || '');
    if (!userText || !userText.trim()) {
      return;
    }

    this.history.push({ role: 'user', content: userText.trim() });
    this._trimHistory();

    const stream = await this.client.chat.completions.create({
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
}

module.exports = {
  LLMService,
  DEFAULT_SYSTEM_PROMPT,
};
