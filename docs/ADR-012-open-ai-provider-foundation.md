# ADR 012: Open AI Provider Foundation

## Status
Accepted

## Context
AccesDirectAide was initially coupled tightly to the `@google/generative-ai` SDK and the Vercel AI SDK, utilizing generic Zod schema bridges. This violated the project's principle of AI Provider Independence (Constitution IV). We need to support open-weight, locally hosted models for absolute data privacy and cost-efficiency without losing structured outputs or tool calling.

## Decision
We implemented a minimal, provider-neutral `ModelProvider` abstraction mapping strictly to Zod schemas via `zod-to-json-schema`. 
- **No Vercel AI SDK**: We avoided Vercel AI SDK (Option B selected) to retain maximum control over the `FoundationSafetyContract`.
- **Primary Runtime**: Node 22 (LTS) ESM.
- **Provider Support**: Integrated `GeminiProvider` (hosted fallback) and `OllamaProvider` (local primary).

## Model Provenance (Phase 6B Candidates)

### Candidate 1: Qwen
- **MODEL:** Qwen 3 (qwen3:8b)
- **OLLAMA TAG:** qwen3:8b
- **PARAMETERS:** 8.2B
- **QUANTIZATION:** Q4_K_M
- **MODEL SIZE:** 5.2 GB
- **CONTEXT:** 40,960
- **WEIGHT LICENCE:** Apache 2.0
- **TOOL CALLING:** Supported natively
- **STRUCTURED OUTPUT:** Supported natively
- **FRENCH/MULTILINGUAL SUPPORT:** Excellent
- **OFFICIAL SOURCE:** Ollama Registry / HuggingFace
- **INSPECTED DATE:** 2026-09-02

### Candidate 2: Ministral
- **MODEL:** Ministral 3 (ministral-3:8b-instruct-2512-q4_K_M)
- **OLLAMA TAG:** ministral-3:8b-instruct-2512-q4_K_M
- **PARAMETERS:** 8.9B
- **QUANTIZATION:** Q4_K_M
- **MODEL SIZE:** 6.0 GB
- **CONTEXT:** 262,144
- **WEIGHT LICENCE:** Apache 2.0 (Open Weights)
- **TOOL CALLING:** Supported natively
- **STRUCTURED OUTPUT:** Supported natively
- **FRENCH/MULTILINGUAL SUPPORT:** Excellent (Native French optimization)
- **OFFICIAL SOURCE:** Ollama Registry / Mistral AI
- **INSPECTED DATE:** 2026-09-02

*Note: Historical candidates `qwen2.5:7b` and `mistral-7b` were superseded by these newer tags in the environment.*

## Consequences
- **Positive**: We can hot-swap AI providers dynamically with no code changes. Structural errors are strictly trapped by Zod.
- **Negative**: Local inference (e.g., via Mac Mini M4) introduces a latency penalty compared to hosted models (average ~25s vs ~2s for complex parsing).
