const integer = (name, fallback, min, max) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
};

const list = (value, fallback = []) => {
  const entries = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  return entries.length ? entries : fallback;
};

const port = integer("PORT", 4173, 1024, 65535);
const production = process.env.NODE_ENV === "production";
const aicoreBound = Boolean(process.env.AICORE_SERVICE_KEY) || /"label"\s*:\s*"aicore"/.test(process.env.VCAP_SERVICES || "");
const llmProvider = process.env.LLM_PROVIDER || (aicoreBound ? "aicore" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock");

export const config = Object.freeze({
  environment: process.env.NODE_ENV || "development",
  production,
  host: process.env.HOST || "127.0.0.1",
  port,
  appOrigins: list(process.env.APP_ORIGINS, [`http://127.0.0.1:${port}`, `http://localhost:${port}`]),
  bodyLimitBytes: integer("BODY_LIMIT_BYTES", 262144, 1024, 1048576),
  rateLimit: { windowMs: integer("RATE_LIMIT_WINDOW_MS", 60000, 1000, 3600000), max: integer("RATE_LIMIT_MAX", 120, 1, 10000), agentMax: integer("AGENT_RATE_LIMIT_MAX", 15, 1, 120) },
  // Isaac Sim executor bridge: shared secret sent as x-isaac-token by the executor (never stored in the repo).
  isaac: { token: process.env.ISAAC_TOKEN || "", claimTimeoutMs: integer("ISAAC_CLAIM_TIMEOUT_MS", 10000, 1000, 120000), eventTimeoutMs: integer("ISAAC_EVENT_TIMEOUT_MS", 60000, 5000, 600000), executorTtlMs: integer("ISAAC_EXECUTOR_TTL_MS", 15000, 3000, 120000) },
  auth: {
    mode: process.env.AUTH_MODE || "desktop",
    issuer: process.env.OIDC_ISSUER || "",
    audience: process.env.OIDC_AUDIENCE || "",
    tenantClaim: process.env.OIDC_TENANT_CLAIM || "tid",
    roleClaim: process.env.OIDC_ROLE_CLAIM || "roles",
    desktopTenant: process.env.DESKTOP_TENANT_ID || "sap-embodied-ai-demo",
    desktopUser: process.env.DESKTOP_USER_ID || "desktop-owner",
    desktopRole: process.env.DESKTOP_ROLE || "admin",
    jwksTtlMs: integer("OIDC_JWKS_TTL_MS", 300000, 30000, 3600000)
  },
  orchestrator: {
    // Joule runs on SAP AI Core (Generative AI Hub) when an `aicore` binding or AICORE_SERVICE_KEY is present;
    // otherwise the operations API keeps the local deterministic planner.
    provider: llmProvider,
    enabled: llmProvider !== "mock" && process.env.LLM_ENABLED !== "false",
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    baseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    resourceGroup: process.env.AICORE_RESOURCE_GROUP || "default",
    primaryModel: process.env.ORCHESTRATOR_MODEL || (llmProvider === "aicore" ? "anthropic--claude-4.8-opus" : "anthropic--claude-4.7-opus"),
    fallbackModel: process.env.FALLBACK_MODEL || (llmProvider === "aicore" ? "anthropic--claude-4.6-sonnet" : process.env.ORCHESTRATOR_MODEL || "anthropic--claude-4.7-opus"),
    effort: process.env.ORCHESTRATOR_EFFORT || "high",
    thinking: process.env.ORCHESTRATOR_THINKING !== "off",
    maxTokens: integer("ORCHESTRATOR_MAX_TOKENS", 2400, 256, 16000),
    maxSteps: integer("ORCHESTRATOR_MAX_STEPS", 8, 1, 32),
    maxDelegations: integer("ORCHESTRATOR_MAX_DELEGATIONS", 4, 1, 12),
    timeoutMs: integer("LLM_TIMEOUT_MS", 120000, 5000, 600000),
    promptCachePrefix: process.env.PROMPT_CACHE_PREFIX || "sap:embodied-ai:orchestration:v2"
  }
});

export function assertSecureConfiguration() {
  if (!config.appOrigins.length) throw new Error("APP_ORIGINS must contain at least one trusted application origin.");
  if (!["desktop", "oidc"].includes(config.auth.mode)) throw new Error("AUTH_MODE must be desktop or oidc.");
  if ((config.production || config.auth.mode === "oidc") && (!config.auth.issuer || !config.auth.audience)) throw new Error("OIDC_ISSUER and OIDC_AUDIENCE are required for production/OIDC mode.");
  if (config.production && config.auth.mode !== "oidc") throw new Error("Production requires AUTH_MODE=oidc.");
  if (!["aicore", "anthropic", "mock"].includes(config.orchestrator.provider)) throw new Error("LLM_PROVIDER must be aicore, anthropic or mock.");
  if (config.orchestrator.enabled && config.orchestrator.provider === "anthropic" && !config.orchestrator.apiKey) throw new Error("ANTHROPIC_API_KEY is required for LLM_PROVIDER=anthropic.");
  if (config.orchestrator.enabled && config.orchestrator.provider === "aicore" && !aicoreBound) throw new Error("LLM_PROVIDER=aicore requires an aicore service binding or AICORE_SERVICE_KEY.");
  if (!["low", "medium", "high", "xhigh", "max"].includes(config.orchestrator.effort)) throw new Error("ORCHESTRATOR_EFFORT must be low, medium, high, xhigh or max.");
}

export function publicConfig() { return { environment: config.environment, authMode: config.auth.mode, trustedOrigins: config.appOrigins, orchestratorEnabled: config.orchestrator.enabled, productionWrites: false }; }
