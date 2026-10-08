# Deploy — Kubernetes

Productie-inrichting van Quartermaster op een generiek Kubernetes-cluster (besluit: generieke manifests, provider later). Alles staat in `deploy/k8s/` (Kustomize, `kubectl` ≥ 1.27 volstaat).

## Inhoud

1. [Architectuur](#1-architectuur)
2. [Bestanden](#2-bestanden)
3. [Images bouwen](#3-images-bouwen)
4. [Clustervoorwaarden](#4-clustervoorwaarden)
5. [Configuratie (env vars)](#5-configuratie-env-vars)
6. [Eerste deploy](#6-eerste-deploy)
7. [Rollouts & rollback](#7-rollouts--rollback)
8. [Migraties](#8-migraties)
9. [Proxy-, IP- en Host-contract](#9-proxy--ip--en-host-contract)
10. [Uploads-opslag](#10-uploads-opslag)
11. [Schalen](#11-schalen)
12. [Postgres](#12-postgres)
13. [Backups & restore](#13-backups--restore)
14. [Cron](#14-cron)
15. [DNS per tenant-domein & TLS](#15-dns-per-tenant-domein--tls)
16. [E2E-smoketests](#16-e2e-smoketests)
17. [Cutover vanaf Concept500](#17-cutover-vanaf-concept500)
18. [Go-live-checklist](#18-go-live-checklist)
19. [Open beslissingen](#19-open-beslissingen)

---

## 1. Architectuur

```
                        Internet (klanten, Mollie-webhooks, beheerders)
                                          │  DNS: platform-host + elk tenant-domein → LB-IP
                                          ▼
                         ┌──────────────────────────────────┐
                         │ Cloud load balancer (L4)          │  externalTrafficPolicy: Local
                         └──────────────────────────────────┘  (behoudt client-IP)
                                          │
  namespace ingress-nginx  ┌──────────────▼───────────────┐    cert-manager (Let's Encrypt)
                           │ ingress-nginx controller      │◄── Certificate per host / wildcard
                           │ TLS, 26m body, XFF overschrijven│
                           └──────────────┬───────────────┘
                                          │ Host ongewijzigd, X-Forwarded-For = 1 adres
  namespace quartermaster                 ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ Service quartermaster-web :80 ──► Deployment quartermaster-web (≥2 pods)  │
   │                                     Next.js standalone :3000, UID 1001     │
   │                                     /api/health (liveness)                 │
   │                                     /api/ready  (readiness, SELECT 1)      │
   │                                                                            │
   │ Deployment quartermaster-worker (1+) pg-boss: mail, PDF's, nieuwsbrief,    │
   │                                     alerts, cron-schedules                 │
   │ Job quartermaster-migrate           prisma migrate deploy (vóór elke rollout)│
   │ CronJob quartermaster-backup        pg_dump → PVC (+ rclone → S3)          │
   │                                                                            │
   │ PVC quartermaster-uploads (RWX) ◄── web + worker + backup                  │
   │ PVC quartermaster-backups (RWO) ◄── backup                                 │
   └───────────────┬──────────────────────────────────────────┬────────────────┘
                   ▼                                          ▼
     Managed Postgres 18 (aanbevolen)             Uitgaand: Mollie API, SMTP,
     of StatefulSet (components/postgres-in-cluster)  Turnstile, ECB, Matomo, S3
```

Eén installatie bedient alle tenants: de app bepaalt de tenant op basis van de `Host`-header (`src/server/tenant.ts`); `PLATFORM_HOST` is de superadmin-host. Alle state staat in Postgres en het uploads-volume, dus web-pods zijn vervangbaar.

## 2. Bestanden

| Pad | Inhoud |
|---|---|
| `deploy/k8s/base/` | Omgevings-onafhankelijke basis: web, worker, migrate-Job, Service, Ingress, PDB, PVC's, ConfigMap, backup-CronJob, NetworkPolicies, ServiceAccount |
| `deploy/k8s/overlays/production/` | Managed Postgres, RWX-uploads, 2 web-replica's, eigen hosts |
| `deploy/k8s/overlays/staging/` | In-cluster Postgres, RWO-uploads op één node, 1 replica, LE-staging-certificaten |
| `deploy/k8s/components/uploads-rwo` | Alles op één node met een ReadWriteOnce-volume (zie §10) |
| `deploy/k8s/components/hpa` | CPU-autoscaling voor web (alleen met RWX) |
| `deploy/k8s/components/external-cron` | Cron via Kubernetes-CronJobs i.p.v. de worker (zie §14) |
| `deploy/k8s/components/postgres-in-cluster` | Eenvoudige Postgres 18-StatefulSet (zie §12) |
| `deploy/k8s/secrets/secret.example.yaml` | Sjabloon van alle Secrets (nooit echte waarden committen) |
| `deploy/k8s/ingress-nginx/values.yaml` | Helm-values voor de controller (forwarded headers, HSTS, client-IP) |
| `deploy/k8s/ingress-nginx/cluster-issuers.yaml` | cert-manager ClusterIssuers (prod + staging) |
| `deploy/k8s/jobs/etl.job.example.yaml` | Voorbeeld-Job voor de Concept500-import |
| `deploy/k8s/rollout.sh` | Rollout-script: infra → migraties → app → wachten |

Renderen/valideren zonder cluster: `kubectl kustomize deploy/k8s/overlays/production`. CI rendert beide overlays en valideert ze met kubeconform (job `k8s`).

## 3. Images bouwen

Eén `Dockerfile`, drie targets — bouw ze uit dezelfde commit en tag ze gelijk (bijv. de git-SHA):

```bash
SHA=$(git rev-parse --short HEAD); REG=ghcr.io/<org>
docker build --build-arg NEXT_DEPLOYMENT_ID=$SHA \
  --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=<publieke site key> \
  --build-arg NEXT_COMPRESS=false \
  -t $REG/quartermaster:$SHA .
docker build --target worker  -t $REG/quartermaster-worker:$SHA .
docker build --target migrate -t $REG/quartermaster-migrate:$SHA .
docker push … (alle drie)
```

| Target | Inhoud | Gebruikt door |
|---|---|---|
| `runner` (default) | Next.js standalone, ~335 MB, `node server.js` | Deployment web |
| `worker` | Volledige dependency-tree + `src/` + `scripts/`, `tsx scripts/worker.ts` | Deployment worker |
| `migrate` | Idem, `prisma migrate deploy`; kan ook `prisma db seed` en `npm run etl` | Job migrate, ETL-Job |

Belangrijk:

- **Turnstile site key is runtime-config.** De shop leest `TURNSTILE_SITE_KEY` uit de pod-omgeving (ConfigMap) en geeft hem door aan de widget; één image werkt dus voor elke omgeving. De build-arg `NEXT_PUBLIC_TURNSTILE_SITE_KEY` blijft alleen als fallback. Zonder key toont de shop geen widget en weigert productie élk beschermd formulier (registreren, wachtwoord vergeten, nieuwsbrief, bod, alert, inkoop/verkoop).
- `NEXT_DEPLOYMENT_ID` activeert Next.js version-skew-bescherming: browsers met een oude build doen tijdens een rolling update een harde reload in plaats van een onbekende server action aan te roepen. Optioneel, wel aanbevolen.
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is niet nodig: de key wordt bij de build gegenereerd en in het image opgeslagen, en alle pods draaien hetzelfde image. Pas nodig als je per omgeving opnieuw zou bouwen (doe dat niet — promoot tags).
- Alle targets draaien als UID/GID 1001 (`nextjs`), zodat het gedeelde uploads-volume één eigenaar heeft. Ze werken met een read-only root-filesystem (alleen `/tmp`, `/app/.next/cache` en `/app/uploads` schrijfbaar).
- `next build` haalt Google Fonts op (`next/font/google`); de build heeft dus internet nodig en faalt bij een netwerkstoring naar `fonts.gstatic.com` — gewoon opnieuw bouwen.
- `HEALTHCHECK` in de Dockerfile geldt alleen voor Docker/Compose; Kubernetes gebruikt de probes.

## 4. Clustervoorwaarden

Eenmalig per cluster:

1. **Ingress-controller**: ingress-nginx met `deploy/k8s/ingress-nginx/values.yaml` (namespace `ingress-nginx` — de NetworkPolicy verwacht die naam).
   > Let op: het upstream Kubernetes-project *ingress-nginx* is in maart 2026 met pensioen gegaan (geen nieuwe releases/security-fixes meer). De manifests gebruiken alleen standaard-Ingress plus een handvol `nginx.ingress.kubernetes.io/*`-annotaties; bij een andere controller (bijv. de door de provider beheerde ingress, Traefik of een Gateway API-implementatie) moeten die annotaties (body-size 26m, buffering uit, forwarded headers) vertaald worden. Zie §19.
2. **cert-manager** (Helm) + `kubectl apply -f deploy/k8s/ingress-nginx/cluster-issuers.yaml` (e-mailadres invullen).
3. **CNI met NetworkPolicy-ondersteuning** (Cilium, Calico, …). Zonder zulke CNI worden de policies stil genegeerd.
4. **StorageClass met ReadWriteMany** voor productie-uploads (zie §10), anders `components/uploads-rwo`.
5. **metrics-server** — alleen voor `components/hpa`.
6. Namespaces krijgen Pod Security `restricted`; alle pods voldoen daaraan.

## 5. Configuratie (env vars)

Alles is runtime-config (behalve de build-args hierboven); één image gaat door alle omgevingen. Volledige lijst van wat de code leest (`grep process.env` over `src/` en `scripts/`):

| Variabele | Waar | Verplicht | Toelichting |
|---|---|---|---|
| `DATABASE_URL` | Secret | ja | node-postgres/libpq-URL; managed: `?sslmode=require`. Ook gebruikt door pg_dump (geen Prisma-only parameters). |
| `DATABASE_POOL_MAX` | ConfigMap | nee (default 10) | Maximaal aantal DB-verbindingen per proces (node-postgres-pool, `src/server/db.ts`). Houd replica's × waarde + worker + migrate-Job onder `max_connections` van Postgres (managed: vaak 25–100). Ongeldige waarde → default + waarschuwing in de log. |
| `APP_ENCRYPTION_KEY` | Secret | ja | 32 bytes base64. Versleutelt TOTP-secrets, Mollie-credentials, signeert tokens. **Nooit zomaar roteren** — bestaande data wordt onleesbaar. |
| `SMTP_URL` | Secret | ja (prod) | `smtps://user:pass@host:465`. Zonder: mailjobs falen en blijven retryen (bewust, mail wordt nooit stil weggegooid). |
| `TURNSTILE_SECRET_KEY` | Secret | ja (prod) | Leeg = beschermde formulieren geweigerd in productie. |
| `CRON_SECRET` | Secret | alleen met external-cron | ≥ 16 tekens; leeg = `/api/cron/*` uit. |
| `MATOMO_TOKEN` | Secret | nee | Alleen naar `MATOMO_URL` gestuurd. |
| `PLATFORM_HOST` | ConfigMap | ja | Superadmin-host, bijv. `platform.example.nl` (zonder schema; met poort alleen als die in de URL staat). |
| `APP_URL` | ConfigMap | ja | `https://<platform-host>`; basis voor maillinks zonder shopdomein en voor de Mollie-webhook-URL. |
| `SHOP_SUBDOMAIN_BASE` | ConfigMap | ja (onboarding) | Basis-host voor platform-subdomeinen van nieuwe shops: bij goedkeuring van een aanmelding krijgt de shop `<slug>.<SHOP_SUBDOMAIN_BASE>` als primair domein, bijv. `quartermaster.nl` → `dealer.quartermaster.nl`. Zonder schema, met poort alleen in dev. Default (dev) `localhost:3000` → `<slug>.localhost:3000` (browsers resolven `*.localhost` naar 127.0.0.1). Vereist wildcard-DNS + wildcard-certificaat, zie §15. |
| `MAIL_FROM_FALLBACK` | ConfigMap | ja | Afzender; moet door SPF/DKIM van de SMTP-provider gedekt zijn. |
| `TRUSTED_PROXY_HOPS` | ConfigMap | ja (k8s: `1`) | Zie §9. |
| `CSP_MODE` | ConfigMap | nee (default `report-only`) | Content-Security-Policy: `report-only` (alleen melden, `[csp]`-regels in de log), `enforce` (blokkeren) of `off`. Per request gelezen; wijzigen = ConfigMap + pod-herstart. Zie `04-security-review.md` R2. |
| `NODE_ENV` | ConfigMap/image | — | `production`. |
| `STORAGE_DRIVER` | ConfigMap | — | `local` (enige driver). |
| `UPLOADS_DIR` | ConfigMap/image | — | `/app/uploads` (alias `UPLOAD_DIR`). |
| `WORKER_CRON` | ConfigMap | — | `1` = worker plant de cron-taken; `0` met external-cron. |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | ConfigMap | — | 25000; `terminationGracePeriodSeconds` (40) moet erboven liggen. |
| `JOBS_LOG_CRON` | ConfigMap | — | `1` logt ook elke cron-run. |
| `MOLLIE_WEBHOOK_BASE_URL` | ConfigMap | nee | Overschrijft `APP_URL` als webhook-basis. |
| `MATOMO_URL` | ConfigMap | nee | Matomo-basis-URL. |
| `BACKUP_RETENTION_DAYS` | ConfigMap | — | Bewaartermijn dumps op de backup-PVC. |
| `MAIL_OUTBOX_DIR` | — | nee | Alleen dev/test: mails als `.eml` wegschrijven. |
| `PORT`, `HOSTNAME`, `NODE_OPTIONS` | Deployment | — | Gezet in de manifests. |
| `TURNSTILE_SITE_KEY` | ConfigMap | ja (productie) | Publieke site key, runtime. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_DEPLOYMENT_ID` | **build-arg** | nee (fallback) / aanbevolen | Zie §3. |
| `NEXT_COMPRESS` | **build-arg** | `true` | `false` = Node comprimeert niet; alléén samen met brotli/gzip op de ingress (`deploy/k8s/ingress-nginx/values.yaml`). Voor docker-compose/bare `next start`: laten staan. Zie docs/perf/round2.md. |
| `DATABASE_URL_TEST`, `SEED_*` | — | — | Alleen tests/seeding, niet in productie. |
| `LEGACY_DATABASE_URL`, `LEGACY_CF_ACCOUNT_HASH` | Secret `quartermaster-etl` | alleen ETL | Zie §17. |

Mollie-API-keys staan **niet** in env: die beheert elke tenant zelf in de admin (versleuteld met `APP_ENCRYPTION_KEY`).

Secrets aanmaken (de manifests verwijzen er alleen naar; niets in `deploy/k8s` maakt ze aan):

```bash
# prod.secrets.env (staat in .gitignore via *.secrets.env) met KEY=waarde-regels, dan:
kubectl create namespace quartermaster   # of laat rollout.sh dat doen
kubectl -n quartermaster create secret generic quartermaster-secrets --from-env-file=prod.secrets.env
# optioneel: quartermaster-backup-offsite, quartermaster-postgres (staging), quartermaster-etl
```

Voor een team of GitOps: Sealed Secrets, External Secrets Operator of SOPS — de namen uit `secret.example.yaml` aanhouden.

## 6. Eerste deploy

1. Cluster voorbereiden (§4). DNS van de platform-host naar het LB-IP van ingress-nginx (§15).
2. Images bouwen en pushen (§3).
3. Overlay invullen: `images:` (registry), `PLATFORM_HOST`/`APP_URL`/`MAIL_FROM_FALLBACK`, `ingress-hosts.yaml`, RWX-storageClass voor uploads.
4. Namespace + Secrets aanmaken (§5).
5. `deploy/k8s/rollout.sh overlays/production <tag>` — maakt infra aan, draait de migraties, rolt web + worker uit en wacht tot alles ready is.
6. Eerste superadmin: er is nog geen los "maak superadmin"-commando. `prisma db seed` (image `migrate`, zelfde opzet als de migrate-Job met `command: ["prisma", "db", "seed"]` en `SEED_SUPERADMIN_*`/`SEED_OWNER_*` als env) maakt de superadmin, maar óók demo-tenants met `*.localhost`-domeinen — die daarna in de admin deactiveren/verwijderen, of eerst een apart seed-script laten bouwen (§19). Tenants zelf komen via de ETL (§17) of de admin.
7. Controle: `curl https://<platform-host>/api/health` en `/api/ready`, admin-login, `E2E_BASE_URL=https://<tenant-host> npm run e2e` (§16).

## 7. Rollouts & rollback

```bash
deploy/k8s/rollout.sh overlays/staging   <tag>    # eerst staging + e2e
deploy/k8s/rollout.sh overlays/production <tag>
DRY_RUN=1 deploy/k8s/rollout.sh overlays/production <tag>   # server-side dry-run
```

Het script (alleen `kubectl` nodig):

1. rendert de overlay (optioneel met een andere image-tag voor alle drie de images);
2. past infrastructuur toe (namespace, ConfigMap, NetworkPolicies, in-cluster Postgres) en controleert dat `quartermaster-secrets` bestaat;
3. verwijdert de vorige migrate-Job, maakt hem opnieuw aan en wacht; **bij een mislukte migratie stopt het, toont de logs en rolt de app niet uit**;
4. past de rest toe en wacht op `rollout status` van web en worker.

Rolling update van web: `maxSurge 1, maxUnavailable 0`; nieuwe pods krijgen pas verkeer als `/api/ready` slaagt. Bij stoppen: `preStop sleep 10` (endpoint eerst uit de load balancer), daarna SIGTERM → Next.js rondt lopende requests af (grace period 45 s). De worker stopt met ophalen en wacht max. 25 s op lopende jobs.

Een gewijzigde ConfigMap krijgt een nieuwe hash-naam, waardoor web en worker automatisch herstarten. Een gewijzigd Secret niet: daarna `kubectl -n <ns> rollout restart deploy/quartermaster-web deploy/quartermaster-worker`.

Het script doet geen `--prune`: resources die je uit de manifests haalt, verwijder je zelf (`kubectl delete`).

**Rollback**: `rollout.sh overlays/production <vorige-tag>`. Migraties worden niet teruggedraaid — daarom moeten migraties *backwards compatible* zijn met de draaiende release (expand → deploy → contract: eerst kolom toevoegen/optioneel maken, pas in een latere release oude kolommen verwijderen). Bij een echt kapotte migratie: restore (§13).

## 8. Migraties

- `prisma migrate deploy` draait als Job (`base/migrate-job.yaml`, image-target `migrate`) **vóór** nieuwe pods. Oude pods blijven tijdens de migratie verkeer bedienen (zie expand/contract hierboven).
- Idempotent en beschermd met een Postgres advisory lock: dubbel draaien is onschadelijk.
- Jobs zijn immutable, daarom verwijdert `rollout.sh` hem eerst. Na 24 uur ruimt `ttlSecondsAfterFinished` hem op.
- **Argo CD**: de Job heeft al `argocd.argoproj.io/hook: PreSync` + `hook-delete-policy: BeforeHookCreation`; Argo draait hem dan automatisch vóór elke sync en stopt bij falen.
- **Flux**: zet de Job in een eigen `Kustomization` (met `force: true`) en laat de app-Kustomization daarop `dependsOn` hebben.
- **Plain `kubectl apply -k`** zonder script: werkt niet betrouwbaar (Job immutable, geen volgorde) — gebruik het script.
- Migratie faalt → logs: `kubectl -n <ns> logs job/quartermaster-migrate`.

## 9. Proxy-, IP- en Host-contract

De app (security-agent, `src/server/auth`/IP-extractie) leest **`TRUSTED_PROXY_HOPS`**:

- `0` (default): `X-Forwarded-For` wordt genegeerd — veilig als er géén proxy voor staat.
- `1`: precies één proxy die `X-Forwarded-For` **zet/overschrijft**; de app neemt het laatste (rechtse) adres. Dit is de waarde in beide k8s-overlays.

Wat ingress-nginx daarvoor moet doen (`deploy/k8s/ingress-nginx/values.yaml`, globale controller-config, niet per Ingress):

| Instelling | Waarde | Waarom |
|---|---|---|
| `use-forwarded-headers` | `"false"` | nginx negeert door de client meegestuurde `X-Forwarded-*` en zet ze zelf: `X-Forwarded-For = $remote_addr`, `X-Real-IP = $remote_addr`, `X-Forwarded-Proto/-Host/-Port` uit de echte verbinding. Op `true` zou nginx ook een client-`X-Forwarded-Host` vertrouwen en die als `Host` naar de app sturen → tenant-spoofing. |
| `compute-full-forwarded-for` | `"false"` | `X-Forwarded-For` wordt **overschreven** met één adres, niet aangevuld op de header van de client. Met `true` kan de client het eerste adres kiezen. |
| `forwarded-for-header` | (default) | Wordt alleen gelezen als `use-forwarded-headers`/real-ip aan staat. |
| `use-proxy-protocol` | `"false"` | Alleen `true` als de cloud-LB PROXY protocol spreekt (dan ook de LB-annotatie van de provider — beide kanten of niets). |
| Service `externalTrafficPolicy` | `Local` | Anders SNAT't kube-proxy het client-IP naar een node-IP en ziet nginx (en dus de app) het verkeerde adres. |

Resultaat: de app krijgt één `X-Forwarded-For`-adres dat nginx zelf heeft bepaald → `TRUSTED_PROXY_HOPS=1` is correct.

**Achter een CDN/L7-proxy (bijv. Cloudflare-proxy) vóór ingress-nginx** — dan is `$remote_addr` het CDN. Twee opties:

1. Controller: `use-forwarded-headers: "true"`, `forwarded-for-header: "CF-Connecting-IP"` (of `X-Forwarded-For`), en **`proxy-real-ip-cidr`** beperken tot de IP-ranges van het CDN (default `0.0.0.0/0` = iedereen vertrouwen!). nginx herleidt dan `$remote_addr` tot het echte client-IP en zet nog steeds één XFF-adres → `TRUSTED_PROXY_HOPS=1` blijft kloppen. Omdat nginx met deze stand ook `X-Forwarded-Host` doorgeeft, moet het CDN die header zelf zetten/strippen, en moet de origin alleen bereikbaar zijn vanaf het CDN (firewall/allowlist).
2. Of `compute-full-forwarded-for: "true"` en `TRUSTED_PROXY_HOPS=2` — alleen als de app-kant dat ondersteunt en alle verkeer gegarandeerd via het CDN loopt. Optie 1 heeft de voorkeur.

**Host-header**: ingress-nginx stuurt de `Host` van de client ongewijzigd door (geen `upstream-vhost`-annotatie gebruiken). De app resolvet daarop de tenant; onbekende hosts vallen nooit terug op het platform. `X-Forwarded-Proto: https` wordt gebruikt voor absolute URL's.

Overige Ingress-annotaties (`base/ingress.yaml`): `proxy-body-size: 26m` (gelijk aan `serverActions.bodySizeLimit`/`proxyClientMaxBodySize` in `next.config.ts`), `proxy-buffering: "off"` (streaming van RSC/Suspense), `force-ssl-redirect`. HSTS staat in de controller aan **zonder** `includeSubDomains`, omdat tenant-domeinen andere (niet-HTTPS) subdomeinen kunnen hebben.

## 10. Uploads-opslag

`STORAGE_DRIVER=local`: productfoto's, documenten, factuur-/certificaat-PDF's en lead-foto's staan op het volume `/app/uploads`. **Web én worker** schrijven erin (de worker rendert PDF's en ruimt lead-foto's op), en de backup leest het. Opties:

| Optie | Wanneer | Gevolg |
|---|---|---|
| **A. ReadWriteMany-StorageClass** (NFS-CSI, AWS EFS, Azure Files, Longhorn RWX, CephFS, provider-NFS) — *productie-default* | Provider biedt RWX | Meerdere web-replica's, pods op willekeurige nodes, HPA mogelijk. Kies een class met fatsoenlijke latency; NFS-achtige opslag is trager bij veel kleine bestanden. |
| **B. ReadWriteOnce + alles op één node** (`components/uploads-rwo`) — *staging-default* | Geen RWX beschikbaar, kleine installatie | Eén web-replica; worker en backup worden met podAffinity op dezelfde node gezet. Rolling updates blijven werken (surge-pod landt op dezelfde node). Node-uitval = downtime tot het volume elders is gekoppeld. |
| **C. Object storage (S3/R2)** | Toekomst | `StorageDriver`-interface in `src/server/media/storage.ts` heeft al het uitbreidingspunt (`case "s3"`); nog niet gebouwd. Maakt web volledig stateless en uploads-backup overbodig (bucket-versioning). Aanbevolen zodra er meer dan één tenant met veel foto's draait. |

Uploads komen niet in het image (`.dockerignore`, en de build verwijdert een eventueel meegetraceerde `uploads/`).

## 11. Schalen

- **Web**: productie draait 2 replica's (PDB `minAvailable: 1`, topology spread over nodes/zones). Meer replica's of `components/hpa` (2–6, 70 % CPU) vereisen RWX-uploads.
  - De Next.js data-cache (`unstable_cache`, per tenant getagd) is **per pod**. `revalidateTag` na een admin-wijziging werkt alleen op de pod die de wijziging verwerkte; andere pods tonen de wijziging binnen de cache-TTL (shop-data 60 s, wisselkoersen 1 uur). Acceptabel voor nu; voor directe consistentie een gedeelde cache-handler (bijv. Redis) toevoegen — zie §19.
  - Elke pod is een eigen Postgres-client: Prisma/node-postgres-pool (default max 10) + pg-boss (max 3). Reken ~13 verbindingen per web-pod en per worker. Kleine managed-plannen hebben soms maar 20–25 verbindingen — dan een PgBouncer (transaction mode) van de provider gebruiken of de pool verkleinen (vergt een kleine app-wijziging, zie §19).
- **Worker**: 1 is genoeg; meer replica's mogen (jobs via `SKIP LOCKED`, cron-schedules gededupliceerd door pg-boss).
- **Resources** (startwaarden, bijstellen na metingen): web 250m/512Mi request, 2 CPU/1Gi limit (`--max-old-space-size=640`; sharp/libvips alloceert buiten de V8-heap); worker 100m/256Mi, 1 CPU/768Mi.

## 12. Postgres

**Aanbevolen: managed Postgres 18** (automatische backups + PITR, failover, minor-upgrades, monitoring). Zet `DATABASE_URL` met `sslmode=require` (of `verify-full` + CA) in het Secret. Pas de egress-NetworkPolicy aan als de provider een andere poort dan 5432 gebruikt (bijv. 25060). Liefst in dezelfde regio als het cluster.

**Optioneel: in-cluster** (`components/postgres-in-cluster`, gebruikt door staging): één `postgres:18-alpine`-StatefulSet met PVC, non-root, readiness via `pg_isready`, NetworkPolicy die alleen Quartermaster-pods toelaat. Bewust simpel: geen replicatie, geen failover, geen PITR — de nachtelijke pg_dump is de enige backup. Voor productie in-cluster liever een operator (CloudNativePG) dan deze StatefulSet. Secret: `quartermaster-postgres` (`POSTGRES_PASSWORD`) en `DATABASE_URL=postgresql://quartermaster:<pw>@quartermaster-postgres:5432/quartermaster`.

## 13. Backups & restore

**Wat**: CronJob `quartermaster-backup`, elke nacht 02:15 (Europe/Amsterdam):

1. `pg_dump --format=custom` van `DATABASE_URL` naar PVC `quartermaster-backups` (`/backups/db/quartermaster-<UTC-tijd>.dump`), gecontroleerd met `pg_restore --list`, ouder dan `BACKUP_RETENTION_DAYS` verwijderd.
2. Als Secret `quartermaster-backup-offsite` bestaat: `rclone copy` van de dumps **én het uploads-volume** naar een S3-compatibele bucket (AWS S3, Cloudflare R2, Backblaze B2, Scaleway, MinIO…). Kopiëren, nooit verwijderen — zet versioning + lifecycle-regels op de bucket. Zonder dat Secret staat er een waarschuwing in de log en blijft alles alleen op de PVC (= geen echte disaster recovery!).

Met managed Postgres heb je daarnaast de backups/PITR van de provider; de pg_dump is dan een extra, provider-onafhankelijke kopie.

Handmatig starten / controleren:

```bash
kubectl -n quartermaster create job --from=cronjob/quartermaster-backup backup-manual-$(date +%s)
kubectl -n quartermaster logs -f job/backup-manual-… -c pg-dump
kubectl -n quartermaster logs job/backup-manual-… -c offsite
```

**Restore database** (oefen dit vóór go-live op staging):

```bash
NS=quartermaster
# 1. Verkeer en jobs stoppen
kubectl -n $NS scale deploy/quartermaster-web deploy/quartermaster-worker --replicas=0
kubectl -n $NS patch cronjob quartermaster-backup -p '{"spec":{"suspend":true}}'
# 2. Hulp-pod met de backups-PVC (en de DB-URL uit het Secret)
kubectl -n $NS apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata: {name: qm-restore, labels: {app.kubernetes.io/name: quartermaster, app.kubernetes.io/component: backup}}
spec:
  securityContext: {runAsNonRoot: true, runAsUser: 1001, runAsGroup: 1001, fsGroup: 1001, seccompProfile: {type: RuntimeDefault}}
  containers:
    - name: pg
      image: postgres:18-alpine
      command: ["sleep", "infinity"]
      envFrom: [{secretRef: {name: quartermaster-secrets}}]
      securityContext: {allowPrivilegeEscalation: false, capabilities: {drop: ["ALL"]}}
      volumeMounts: [{name: backups, mountPath: /backups}]
  volumes: [{name: backups, persistentVolumeClaim: {claimName: quartermaster-backups}}]
EOF
kubectl -n $NS exec -it qm-restore -- ls -lh /backups/db
# (dump uit S3? eerst ophalen en `kubectl cp` naar /backups/db)
# 3. Terugzetten (overschrijft bestaande objecten)
kubectl -n $NS exec -it qm-restore -- sh -c \
  'pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction \
     --dbname="$DATABASE_URL" /backups/db/quartermaster-<tijd>.dump'
# 4. Opruimen en starten
kubectl -n $NS delete pod qm-restore
kubectl -n $NS patch cronjob quartermaster-backup -p '{"spec":{"suspend":false}}'
kubectl -n $NS scale deploy/quartermaster-worker --replicas=1
kubectl -n $NS scale deploy/quartermaster-web --replicas=2
```

Restore in een **nieuwe, lege** database (veiliger: eerst controleren, dan `DATABASE_URL` omzetten) gaat hetzelfde zonder `--clean`. Na een restore naar een ouder moment: draai de migrate-Job opnieuw (`rollout.sh`) als de dump van vóór de laatste migratie is.

**Restore uploads**: `rclone copy offsite:<bucket>/uploads /app/uploads` vanuit een pod die het uploads-volume schrijfbaar mount (zelfde opzet als hierboven, image `rclone/rclone`, Secret `quartermaster-backup-offsite`).

## 14. Cron

Terugkerende taken (`src/server/jobs/cron.ts`, UTC): `reservations.expire` (elke minuut), `alerts.scan` (5 min), `alerts.digest`, `offers.expire`, `rate-limit.prune`, `cart.abandoned` (elk uur), `leads.photos.cleanup` (dagelijks), `rates.refresh` (dagelijks 15:30).

- **Default**: de worker plant ze via pg-boss (`WORKER_CRON=1`). Geen extra Kubernetes-objecten nodig; pg-boss voorkomt dubbele runs bij meerdere workers.
- **Alternatief**: `components/external-cron` maakt per taak een CronJob die `POST http://quartermaster-web/api/cron/<taak>` doet met `Authorization: Bearer $CRON_SECRET` (constant-time vergeleken; endpoint uit zolang `CRON_SECRET` leeg of < 16 tekens is). Het component zet `WORKER_CRON=0`. Alleen interessant als je schedules als Kubernetes-objecten wilt zien/pauzeren. Houd de lijst in sync met `CRON_TASKS`.
- Backups zijn een eigen CronJob (§13).

## 15. DNS per tenant-domein & TLS

Per domein dat Quartermaster bedient:

1. **DNS**: `A`/`AAAA` naar het externe IP van de ingress-nginx-LoadBalancer (of `CNAME` naar de LB-hostname bij providers die een hostname geven). Apex-domein (`shop.nl`) kan geen CNAME → A-record, of ALIAS/ANAME bij de DNS-provider. `www.shop.nl` meestal een CNAME naar het apex-domein of dezelfde LB.
2. **Ingress**: host toevoegen aan `overlays/<env>/ingress-hosts.yaml` — een eigen `tls`-entry (eigen `secretName`) per tenant, zodat één falend domein de andere certificaten niet blokkeert — en uitrollen. cert-manager vraagt via HTTP-01 automatisch een certificaat aan zodra DNS klopt.
3. **Admin**: het domein registreren als `TenantDomain` van de tenant (exact de host zoals de browser hem stuurt, zonder poort in productie). Primary-domein bepaalt canonieke links.
4. **Turnstile**: hostname toevoegen aan de widget in het Cloudflare-dashboard (let op het maximum aantal hostnames per widget in je plan).
5. Controle: `curl -I https://<domein>/` → 200, geldig certificaat, juiste shop.

**Wildcard** (bijv. `*.quartermaster.nl` voor tenant-subdomeinen of staging): DNS `*.quartermaster.nl` → LB; certificaat via **DNS-01** (HTTP-01 kan geen wildcards) met een DNS-provider-solver in de ClusterIssuer (voorbeeld voor Cloudflare in `cluster-issuers.yaml`), één `tls`-entry `hosts: ["*.quartermaster.nl"]` en één rule `host: "*.quartermaster.nl"`. Eigen domeinen van tenants blijven losse hosts.

**Onboarding-subdomeinen**: goedgekeurde aanmeldingen (platform-admin → *Dealer applications*) krijgen automatisch `<slug>.<SHOP_SUBDOMAIN_BASE>` als `TenantDomain`. Dat werkt alleen met de wildcard hierboven voor precies die basis (`*.<SHOP_SUBDOMAIN_BASE>`): DNS, `tls`-entry en ingress-rule. Zet de wildcard-host ook in de Turnstile-widget. Eigen domeinen vraagt de eigenaar aan in stap *Go live* van de startwizard; de superadmin krijgt een mail en voegt het domein toe via de stappen 1–5 hierboven.

**Platform-host**: moet bereikbaar zijn voor Mollie (webhooks naar `APP_URL/api/webhooks/mollie/<tenantId>`), dus nooit achter een IP-allowlist zetten.

## 16. E2E-smoketests

`e2e/smoke.spec.ts` (Playwright): health/ready, home, catalogus + filter, productpagina, in winkelwagen → reservering zichtbaar, checkout-pagina rendert (wordt **nooit** verstuurd; de reservering wordt daarna weer vrijgegeven), admin-login rendert.

```bash
npm run e2e:install                                       # eenmalig: Chromium
npm run e2e                                               # tegen http://concept.localhost:3000 (npm run dev + seed)
E2E_BASE_URL=https://concept.staging.example npm run e2e  # tegen staging na een rollout
E2E_IGNORE_HTTPS_ERRORS=1 …                               # met Let's Encrypt-staging-certificaten
```

`E2E_BASE_URL` moet een **tenant**-host zijn. De add-to-cart-test reserveert echt een (uniek) product en geeft het aan het eind vrij; is er niets koopbaar op de eerste catalogus-pagina, dan wordt de test overgeslagen. In CI draait de suite zelfstandig: na `npm run build` worden de demo-tenant + demo-data geseed en start Playwright `next start` op poort 3001 (`localhost:3001` is een geseed secundair domein van de demo-tenant).

## 17. Cutover vanaf Concept500

Voorbereiding (dagen/weken vooraf):

- [ ] Productie-cluster draait, `rollout.sh` groen, e2e groen tegen staging met een **volledige proef-import** (ETL) van de echte data.
- [ ] Restore geoefend (§13), offsite-backup werkt.
- [ ] DNS-TTL van alle shopdomeinen 24–48 uur vooraf verlagen naar 300 s.
- [ ] Tijdelijke hostnamen (bijv. `nieuw.shop.nl`) of `/etc/hosts`-test tegen het nieuwe LB-IP: shop, checkout met Mollie **test**-key, mails, PDF's.
- [ ] Mollie: live-key en profiel klaar (in de admin van de tenant, §18); webhook-URL = `APP_URL/api/webhooks/mollie/<tenantId>`.
- [ ] Wijzigende URL's: besluit 22 — geen redirect-eis; redirects die er wel zijn, staan in de redirect-module (admin).
- [ ] Communicatie naar klanten/beheerders: onderhoudsvenster, nieuwe admin-URL, opnieuw inloggen (wachtwoorden: zie ETL-documentatie).

Cutover (onderhoudsvenster):

1. **Concept500 read-only**: onderhoudspagina of checkout/registratie/admin-wijzigingen uitzetten, zodat er geen nieuwe orders of voorraadmutaties meer bijkomen. Openstaande betalingen in Mollie laten afronden.
2. **Laatste backup** van de Concept500-database (en de foto-bron).
3. **ETL final run** tegen productie — via de voorbeeld-Job `deploy/k8s/jobs/etl.job.example.yaml` (mount het uploads-volume, zodat foto's direct goed staan) of vanaf een werkstation met `npm run etl -- --tenant <slug> …` tegen de productie-DB (port-forward) en daarna uploads overzetten. Eerst `--dry-run`, rapport controleren, dan echt. Details: `docs/etl/` en `npm run etl -- --help`.
4. **Controle**: ETL-rapport (aantallen producten/orders/klanten), steekproeven in admin en shop, `npm run e2e` tegen de tijdelijke hostname.
5. **DNS omzetten**: A/AAAA (en `www`) van de shopdomeinen naar het nieuwe LB-IP. Certificaten worden binnen enkele minuten uitgegeven zodra DNS propageert (`kubectl -n quartermaster get certificate`).
6. **Na de switch**: e2e tegen het echte domein, een echte (kleine) live-betaling en refund, mail-ontvangst (SPF/DKIM/DMARC goed?), Mollie-webhook komt binnen (order wordt betaald), logs controleren.
7. Concept500 nog enkele weken read-only bewaren (niet verwijderen), daarna archiveren. DNS-TTL weer verhogen.

Rollback-plan: DNS terug naar de oude server en Concept500 weer schrijfbaar zetten — alleen zinvol zolang er in Quartermaster nog geen orders binnen zijn gekomen.

## 18. Go-live-checklist

**Configuratie**

- [ ] `DATABASE_URL` (managed, `sslmode=require`), `APP_ENCRYPTION_KEY` (nieuw gegenereerd, veilig bewaard buiten het cluster — kwijt = versleutelde data kwijt).
- [ ] `PLATFORM_HOST`, `APP_URL` (https), `MAIL_FROM_FALLBACK`; `TRUSTED_PROXY_HOPS=1` en de ingress-nginx-config uit §9.
- [ ] `SMTP_URL` (productie-SMTP), SPF/DKIM/DMARC voor het afzenderdomein; testmail ontvangen (geen spam).
- [ ] **Turnstile**: `TURNSTILE_SECRET_KEY` in het Secret **en** `TURNSTILE_SITE_KEY` in de ConfigMap; alle shop-hostnamen in de widget. Test: registreren en nieuwsbrief-inschrijving werken.
- [ ] `CSP_MODE=report-only` bij livegang; logs volgen op `[csp]`-regels en na een rustige periode `enforce` zetten (`04-security-review.md` R2).
- [ ] `CRON_SECRET` alleen bij external-cron; `MATOMO_URL`/`MATOMO_TOKEN` indien gewenst.
- [ ] Images gebouwd met `NEXT_DEPLOYMENT_ID`.

**Per tenant (admin)**

- [ ] Mollie **live**-API-key + gewenste betaalmethodes; test-key eruit. Webhook-URL wordt automatisch `APP_URL/api/webhooks/mollie/<tenantId>` — platform-host publiek bereikbaar.
- [ ] Bedrijfsgegevens (naam, adres, KvK, btw-nummer, IBAN), factuurinstellingen/nummering, algemene voorwaarden/privacy-pagina's.
- [ ] Mail-instellingen (afzendernaam, reply-to/contact-e-mail).
- [ ] Verzendzones en -tarieven, landen-compliance, valuta.
- [ ] Domeinen (`TenantDomain`, primary), DNS + certificaat (§15).
- [ ] Owner-accounts met 2FA.

**Platform**

- [ ] Superadmin-account met 2FA; demo-tenants/seed-accounts niet aanwezig op productie.
- [ ] Backups: CronJob draait, offsite-Secret ingesteld, restore getest.
- [ ] Monitoring/alerting: minimaal uptime-check op `/api/ready` van platform- en shophosts, alert op mislukte Jobs (backup/migrate) en op pod-restarts; logs centraal (provider-logging of Loki).
- [ ] NetworkPolicies actief (CNI), Pod Security `restricted` op de namespace.
- [ ] `npm run e2e` groen tegen productie.

## 19. Open beslissingen

1. **Cloudprovider / cluster** — bepaalt RWX-StorageClass, LB (PROXY protocol of `externalTrafficPolicy: Local`), managed Postgres-poort en registry.
2. **Ingress-controller**: ingress-nginx is upstream met pensioen (maart 2026). Kiezen tussen de door de provider onderhouden variant, een andere controller (Traefik, NGINX Gateway Fabric/F5 NGINX Ingress) of Gateway API. De manifests zijn klein; alleen de annotaties en de forwarded-header-config (§9) vertalen.
3. **Uploads**: RWX nu, of object-storage-driver bouwen (aanbevolen op termijn, §10).
4. **Gedeelde Next.js-cache** bij meerdere web-pods (nu tot 60 s verouderde shopdata op andere pods, §11).
5. **DB-poolgrootte** instelbaar maken (`DATABASE_POOL_MAX`-achtige env in `src/server/db.ts`) of PgBouncer van de provider gebruiken.
6. **Turnstile-site-key runtime** maken (server component geeft de key als prop door) zodat het image niet per Turnstile-key gebouwd hoeft te worden.
7. **Offsite-backupdoel** (welke S3-provider, bewaartermijn, encryptie).
8. **Superadmin-bootstrap** zonder demo-data (los script i.p.v. de volledige seed, §6).
9. **CI/CD**: images pushen naar een registry en `rollout.sh` (of Argo CD/Flux) vanuit CI — nog niet ingericht; CI bouwt en valideert nu alleen.
