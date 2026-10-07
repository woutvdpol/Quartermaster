# Security-backlog

Bevindingen uit de eigen auth-implementatie en reviews. Afvinken vóór livegang.

| # | Punt | Status |
|---|---|---|
| 1 | AES-GCM accepteerde ingekorte auth-tags (vervalsing mogelijk) | ✅ opgelost (`authTagLength: 16`) |
| 2 | TOTP: per-sessie-limiet omzeilbaar door nieuwe pending sessie | ✅ opgelost (extra limiet per gebruiker, 15/uur) |
| 3 | Uitgeschakelde gebruiker in TOTP-stap | ✅ gedekt: `getSession()` verwerpt sessies van `disabledAt`-gebruikers |
| 4 | Per-IP-limiet vertrouwt `x-forwarded-for` | ⏳ bij Kubernetes-ingress: alleen vertrouwen achter proxy die header overschrijft (`TRUSTED_PROXY`-instelling) |
| 5 | Lock-out van echte gebruiker na 5 foute pogingen | ⏳ vervangen door exponentiële backoff |
| 6 | Rate-limit check-then-insert niet atomair | ⏳ telling + insert in één transactie / advisory lock |
| 7 | Herstelcodes: SHA-256, ~49 bits, lichte modulo-bias | ⏳ rejection sampling + HMAC met server-secret |
| 8 | Wachtwoord-reset-endpoint: gelijke respons en timing | ⏳ mail asynchroon via job-queue versturen |
| 9 | `?next=` na login: open redirect | ⏳ alleen relatieve `/admin`-paden (opdracht aan admin-UI) — verifiëren |
| 10 | `x-qm-host` uit `Host`, niet `X-Forwarded-Host` | ⏳ bij ingress configureren |
| 11 | Tenant-isolatie alleen in service-laag | ⏳ Prisma-extension die `tenantId` afdwingt + tests |
| 12 | Security-review vóór livegang | ⏳ |
