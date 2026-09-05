# Theme configuration cleanup

Run this idempotent cleanup once before deploying the backend version that removes the theme API:

```sh
go run ./cmd/cleanup_theme_config
```

The command drops `users.theme_config` from MySQL when present and unsets `theme_config` from legacy MongoDB user documents. Re-running it is safe.
