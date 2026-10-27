import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { parseReply } from '../reply';

/**
 * Free-tier Flash-Lite models, fastest first. Checked against a free-tier key in Oct 2026:
 * 3.1 Flash-Lite answered in 1.5-8 s (4-8 s with a full task list); 3.5 Flash-Lite was often overloaded (503) or took ~19 s;
 * 2.5 Flash-Lite is closed to new accounts (404). Override with GEMINI_MODEL, comma-separated.
 */
export const DEFAULT_MODELS = 'gemini-3.1-flash-lite,gemini-flash-lite-latest';
const PER_MODEL_MS = 12000;
const TOTAL_MS = 24000;

const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] });
const fields = {
  title: { type: 'string' },
  priority: { type: 'integer', minimum: 1, maximum: 3 },
  minutes: { type: 'integer', minimum: 15, maximum: 480 },
  date: { ...nullable('string'), description: 'YYYY-MM-DD' },
  time: { ...nullable('string'), description: 'HH:MM, 24-hour' },
  deadline: { type: 'boolean' },
  notes: { type: 'string' },
};

/** Shape of {add, update, reply} that buildPrompt asks for. */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    add: {
      type: 'array',
      items: { type: 'object', properties: fields, required: ['title', 'priority', 'minutes', 'date', 'time', 'deadline', 'notes'] },
    },
    update: {
      type: 'array',
      items: {
        type: 'object',
        properties: { ref: { type: 'string' }, ...fields, done: { type: 'boolean' }, unschedule: { type: 'boolean' } },
        required: ['ref'],
      },
    },
    reply: { type: 'string' },
  },
  required: ['add', 'update', 'reply'],
};

/**
 * Ask each model in turn until one answers within the time budget. A busy model (429/503) gets one
 * quick retry first, since free-tier spikes are short. Bad requests (400) aren't retried.
 */
export async function sortWithGemini(prompt: string, apiKey: string, models = process.env.GEMINI_MODEL || DEFAULT_MODELS) {
  // GEMINI_BASE_URL is only for pointing tests at a local stand-in.
  const baseUrl = process.env.GEMINI_BASE_URL;
  const ai = new GoogleGenAI({ apiKey, httpOptions: { ...(baseUrl ? { baseUrl } : {}), retryOptions: { attempts: 1 } } });
  const deadline = Date.now() + TOTAL_MS;
  let lastError: unknown = null;
  const attempts = models.split(',').map(m => m.trim()).filter(Boolean).map(model => ({ model, retried: false }));
  for (let i = 0; i < attempts.length; i++) {
    const { model } = attempts[i];
    const left = deadline - Date.now();
    if (left < 1500) break;
    try {
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: RESPONSE_SCHEMA,
          abortSignal: AbortSignal.timeout(Math.min(PER_MODEL_MS, left)),
        },
      });
      return parseReply(res.text);
    } catch (e) {
      lastError = e;
      const status = (e as { status?: number }).status;
      if (status === 400) throw e;
      if ((status === 429 || status === 503) && !attempts[i].retried) {
        attempts[i].retried = true;
        i--;
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      console.warn(`gemini ${model} failed, trying the next model:`, e instanceof Error ? e.message.slice(0, 160) : e);
    }
  }
  throw lastError ?? new Error('No Gemini model answered in time');
}
