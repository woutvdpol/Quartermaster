#!/usr/bin/env bash
# Quartermaster rollout: migrations first, then the app. Needs only kubectl (≥ 1.27, built-in kustomize).
#
#   deploy/k8s/rollout.sh overlays/staging              # deploy the tags pinned in the overlay
#   deploy/k8s/rollout.sh overlays/production 1a2b3c4   # override the image tag (all three images)
#   DRY_RUN=1 deploy/k8s/rollout.sh overlays/production # render + server-side dry run only
#
# Order (docs/deploy.md "Rollouts"):
#   1. infrastructure: namespace, ServiceAccount, ConfigMap, NetworkPolicies, (in-cluster Postgres)
#   2. migration Job (`prisma migrate deploy`) — deleted + re-created, waited for; abort on failure
#   3. everything else: web, worker, Service, Ingress, PDB, CronJobs, PVCs — then wait for rollout
# Old pods keep serving during 2, so migrations must be backwards compatible with the running
# release (expand → deploy → contract).
set -euo pipefail

K8S_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OVERLAY_ARG="${1:?usage: rollout.sh <overlay-dir> [image-tag]}"
TAG="${2:-}"
DRY_RUN="${DRY_RUN:-0}"
MIGRATE_TIMEOUT="${MIGRATE_TIMEOUT:-900}"

if [[ -d "$OVERLAY_ARG" ]]; then OVERLAY="$(cd "$OVERLAY_ARG" && pwd)"; else OVERLAY="$(cd "$K8S_DIR/$OVERLAY_ARG" && pwd)"; fi
[[ "$OVERLAY" == "$K8S_DIR"/* ]] || { echo "overlay must live under $K8S_DIR" >&2; exit 2; }

WORK="$(mktemp -d "$K8S_DIR/.rollout.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
RENDERED="$WORK/rendered.yaml"

kubectl kustomize "$OVERLAY" > "$RENDERED"

if [[ -n "$TAG" ]]; then
  # Re-render through a wrapper kustomization that only changes the tag of our three images.
  {
    echo "resources: [\"../${OVERLAY#"$K8S_DIR"/}\"]"
    echo "images:"
    grep -oE 'image: [^ ]*quartermaster(-worker|-migrate)?(:[^ ]+)?$' "$RENDERED" \
      | sed -E 's/^image: //; s/:[^:/]+$//' | sort -u \
      | while read -r repo; do echo "  - {name: \"$repo\", newTag: \"$TAG\"}"; done
  } > "$WORK/kustomization.yaml"
  kubectl kustomize "$WORK" > "$RENDERED.tmp" && mv "$RENDERED.tmp" "$RENDERED"
fi

NS="$(awk '/^kind: Namespace/{f=1} f&&/^  name: /{print $2; exit}' "$RENDERED")"
[[ -n "$NS" ]] || { echo "no Namespace in overlay" >&2; exit 2; }
echo "→ overlay ${OVERLAY#"$K8S_DIR"/}, namespace $NS, images:"
grep -oE 'image: .*quartermaster.*' "$RENDERED" | sort -u | sed 's/^/    /'

if [[ "$DRY_RUN" == "1" ]]; then
  kubectl apply --dry-run=server -f "$RENDERED"
  exit 0
fi

APP_COMPONENTS="web,worker,backup,cron,migrate"

echo "→ 1/3 infrastructure"
kubectl apply -f "$RENDERED" --selector "app.kubernetes.io/component notin ($APP_COMPONENTS)"
kubectl -n "$NS" get secret quartermaster-secrets > /dev/null \
  || { echo "Secret $NS/quartermaster-secrets is missing (see deploy/k8s/secrets/secret.example.yaml)" >&2; exit 1; }
if kubectl -n "$NS" get statefulset quartermaster-postgres > /dev/null 2>&1; then
  kubectl -n "$NS" rollout status statefulset/quartermaster-postgres --timeout=300s
fi

echo "→ 2/3 migrations"
kubectl -n "$NS" delete job quartermaster-migrate --ignore-not-found --wait=true
kubectl apply -f "$RENDERED" --selector "app.kubernetes.io/component=migrate"
deadline=$(( $(date +%s) + MIGRATE_TIMEOUT ))
while :; do
  succeeded="$(kubectl -n "$NS" get job quartermaster-migrate -o jsonpath='{.status.succeeded}')"
  failed="$(kubectl -n "$NS" get job quartermaster-migrate -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}')"
  if [[ "$succeeded" == "1" ]]; then break; fi
  if [[ "$failed" == "True" || $(date +%s) -gt $deadline ]]; then
    echo "✗ migration failed — app NOT rolled out. Logs:" >&2
    kubectl -n "$NS" logs job/quartermaster-migrate --tail=200 >&2 || true
    exit 1
  fi
  sleep 3
done
kubectl -n "$NS" logs job/quartermaster-migrate --tail=20 || true

echo "→ 3/3 application"
kubectl apply -f "$RENDERED" --selector "app.kubernetes.io/component!=migrate"
kubectl -n "$NS" rollout status deployment/quartermaster-web --timeout=600s
kubectl -n "$NS" rollout status deployment/quartermaster-worker --timeout=300s
echo "✓ rollout complete"
