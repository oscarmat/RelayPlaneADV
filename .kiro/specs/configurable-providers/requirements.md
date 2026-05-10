# Requirements Document

## Introduction

Esta funcionalidad permite a los usuarios de RelayPlaneADV añadir nuevos proveedores de LLM compatibles con las APIs de OpenAI o Anthropic mediante configuración en `~/.relayplane/config.json`, sin necesidad de modificar el código fuente del proxy. Actualmente, los proveedores están definidos de forma estática en `DEFAULT_ENDPOINTS` y `MODEL_MAPPING` dentro de `standalone-proxy.ts`. Esta mejora introduce un registro dinámico de proveedores que se carga desde la configuración, permitiendo al usuario definir la URL base, la variable de entorno para la API key, el tipo de API compatible (OpenAI o Anthropic), y los modelos disponibles en cada proveedor.

## Glossary

- **Proxy**: La instancia de RelayPlaneADV que intercepta y enruta peticiones LLM.
- **Provider_Registry**: El módulo que mantiene la lista de proveedores disponibles (tanto los built-in como los definidos por el usuario).
- **Custom_Provider**: Un proveedor definido por el usuario en la configuración, no incluido en los proveedores built-in del proxy.
- **API_Compatibility_Type**: El tipo de API que expone un proveedor; puede ser `openai` (compatible con `/v1/chat/completions`) o `anthropic` (compatible con `/v1/messages`).
- **Provider_Config**: La sección del archivo de configuración donde se definen los proveedores personalizados.
- **Model_Entry**: Una entrada que asocia un nombre de modelo con un proveedor y opcionalmente un nombre de modelo remoto diferente.
- **Config_Validator**: El componente que valida la estructura y coherencia de la configuración de proveedores al iniciar el proxy.
- **Built_In_Provider**: Un proveedor incluido de fábrica en el proxy (anthropic, openai, google, xai, openrouter, deepseek, groq, mistral, together, fireworks, perplexity, ollama).

## Requirements

### Requirement 1: Definición de proveedores personalizados en configuración

**User Story:** Como usuario del proxy, quiero definir nuevos proveedores LLM en mi archivo de configuración, para poder usar servicios compatibles con OpenAI o Anthropic sin esperar a que se añadan al código.

#### Acceptance Criteria

1. WHEN a `customProviders` section is present in the configuration file, THE Provider_Registry SHALL load each entry as an available provider at proxy startup.
2. THE Provider_Config SHALL require the following fields for each Custom_Provider: `name` (unique string identifier), `baseUrl` (HTTPS endpoint), `apiCompatibility` (either `openai` or `anthropic`), and `apiKeyEnvVar` (name of the environment variable containing the API key).
3. WHEN a Custom_Provider defines an optional `apiKeyValue` field, THE Provider_Registry SHALL use that value directly instead of reading from the environment variable.
4. WHEN a Custom_Provider defines an optional `headers` map, THE Proxy SHALL include those headers in every request forwarded to that provider.
5. IF a Custom_Provider `name` conflicts with a Built_In_Provider name, THEN THE Config_Validator SHALL log a warning and the Custom_Provider definition SHALL override the built-in configuration for that provider.

### Requirement 2: Mapeo de modelos a proveedores personalizados

**User Story:** Como usuario del proxy, quiero asociar nombres de modelos a mis proveedores personalizados, para que el proxy sepa a qué proveedor enviar cada petición según el modelo solicitado.

#### Acceptance Criteria

1. WHEN a Custom_Provider includes a `models` array, THE Provider_Registry SHALL register each model name as routable to that provider.
2. WHEN a model entry in the `models` array is a string, THE Proxy SHALL use that string as both el nombre local y el nombre remoto del modelo.
3. WHEN a model entry is an object with `name` and `remoteModel` fields, THE Proxy SHALL route requests for `name` to the provider using `remoteModel` as the model identifier in the upstream request.
4. IF a model name defined in a Custom_Provider conflicts with an existing model in MODEL_MAPPING, THEN THE Provider_Registry SHALL give priority to the Custom_Provider definition.
5. THE Provider_Registry SHALL support a `modelPrefix` field in the Custom_Provider that, when set, causes all models with that prefix to route to the provider without requiring explicit model listing.

### Requirement 3: Compatibilidad con formato de API

**User Story:** Como usuario del proxy, quiero que el proxy adapte automáticamente el formato de las peticiones según el tipo de API del proveedor destino, para no tener que preocuparme por las diferencias entre OpenAI y Anthropic.

#### Acceptance Criteria

1. WHEN the incoming request uses OpenAI format (`/v1/chat/completions`) and the target Custom_Provider has `apiCompatibility` set to `openai`, THE Proxy SHALL forward the request body without format conversion.
2. WHEN the incoming request uses Anthropic format (`/v1/messages`) and the target Custom_Provider has `apiCompatibility` set to `anthropic`, THE Proxy SHALL forward the request body without format conversion.
3. WHEN the incoming request uses OpenAI format and the target Custom_Provider has `apiCompatibility` set to `anthropic`, THE Proxy SHALL convert the request from OpenAI chat completion format to Anthropic messages format before forwarding.
4. WHEN the incoming request uses Anthropic format and the target Custom_Provider has `apiCompatibility` set to `openai`, THE Proxy SHALL convert the request from Anthropic messages format to OpenAI chat completion format before forwarding.
5. WHEN the target Custom_Provider has `apiCompatibility` set to `openai`, THE Proxy SHALL send the API key using the `Authorization: Bearer <key>` header.
6. WHEN the target Custom_Provider has `apiCompatibility` set to `anthropic`, THE Proxy SHALL send the API key using the `x-api-key: <key>` header.
7. WHEN a Custom_Provider defines an optional `authHeader` field, THE Proxy SHALL use that custom header name instead of the default for the API compatibility type.

### Requirement 4: Validación de configuración de proveedores

**User Story:** Como usuario del proxy, quiero que el proxy valide mi configuración de proveedores al iniciar, para detectar errores antes de que causen fallos en tiempo de ejecución.

#### Acceptance Criteria

1. WHEN the proxy starts, THE Config_Validator SHALL validate all entries in the `customProviders` section before accepting requests.
2. IF a Custom_Provider entry is missing any required field (`name`, `baseUrl`, `apiCompatibility`, `apiKeyEnvVar`), THEN THE Config_Validator SHALL log an error message identifying the missing field and skip that provider.
3. IF a Custom_Provider `apiCompatibility` value is not `openai` or `anthropic`, THEN THE Config_Validator SHALL log an error and skip that provider.
4. IF a Custom_Provider `baseUrl` is not a valid URL, THEN THE Config_Validator SHALL log an error and skip that provider.
5. WHEN a Custom_Provider passes validation but its API key environment variable is not set and no `apiKeyValue` is provided, THE Config_Validator SHALL log a warning indicating the provider will not be usable until the key is configured.
6. THE Config_Validator SHALL report the total number of custom providers loaded successfully at startup via the standard log output.

### Requirement 5: Integración con funcionalidades existentes del proxy

**User Story:** Como usuario del proxy, quiero que mis proveedores personalizados funcionen con todas las características existentes del proxy (circuit breaker, cost tracking, cascade, rate limiting), para tener la misma experiencia que con los proveedores built-in.

#### Acceptance Criteria

1. THE Proxy SHALL apply circuit breaker logic to Custom_Provider requests using the same rules as Built_In_Provider requests.
2. THE Proxy SHALL track costs for Custom_Provider requests using the provider name and model in telemetry records.
3. WHEN a Custom_Provider defines an optional `costPer1kInput` and `costPer1kOutput` field, THE Proxy SHALL use those values for cost estimation instead of the default zero-cost assumption.
4. THE Proxy SHALL include Custom_Providers in the cross-provider cascade fallback when they are listed in the `crossProviderCascade.providers` array.
5. THE Proxy SHALL apply rate limiting to Custom_Provider requests when rate limit configuration exists for that provider name.
6. THE Proxy SHALL apply cooldown logic to Custom_Providers using the same failure tracking as Built_In_Providers.
7. WHEN a Custom_Provider is used, THE Proxy SHALL include the provider name in dashboard telemetry, routing logs, and agent tracking records.

### Requirement 6: Soporte de streaming para proveedores personalizados

**User Story:** Como usuario del proxy, quiero que los proveedores personalizados soporten streaming (SSE), para poder usar modelos que devuelven respuestas incrementales.

#### Acceptance Criteria

1. WHEN the incoming request has `stream: true` and the target is a Custom_Provider with `apiCompatibility` set to `openai`, THE Proxy SHALL forward the streaming response using OpenAI SSE format (`data: {...}\n\n`).
2. WHEN the incoming request has `stream: true` and the target is a Custom_Provider with `apiCompatibility` set to `anthropic`, THE Proxy SHALL forward the streaming response using Anthropic SSE format (`event: ...\ndata: {...}\n\n`).
3. WHEN cross-format conversion is needed for a streaming request, THE Proxy SHALL convert each SSE chunk individually maintaining the streaming flow.

### Requirement 7: Ejemplo de configuración y documentación

**User Story:** Como usuario del proxy, quiero tener un ejemplo claro de cómo configurar un proveedor personalizado, para poder añadir nuevos proveedores sin dificultad.

#### Acceptance Criteria

1. THE Proxy SHALL include in its README documentation an example of the `customProviders` configuration section showing at least one OpenAI-compatible and one Anthropic-compatible provider.
2. WHEN the user runs `relayplane init`, THE Proxy SHALL include a commented-out `customProviders` example in the generated configuration file.
3. THE Proxy SHALL log the list of loaded custom providers (name and base URL) at startup when verbose mode is enabled.

### Requirement 8: Recarga de configuración de proveedores

**User Story:** Como usuario del proxy, quiero poder añadir o modificar proveedores sin reiniciar el proxy, para minimizar interrupciones en el servicio.

#### Acceptance Criteria

1. WHEN the user sends a `POST /v1/admin/reload-providers` request to the proxy, THE Provider_Registry SHALL re-read the `customProviders` section from the configuration file and update the provider list.
2. WHEN the configuration is reloaded, THE Provider_Registry SHALL preserve active connections and in-flight requests to providers that remain configured.
3. WHEN a provider is removed from configuration during reload, THE Provider_Registry SHALL stop routing new requests to that provider but allow in-flight requests to complete.
4. WHEN the reload completes, THE Proxy SHALL respond with a JSON object listing the providers added, removed, and unchanged.
