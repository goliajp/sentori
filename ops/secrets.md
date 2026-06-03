# Sentori — secrets management (Phase 16 sub-D)

We commit encrypted secrets, not plaintext `.env` files. Decryption
keys live on operator laptops + the deploy VM via [age](https://age-encryption.org/).

## One-time setup (on your laptop)

```sh
brew install sops age   # or your distro's equivalent
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
# Public key prints on stderr — copy it; we'll add it to .sops.yaml.
```

## Repo wiring

`.sops.yaml` at the repo root maps file globs → recipients (= public
age keys). Anyone whose private key matches a recipient can decrypt
that file; nobody else can.

```yaml
creation_rules:
  - path_regex: ^secrets/.*\.enc\.yaml$
    age: >-
      age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p,
      age1zwl8sgxv65a2qwl4l65q3z37c9xvun07ynqu0xzs9k6mu3l3rcfsxq4u3y
```

(Line-break-separated; commas are syntactic sugar.)

## Encrypting

```sh
sops -e --age age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p \
     secrets/prod.yaml > secrets/prod.enc.yaml
git add secrets/prod.enc.yaml      # safe to commit
```

## Decrypting on the deploy VM

The VM gets a *separate* age key (don't reuse a laptop key):

```sh
sudo install -d -m 700 -o sentori /etc/sentori
sudo -u sentori age-keygen -o /etc/sentori/age.key
# Print pubkey, add it to .sops.yaml, re-encrypt with sops --rotate.
```

Compose pulls plaintext at boot via a small wrapper:

```sh
SOPS_AGE_KEY_FILE=/etc/sentori/age.key \
  sops -d secrets/prod.enc.yaml > /run/sentori.env
docker compose --env-file /run/sentori.env -f docker/production-compose.yml up -d
shred /run/sentori.env
```

Use a `tmpfs` mount for `/run/sentori.env` if you can't trust the
host filesystem.

## Rotation

When an operator leaves, regenerate their key (or simply remove their
public key from `.sops.yaml`) and run:

```sh
sops --rotate -i secrets/prod.enc.yaml
git commit -am 'rotate sops recipients'
```

The next deploy picks up the new ciphertext.

## What does NOT go in `secrets/`

- Anything that can be public (DNS records, Caddyfile, alert rules).
- The age private keys themselves — those live outside git.
- Backup *artifacts* — those live in R2, not in git.

## mailrs SMTP submission user (sentori@golia.jp)

Sentori's notifier signs in to the goliajp/mailrs server at
`mail.golia.ai:587` STARTTLS as `sentori@golia.jp`. The credentials
live in `gh secret set SENTORI_SMTP_USER / SMTP_PASS` on the sentori
repo (sub-A picked them); the matching account lives in mailrs's
`users.toml` (a TOML file inside the running mailrs container's
volume — see notes below).

### Rotating the password (recommended yearly + on suspected leak)

```sh
# 1. Generate a new password.
NEW=$(openssl rand -base64 24 | tr -d '+/=')

# 2. Hash with argon2id. mailrs's users.toml accepts either a plain
#    `password = "..."` or `password_hash = "$argon2id$..."`. We
#    always store the hash.
HASH=$(docker run --rm -i debian:13-slim bash -c '
  apt-get update -qq >/dev/null 2>&1
  apt-get install -y -qq argon2 >/dev/null 2>&1
  read pw
  salt=$(head -c 16 /dev/urandom | base64 | tr -d "/+" | head -c 16)
  echo -n "$pw" | argon2 "$salt" -id -m 16 -t 3 -p 1 -e
' <<<"$NEW")

# 3. Write new file inside the mailrs container's named volume.
#    The live compose does NOT bind-mount users.toml; `docker cp`
#    into the volume is the only working path.
TMP=$(mktemp)
cat > "$TMP" <<EOF
[users."sentori@golia.jp"]
password_hash = "$HASH"
EOF
scp "$TMP" t02:/tmp/sentori-users.toml
ssh t02 'docker cp /tmp/sentori-users.toml mailrs:/data/users.toml \
        && cd /apps/mailrs && docker compose restart mailrs'

# 4. Update sentori secrets so the deploy uses the new password.
gh secret set SENTORI_SMTP_PASS --repo goliajp/sentori --body "$NEW"

# 5. Re-trigger the sentori deploy so server containers pick up the
#    new SMTP_PASS env.
gh workflow run deploy --repo goliajp/sentori --ref release/v0.2.0
```

Verify the rotation by registering a fresh user on
`https://sentori.golia.jp/register` and watching for the
verification email to land in the recipient's inbox.
