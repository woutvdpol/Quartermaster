# Security-backlog

Bevindingen uit de eigen auth-implementatie en reviews. Afvinken vóór livegang.

| # | Punt | Status |
|---|---|---|
| 1 | AES-GCM accepteerde ingekorte auth-tags (vervalsing mogelijk) | ✅ opgelost (`authTagLength: 16`) |
| 2 | TOTP: per-sessie-limiet omzeilbaar door nieuwe pending sessie | ✅ opgelost (extra limiet per gebruiker, 15/uur) |
| 3 | Uitgeschakelde gebruiker in TOTP-stap | ✅ gedekt: `getSession()` verwerpt sessies van `disabledAt`-gebruikers |
| 4 | Per-IP-limiet vertrouwt `x-forwarded-for` | ✅ opgelost: centrale `src/server/request-meta.ts`, env `TRUSTED_PROXY_HOPS` (0 = negeren, N = N-de van rechts; k8s/ingress-nginx: 1) |
| 5 | Lock-out van echte gebruiker na 5 foute pogingen | ✅ opgelost: exponentiële backoff per account + per IP, geen enumeratie (`rate-limit.ts` `attempt`) |
| 6 | Rate-limit check-then-insert niet atomair | ✅ opgelost: transactie met `pg_advisory_xact_lock`; concurrency-tests (`tests/integration/rate-limit.int.test.ts`) |
| 7 | Herstelcodes: SHA-256, ~49 bits, lichte modulo-bias | ✅ opgelost: 18 tekens ≈ 89 bits, rejection sampling, HMAC-SHA256 (sleutel via HKDF uit `APP_ENCRYPTION_KEY`); oude codes blijven werken tot gebruik |
| 8 | Wachtwoord-reset-endpoint: gelijke respons en timing | ✅ opgelost: request zet altijd één job `auth.password-reset.request` in de pg-boss-queue; lookup/token/mail in de worker |
| 9 | `?next=` na login: open redirect | ✅ geverifieerd (admin + shop), tests `src/lib/admin-nav.test.ts` |
| 10 | `x-qm-host` uit `Host`, niet `X-Forwarded-Host` | ✅ bewust: alleen `Host` (Next laat client-XFH door); upload-routes lazen XFH → nu `isSameOrigin` |
| 11 | Tenant-isolatie alleen in service-laag | ✅ tweede laag: `tenantDb()` Prisma-extension (`src/server/tenant-scope.ts`) + isolatietests; grenzen in `04-security-review.md` |
| 12 | Security-review vóór livegang | ✅ uitgevoerd → `04-security-review.md`; R1 opgelost; open: R2 (CSP) e.a. |
| 13 | Gastorders/adressen koppelen bij registratie of e-mailwijziging zonder verificatie (review R1) | ✅ opgelost: koppelen pas na verificatie of reset (`customer-auth/link.ts`); ETL-aanbeveling in `04-security-review.md` |
| 14 | Content-Security-Policy op HTML-pagina's (review R2) | 🟡 geïmplementeerd, draait report-only: nonce + `'strict-dynamic'` via `src/proxy.ts` (`src/lib/csp.ts`), env `CSP_MODE` (`report-only`/`enforce`/`off`), rapporten via `/api/csp-report` in de log. Open: na een rustige periode `CSP_MODE=enforce` (zie `04-security-review.md` R2) |
