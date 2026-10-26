import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { parseReply } from '../reply';

/** Cheapest Gemini model with a free tier at the time of writing; override with GEMINI_MODEL. */
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

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

/** Shape of {add, update} that buildPrompt asks for. */
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
  },
  required: ['add', 'update'],
};

export async function sortWithGemini(prompt: string, apiKey: string, model = process.env.GEMINI_MODEL || DEFAULT_MODEL) {
  // GEMINI_BASE_URL is only for pointing tests at a local stand-in.
  const baseUrl = process.env.GEMINI_BASE_URL;
  const ai = new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
  const res = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: 'application/json', responseJsonSchema: RESPONSE_SCHEMA },
  });
  return parseReply(res.text);
}
