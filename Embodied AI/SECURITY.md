# Security Configuration

## Defaults

- The server binds to `127.0.0.1` and uses loopback-only desktop identity by default.
- Production writes and live tenant access are always denied by the demo policy.
- CORS accepts only origins listed in `APP_ORIGINS`; wildcard CORS is not used.
- Requests receive CSP, frame-denial, MIME-sniffing, referrer, and permissions headers.
- JSON inputs are size-limited and schema-validated.
- Rate limits are applied per tenant and user, or per IP before authentication.

## Authentication

Desktop mode is for the local demonstration only. Production startup fails unless `AUTH_MODE=oidc`, `OIDC_ISSUER`, and `OIDC_AUDIENCE` are configured.

The OIDC verifier supports signed RS256 JWTs, issuer/audience/expiry validation, JWKS discovery and caching, tenant claims, and role claims. It is compatible with established OIDC platforms such as Microsoft Entra ID, Auth0, Okta, and Keycloak when those providers issue the required claims.

For a production browser deployment, use the provider's Authorization Code + PKCE client or an identity-aware reverse proxy to obtain access tokens. Do not place client secrets or API keys in browser code.

## Row-level security

Every model node is stamped with `tenantId`, `ownerId`, and `visibility`. Reads filter inaccessible nodes and remove edges whose endpoints are hidden. Writes reject cross-tenant rows, viewer roles, and unauthorized edits to private rows. Jobs and audit records are also tenant-scoped.

This is an in-memory enforcement layer for the demo. A production database must repeat the policy in the database itself—for example PostgreSQL RLS policies—so an application-layer defect cannot expose rows.

## Secrets and environment variables

Copy `.env.example` to `.env`. The `.gitignore` excludes `.env`. In production, inject secrets from a managed vault or workload identity instead of a file. Sensitive values include API keys, identity-provider administration credentials, connector certificates, and database credentials. None are stored in this repository.

## Orchestrator safety

The Responses API route uses background mode, a hashed per-user `safety_identifier`, bounded output tokens, a stable tenant cache key, and explicit prompt cache breakpoints. Provider safety responses are detected from response/error codes.

When a safeguard triggers, the fallback receives a safe-review prompt instead of the original execution request. This preserves the safeguard instead of attempting to evade it.

## Remaining production work

- Add database-native RLS and encrypted persistence.
- Complete provider-specific PKCE login/logout UI.
- Move secrets to a managed secret service.
- Add CSRF protection if cookie sessions are introduced.
- Add mTLS or a private connector tunnel for industrial adapters.
- Add centralized audit retention, SIEM export, data residency controls, and key rotation.
- Run dependency, SAST, DAST, penetration, and threat-model reviews before enabling any real connector.
