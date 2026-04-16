require('dotenv').config()
const axios = require('axios');

class LLMEngine {
  constructor(config) {
    this.config = config;
  }

  async generateReply(prompt, userId) {
    const mode = process.env.LLM_MODE;
    //  || this.config.llm?.mode || 'ollama';

    try {
      if (mode === 'ollama') {
        return await this.callOllama(prompt);
      } else if (mode === 'gemini') {
        return await this.callGemini(prompt);
      } else if (mode === 'openai') {
        return await this.callOpenAI(prompt);
      }
      throw new Error(`Unknown LLM mode: ${mode}`);
    } catch (err) {
      return this.fallback(prompt, err);
    }
  }

  async callOllama(prompt) {
    const url = process.env.OLLAMA_URL 
    // || "http://localhost:11434"
    const model = process.env.OLLAMA_MODEL 
    // || "sorc/qwen3.5-instruct:4b"

    const response = await axios.post(`${url}/api/generate`, {
      model,
      prompt,
      stream: false
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 9999999
    });

    return response.data.response || response.data.message?.content;
  }

  async callGemini(prompt) {
    const apiKey = process.env.GEMINI_API_KEY || this.config.llm?.geminiKey;
    const model = process.env.GEMINI_MODEL || this.config.llm?.geminiModel || 'gemini-2.0-flash';

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500
        }
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 600000
      }
    );

    return response.data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
  }

  async callOpenAI(prompt) {
    const apiKey = process.env.OPENAI_API_KEY || this.config.llm?.openaiKey;
    const model = process.env.OPENAI_MODEL || this.config.llm?.openaiModel || 'gpt-4o-mini';

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    return response.data.choices[0].message.content;
  }

  async fallback(prompt, err) {
    const mode = process.env.LLM_MODE || this.config.llm?.mode;
    const primaryMode = mode || 'ollama';

    if (primaryMode === 'ollama') {
      if (this.config.llm?.geminiKey || process.env.GEMINI_API_KEY) {
        console.log('🔄 Falling back to Gemini...');
        return await this.callGemini(prompt);
      }
      if (this.config.llm?.openaiKey || process.env.OPENAI_API_KEY) {
        console.log('🔄 Falling back to OpenAI...');
        return await this.callOpenAI(prompt);
      }
    }

    if (primaryMode === 'gemini') {
      if (this.config.llm?.openaiKey || process.env.OPENAI_API_KEY) {
        console.log('🔄 Falling back to OpenAI...');
        return await this.callOpenAI(prompt);
      }
    }

    console.error('❌ All LLM fallbacks failed:', err.message);
    throw err;
  }
}

module.exports = LLMEngine;