# Implementation Plan: Configurable Providers

## Overview

This plan implements a dynamic Provider Registry for RelayPlane proxy that loads custom LLM provider definitions from `~/.relayplane/config.json`. The implementation is broken into incremental steps: core interfaces and validation, model routing, format conversion, auth resolution, integration with existing systems, streaming support, hot-reload, and CLI/documentation updates. All code is TypeScript, tested with Vitest and `fast-check` for property-based tests.

## Tasks

- [x] 1. Set up core interfaces and configuration validator
  - [x] 1.1 Create `src/provider-registry.ts` with core interfaces and ProviderRegistry class
    - Define `CustomProviderConfig`, `ResolvedProvider`, `ModelRoute`, `ReloadResult` interfaces
    - Implement the `ProviderRegistry` class with `providers`, `modelRoutes`, `prefixRoutes`, and `inFlightCount` maps
    - Implement `load()` method that merges custom providers with built-in providers from `DEFAULT_ENDPOINTS` and `MODEL_MAPPING`
    - Implement `resolveModel()` with exact match first, then prefix-based routing
    - Implement `getProvider()`, `getProviderNames()`, `getModelNames()`
    - Implement `trackRequestStart()`, `trackRequestEnd()`, `hasInFlightRequests()` for in-flight tracking
    - _Requirements: 1.1, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 1.2 Create `src/config-validator.ts` with validation logic for custom providers
    - Implement `validateCustomProviders()` function returning `ValidationResult`
    - Validate required fields: `name`, `baseUrl`, `apiCompatibility`, `apiKeyEnvVar`
    - Validate `baseUrl` is a parseable URL via `new URL()`
    - Validate `apiCompatibility` is `'openai'` or `'anthropic'`
    - Generate warnings for name conflicts with built-in providers
    - Generate warnings for missing API key (env var not set, no `apiKeyValue`)
    - Log total number of valid custom providers loaded
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 1.3 Write property tests for ProviderRegistry loading
    - **Property 1: Provider loading completeness** — For any valid array of custom provider configs, every provider is retrievable by name after loading
    - **Property 5: Custom provider overrides built-in** — Custom provider with same name as built-in returns custom config
    - **Property 6: Model entry resolution** — String entries resolve as `{ provider, remoteModel: s }`, object entries resolve as `{ provider, remoteModel: r }`
    - **Property 7: Custom model overrides built-in mapping** — Custom model definitions take priority over MODEL_MAPPING
    - **Property 8: Prefix-based routing** — Models starting with prefix route to provider; others do not
    - Test file: `__tests__/provider-registry.property.test.ts`
    - **Validates: Requirements 1.1, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5**

  - [x] 1.4 Write property tests for ConfigValidator
    - **Property 2: Validation rejects invalid configurations** — Configs missing required fields or with invalid values are excluded from valid results with corresponding error entries
    - Test file: `__tests__/config-validator.property.test.ts`
    - **Validates: Requirements 1.2, 4.2, 4.3, 4.4**

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement authentication and format conversion
  - [x] 3.1 Create `src/auth-resolver.ts` with authentication header resolution
    - Implement `buildAuthHeaders()` function
    - Use custom `authHeader` if defined on provider
    - Default to `Authorization: Bearer <key>` for openai compatibility
    - Default to `x-api-key: <key>` for anthropic compatibility
    - Merge with provider's custom `headers` map
    - Resolve API key from `apiKeyValue` first, then fall back to `apiKeyEnvVar`
    - _Requirements: 1.3, 1.4, 3.5, 3.6, 3.7_

  - [x] 3.2 Create `src/format-converter.ts` with bidirectional format conversion
    - Extract existing OpenAI↔Anthropic conversion logic from `standalone-proxy.ts` into reusable module
    - Implement `convertRequestBody()` for request format conversion
    - Implement `convertResponseBody()` for non-streaming response conversion
    - Implement `convertStreamChunk()` for per-chunk SSE conversion
    - Implement `detectRequestFormat()` based on endpoint path (`/v1/chat/completions` → openai, `/v1/messages` → anthropic)
    - Handle passthrough when source and target formats match (no conversion)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 3.3 Write property tests for AuthResolver
    - **Property 12: Auth header matches provider configuration** — Outgoing auth header uses `authHeader` if defined, else `Authorization` for openai, else `x-api-key` for anthropic
    - Test file: `__tests__/auth-resolver.property.test.ts`
    - **Validates: Requirements 3.5, 3.6, 3.7**

  - [x] 3.4 Write property tests for FormatConverter
    - **Property 9: Format passthrough when compatible** — No conversion applied when request format matches provider apiCompatibility
    - **Property 10: OpenAI-to-Anthropic conversion produces valid structure** — Converted body has `messages` array (no system role), `model`, `max_tokens`, and optional `system` field
    - **Property 11: Anthropic-to-OpenAI conversion produces valid structure** — Converted body has `messages` array with system as role, and `model` field
    - Test file: `__tests__/format-converter.property.test.ts`
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

  - [x] 3.5 Write property test for API key resolution priority
    - **Property 3: API key resolution priority** — When both `apiKeyEnvVar` and `apiKeyValue` are defined, resolved key equals `apiKeyValue`
    - Test file: `__tests__/api-key-resolution.property.test.ts`
    - **Validates: Requirements 1.3**

  - [x] 3.6 Write property test for custom headers inclusion
    - **Property 4: Custom headers inclusion** — All entries in provider's `headers` map are present in outgoing request headers
    - Test file: `__tests__/custom-headers.property.test.ts`
    - **Validates: Requirements 1.4**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Integrate with existing proxy systems
  - [x] 5.1 Modify `src/standalone-proxy.ts` to use ProviderRegistry for request routing
    - Import and instantiate `ProviderRegistry` at startup
    - Load custom providers from config file (`~/.relayplane/config.json` → `customProviders` section)
    - Replace direct `DEFAULT_ENDPOINTS`/`MODEL_MAPPING` lookups with `registry.resolveModel()` calls
    - Use `buildAuthHeaders()` for outgoing request authentication
    - Use `convertRequestBody()` / `convertResponseBody()` for format handling
    - Log total custom providers loaded at startup (Req 4.6)
    - Log provider list in verbose mode (Req 7.3)
    - _Requirements: 1.1, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.6, 7.3_

  - [x] 5.2 Wire ProviderRegistry into circuit breaker, cooldown, and cascade systems
    - Create a `CircuitBreaker` instance per custom provider, keyed by provider name
    - Add custom providers to `CooldownManager` health map
    - Allow custom provider names in `crossProviderCascade.providers` array
    - Include custom provider name in `CostRecord` entries with custom rates (`costPer1kInput`, `costPer1kOutput`)
    - Apply rate limiting to custom providers when configured
    - Include provider name in agent tracking, routing logs, and telemetry
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 5.3 Write property test for cost calculation
    - **Property 13: Cost calculation with custom rates** — Estimated cost equals `(inputTokens / 1000) * costPer1kInput + (outputTokens / 1000) * costPer1kOutput`
    - Test file: `__tests__/cost-calculation.property.test.ts`
    - **Validates: Requirements 5.3**

  - [x] 5.4 Write unit tests for proxy integration
    - Test circuit breaker trips after consecutive failures to custom provider
    - Test cross-provider cascade includes custom providers
    - Test rate limiting applied to custom providers
    - Test cooldown applied after failures
    - Test telemetry records include custom provider name
    - _Requirements: 5.1, 5.4, 5.5, 5.6, 5.7_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement streaming support for custom providers
  - [x] 7.1 Extend streaming logic in `src/streaming.ts` to handle custom providers
    - Forward OpenAI SSE format (`data: {...}\n\n`) for openai-compatible custom providers
    - Forward Anthropic SSE format (`event: ...\ndata: {...}\n\n`) for anthropic-compatible custom providers
    - Apply per-chunk format conversion via `convertStreamChunk()` when cross-format streaming is needed
    - Maintain streaming flow without buffering entire response
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 7.2 Write unit tests for streaming with custom providers
    - Test streaming passthrough for OpenAI-compatible providers
    - Test streaming passthrough for Anthropic-compatible providers
    - Test per-chunk conversion in cross-format streaming
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 8. Implement hot-reload endpoint
  - [x] 8.1 Add `POST /v1/admin/reload-providers` endpoint to `src/standalone-proxy.ts`
    - Re-read `customProviders` section from config file
    - Call `registry.reload()` to compute diff (added, removed, unchanged)
    - Preserve active connections via in-flight reference counting
    - Stop routing new requests to removed providers but allow in-flight completion
    - Return JSON response with `{ added, removed, unchanged, errors }`
    - Return 400 with validation errors if new config is invalid (preserve current state)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 8.2 Write property test for reload diff correctness
    - **Property 14: Reload diff correctness** — `added` lists names in after but not before, `removed` lists names in before but not after, `unchanged` lists names in both
    - Test file: `__tests__/reload-diff.property.test.ts`
    - **Validates: Requirements 8.1, 8.4**

  - [x] 8.3 Write integration tests for hot-reload
    - Test reload preserves in-flight requests
    - Test removed provider allows in-flight completion
    - Test invalid config returns 400 and preserves current state
    - _Requirements: 8.2, 8.3_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Update CLI and documentation
  - [x] 10.1 Update `relayplane init` in `src/cli.ts` to include commented-out `customProviders` example
    - Modify the init command to include a commented example in generated config
    - Example should show one OpenAI-compatible and one Anthropic-compatible provider
    - _Requirements: 7.2_

  - [x] 10.2 Add error handling for missing API key at request time
    - Return 401 with clear error message identifying the provider and missing key
    - Include guidance on setting the environment variable or adding `apiKeyValue`
    - Handle format conversion failures with 500 and error details
    - _Requirements: 1.3, 4.5_

  - [x] 10.3 Update README documentation with `customProviders` configuration example
    - Add a section showing at least one OpenAI-compatible and one Anthropic-compatible provider example
    - Document all available fields and their behavior
    - _Requirements: 7.1_

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using `fast-check` with Vitest
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript throughout, matching the existing codebase
- `fast-check` is already a devDependency in `package.json`
- Existing test files use `__tests__/*.property.test.ts` naming convention for property tests
- Several source files already exist (`src/provider-registry.ts`, `src/config-validator.ts`, `src/auth-resolver.ts`, `src/format-converter.ts`) — tasks may involve modifying rather than creating from scratch

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "3.1", "3.2"] },
    { "id": 2, "tasks": ["3.3", "3.4", "3.5", "3.6"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["5.2", "7.1"] },
    { "id": 5, "tasks": ["5.3", "5.4", "7.2"] },
    { "id": 6, "tasks": ["8.1"] },
    { "id": 7, "tasks": ["8.2", "8.3", "10.1", "10.2", "10.3"] }
  ]
}
```
