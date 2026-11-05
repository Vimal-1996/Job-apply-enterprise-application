# Job-apply-enterprise-application

Application code for the Job-apply platform (NestJS API + React web).
Infrastructure lives in the separate `Job-apply-infrastructure` repo.

- `apps/api` – NestJS API (Cognito JWT validation, RBAC)
- `apps/web` – React SPA (OIDC code + PKCE)
- `packages/` – shared types and clients
- `db/migrations/` – versioned DB migrations
