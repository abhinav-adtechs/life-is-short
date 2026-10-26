# Life is short

## Keeping keys and tasks out of this public repo

- `.gitignore` excludes key/secret files (`.env*`, `*.pem`, `*.key`, SSH keys, `secrets/`, credentials) and task files (`tasks/`, `TASKS.*`, `todo.*`, `*.tasks`, `.claude/`).
- `.githooks/pre-commit` blocks those files even if force-added, and rejects staged content that looks like an API key or private key. Enable it once per clone:

  ```sh
  git config core.hooksPath .githooks
  ```

- Put secrets in `.env` (ignored); commit a `.env.example` with placeholder values if needed.
