// Type-only aliases for the Gemini SDK, so runtime .js modules reference these instead of the SDK
// (gate2b3a-guard forbids the SDK specifier in api/**/*.js outside the authorized adapters).
import type { Part, GenerateContentRequest, GenerativeModel } from '@google/generative-ai';

export type GeminiPrompt = string | (string | Part)[] | GenerateContentRequest;
export type GeminiGenerateContent = GenerativeModel['generateContent'];
