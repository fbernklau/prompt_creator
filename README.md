# KI Prompt-Generator für den Schulalltag (Österreich)

Web-App für die Bachelorarbeit zur systemischen KI-Integration im Unterricht.

## Neu: PostgreSQL + OIDC-fähiger Zugriff über Traefik

Diese Version verwendet jetzt eine **Backend-API mit PostgreSQL** für sinnvolle persistente Daten:

- Provider-Metadaten (pro User)
- Verschlüsselte Key-Metadaten (`cipherText`, `iv`, `salt`) pro Provider
- Prompt-Verlauf (pro User)

Zusätzlich ist die App auf **Traefik ForwardAuth/OIDC Header** ausgelegt:

- User-Erkennung über `x-forwarded-user` / `x-auth-request-user`
- Gruppenzuordnung über `x-forwarded-groups` / `x-auth-request-groups`
- Zugriffskontrolle per `OIDC_REQUIRED_GROUP` (Standard: `teacher`)

## Sicherheitsmodell

- API-Keys werden weiterhin **nur clientseitig** mit WebCrypto verschlüsselt (AES-GCM + PBKDF2).
- Server/DB speichern keinen Klartext-Key.
- Ohne korrekte Vault-Passphrase kann ein Key nicht entschlüsselt werden.

## Lokaler Start (Docker)

```bash
docker compose up -d --build
```

Dann öffnen: `http://localhost:8080`

## Persistenz

- PostgreSQL-Volume: `prompt_creator_pgdata`
- Tabellen werden beim Start automatisch angelegt:
  - `providers`
  - `prompt_history`

## OIDC mit Traefik (Konzept)

Setze vor den `prompt-creator` Router eine ForwardAuth/OIDC-Middleware (z. B. oauth2-proxy, authentik outpost, traefik-forward-auth).

Wichtig ist, dass an die App weitergereicht werden:

- `X-Forwarded-User`
- `X-Forwarded-Groups`

Und im Container:

- `AUTH_REQUIRED=true`
- `OIDC_REQUIRED_GROUP=teacher`

Dann dürfen nur User mit Gruppe `teacher` die API/UI nutzen.

## Testen (manuell)

1. `docker compose up -d --build`
2. `curl http://localhost:8080/api/health` sollte `{"ok":true}` liefern.
3. Ohne OIDC-Headers (bei `AUTH_REQUIRED=true`) sollte `/api/me` mit 401 antworten.
4. Mit gültigen OIDC/ForwardAuth-Headern Zugriff testen.
5. UI öffnen, Vault entsperren, Provider speichern, Seite neu laden → Daten bleiben erhalten.

## Entwicklungsmodus ohne OIDC

Für lokale Entwicklung kannst du in `docker-compose.yml` setzen:

- `AUTH_REQUIRED=false`

Dann wird intern der Fallback-User `local-dev` verwendet.
