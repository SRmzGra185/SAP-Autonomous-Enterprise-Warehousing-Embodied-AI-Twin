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

export const config = Object.freeze({
  environment: process.env.NODE_ENV || "development",
  production,
  host: process.env.HOST || "127.0.0.1",
  port,
  appOrigins: list(process.env.APP_ORIGINS, [`http://127.0.0.1:${port}`, `http://localhost:${port}`]),
  bodyLimitBytes: integer("BODY_LIMIT_BYTES", 262144, 1024, 1048576),
  rateLimit: { windowMs: integer("RATE_LIMIT_WINDOW_MS", 60000, 1000, 3600000), max: integer("RATE_LIMIT_MAX", 120, 1, 10000), agentMax: integer("AGENT_RATE_LIMIT_MAX", 15, 1, 120) },
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
    enabled: process.env.OPENAI_ENABLED === "true",
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    primaryModel: process.env.ORCHESTRATOR_MODEL || "gpt-5.6-sol",
    fallbackModel: process.env.FALLBACK_MODEL || "gpt-5.5-pro",
    reasoningEffort: process.env.ORCHESTRATOR_REASONING || "xhigh",
    maxTokens: integer("ORCHESTRATOR_MAX_TOKENS", 2400, 256, 16000),
    maxSteps: integer("ORCHESTRATOR_MAX_STEPS", 8, 1, 32),
    maxDelegations: integer("ORCHESTRATOR_MAX_DELEGATIONS", 4, 1, 12),
    pollMs: integer("OPENAI_POLL_MS", 1000, 250, 10000),
    timeoutMs: integer("OPENAI_TIMEOUT_MS", 120000, 5000, 600000),
    promptCachePrefix: process.env.PROMPT_CACHE_PREFIX || "sap:embodied-ai:orchestration:v1"
  }
});

export function assertSecureConfiguration() {
  if (!config.appOrigins.length) throw new Error("APP_ORIGINS must contain at least one trusted application origin.");
  if (!["desktop", "oidc"].includes(config.auth.mode)) throw new Error("AUTH_MODE must be desktop or oidc.");
  if ((config.production || config.auth.mode === "oidc") && (!config.auth.issuer || !config.auth.audience)) throw new Error("OIDC_ISSUER and OIDC_AUDIENCE are required for production/OIDC mode.");
  if (config.production && config.auth.mode !== "oidc") throw new Error("Production requires AUTH_MODE=oidc.");
  if (config.orchestrator.enabled && !config.orchestrator.apiKey) throw new Error("OPENAI_API_KEY is required when OPENAI_ENABLED=true.");
}

export function publicConfig() { return { environment: config.environment, authMode: config.auth.mode, trustedOrigins: config.appOrigins, orchestratorEnabled: config.orchestrator.enabled, productionWrites: false }; }
