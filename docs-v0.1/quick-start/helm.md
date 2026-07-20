# Quick start — Helm

Install Sentori self-hosted on your Kubernetes cluster.

## Requirements

- kubectl pointed at the target cluster.
- Helm 3.13+.
- A namespace (default: `sentori`).

## Install

```bash
helm repo add sentori oci://ghcr.io/goliajp/charts
helm install sentori sentori/sentori-selfhosted \
  --namespace sentori --create-namespace \
  --set server.bootstrap.ownerEmail=you@example.com \
  --set server.bootstrap.ownerPassword='CHANGE-ME-NOW' \
  --set ingress.enabled=true \
  --set ingress.host=sentori.your.domain
```

The chart ships an embedded postgres StatefulSet by
default — fine for kicking the tires; switch to a managed
DB for production:

```bash
helm install sentori sentori/sentori-selfhosted \
  --set postgres.enabled=false \
  --set externalDatabase.url='postgres://user:pw@pg.svc:5432/sentori' \
  ...
```

## Verify

```bash
kubectl -n sentori rollout status deploy/sentori-server
kubectl -n sentori port-forward svc/sentori-server 8080:8080
curl http://localhost:8080/healthz
```

## Upgrade

```bash
helm upgrade sentori sentori/sentori-selfhosted \
  --set image.tag=0.1.1
```

Database migrations run automatically on the new pod boot
— forward-compatible only; rolling back to an older image
after migrations have run is unsupported.

## Uninstall

```bash
helm uninstall sentori -n sentori
# postgres PVC is left behind on purpose. To wipe data:
kubectl -n sentori delete pvc sentori-postgres-data
```

## Production hardening

- Disable the embedded postgres; use a managed PG.
- Set `image.tag` to a pinned version, not `latest`.
- Front with an Ingress controller that terminates TLS.
- Mount the bootstrap secret externally via
  `server.bootstrap.ownerPassword` → reference an
  existing Secret instead of inlining.
- Set `server.resources.limits` per your scale.
