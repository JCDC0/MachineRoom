# Paperclip database backups

Read from the code of Paperclip 2026.1012.0, installed on 2026-10-20. Nothing was started, stopped or called. No Paperclip code is copied here, only route paths and field names.

Paths below are short forms. Expand them like this:

```
S = %APPDATA%\npm\node_modules\paperclipai\node_modules\@paperclipai\server\dist
D = %APPDATA%\npm\node_modules\paperclipai\node_modules\@paperclipai\db\dist
H = %APPDATA%\npm\node_modules\paperclipai\node_modules\@paperclipai\shared\dist
C = %APPDATA%\npm\node_modules\paperclipai\dist\index.js
```

The version is `2026.1012.0` (paperclipai/package.json:3).

## 1. The backup routes

There is one backup route in the whole server.

### POST /api/instance/database-backups

- Method and path: the router registers `"/instance/database-backups"` (S/routes/instance-database-backups.js:7), and the whole router is mounted at `/api` (S/app.js:752, mounted at S/app.js:619-621 when a backup service is passed, which it always is at S/index.js:676-684). So the full path is `/api/instance/database-backups`.
- Who may call it: `assertInstanceAdmin` runs first (S/routes/instance-database-backups.js:8; S/routes/authz.js:54-60). That needs a board actor and either `source === "local_implicit"` or `isInstanceAdmin`. In `local_trusted` mode every request is the implicit local board with `isInstanceAdmin: true` (S/middleware/auth.js:152-161), so anything that can reach the port may call it. In `authenticated` mode it is a signed-in board user who holds the `instance_admin` role (S/middleware/auth.js:203-224) or a board API key belonging to one (S/middleware/auth.js:239-255). An agent key is refused with 403 `Board access required` (S/routes/authz.js:23-26), and a bearer token that matches no key is refused with 401 (S/middleware/auth.js:266-271).
- Browser origin: the CSRF guard skips `local_implicit` and `board_key` actors (S/middleware/board-mutation-guard.js:79-86), so a bridge on the same machine with no `Origin` header is not blocked. A board session actor without a trusted `Origin` or `Referer` gets 403 `Board mutation requires trusted browser origin` (S/middleware/board-mutation-guard.js:87-90).
- Request body: none is read and none is validated (S/routes/instance-database-backups.js:7-20). The OpenAPI entry lists no request body either (S/routes/openapi.js:7861-7867).
- Answer: `201` with the object built at S/index.js:631-639. Fields:
  - `backupFile`: the full path of the new `.sql.gz` file (from D/backup-lib.js:454-458).
  - `sizeBytes`: its size (D/backup-lib.js:452).
  - `prunedCount`: how many old files the retention pass deleted (D/backup-lib.js:453).
  - `trigger`: `"manual"` (S/index.js:633).
  - `backupDir`: the folder the file was written to (S/index.js:634).
  - `retention`: `{ dailyDays, weeklyWeeks, monthlyMonths }` as read for this run (S/index.js:623, 635).
  - `startedAt`, `finishedAt`, `durationMs` (S/index.js:636-638).
- Errors:
  - 403 `Instance admin access required` for a board user who is not an instance admin (S/routes/authz.js:59).
  - 403 with code `database_backups_platform_managed` on a cloud-managed instance, for every caller (S/routes/instance-database-backups.js:13-17). A cloud-managed instance is one with `PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN` or `PAPERCLIP_MANAGED_CONFIG` set (S/services/cloud-instance.js:14-17).
  - 409 `Database backup already in progress` when a backup is already running (S/index.js:677-683; the conflict is thrown at S/index.js:613).
  - 500 when the dump fails, because the error is rethrown (S/index.js:651-654).
  - Error bodies are `{ error, code?, details? }` (S/middleware/error-handler.js:123-163).
- The published spec: tag `instance`, summary `Trigger a database backup`, responses 200, 401 and 403 (S/routes/openapi.js:7861-7867). It is listed as created (201) at S/routes/openapi.js:1241 and the status override at S/routes/openapi.js:1370-1372. It is listed as an instance admin operation at S/routes/openapi.js:1184-1191, which becomes `x-paperclip-authorization: { actor: "board", instanceAdmin: true }` (S/routes/openapi.js:1351-1362).

### Routes that do not exist

- No GET route lists backups. There is no list, no download and no delete route (S/routes/instance-database-backups.js:5-22 is the whole router, and it is exported as the only backup router at S/routes/index.js:36).
- No restore route exists. See section 5.
- The only read of backup state is `GET /api/health`. See section 4.
- The route works even when automatic backups are off, because the backup service is always passed to the app (S/index.js:676-684). Only the health block depends on the enabled flag (S/index.js:685-693).

## 2. Where a backup file is written and how it is named

- Folder: `config.databaseBackupDir` (S/config.js:167-169). In order of precedence: `PAPERCLIP_DB_BACKUP_DIR`, then the config file's `database.backup.dir`, then `<paperclip home>/instances/<instance id>/data/backups` (H/home-paths.js:51-53). The home is `PAPERCLIP_HOME` or `~/.paperclip` (H/home-paths.js:14-19), and the instance id is `PAPERCLIP_INSTANCE_ID` or `default` (H/home-paths.js:20-24, 27-29). The schema default string is `~/.paperclip/instances/default/data/backups` (H/config-schema.js:13-18, 24-29).
- Name: `<prefix>-YYYYMMDD-HHMMSS.sql.gz`, with prefix `paperclip` (D/backup-lib.js:421, 438-439). The stamp is the local time of the machine, from `getFullYear`, `getMonth`, `getDate`, `getHours`, `getMinutes` and `getSeconds` (D/backup-lib.js:27-30).
- How it is written: the folder is created if missing (D/backup-lib.js:437), a plain `.sql` file is written first (D/backup-lib.js:438-440), then it is gzipped into the `.sql.gz` and the `.sql` is deleted (D/backup-lib.js:850-853). On a failure both files are removed (D/backup-lib.js:862-876).
- Two engines. When no table is excluded and no column is nulled, the server runs `pg_dump` with `--format=plain --clean --if-exists --no-owner --no-privileges` and gzips its output (D/backup-lib.js:234-256, 442-450). The binary is `PAPERCLIP_PG_DUMP_PATH` or `pg_dump` (D/backup-lib.js:234). If that fails, or when the run has table filters, it falls back to a JavaScript dump written from the database connection (D/backup-lib.js:460-475, 475-848).
- Other files in the same tree, which are not made by the route or the timer: worktree seed backups under `<backupDir>/seed` with prefix `<instanceId>-seed` (C:49132-49141), and repair backups under `<backupDir>/repair` with prefix `<instanceId>-pre-repair` (C:51068-51075).
- Retention: three tiers, keep everything in the daily window, then the newest file of each week, then the newest of each month, delete the rest (D/backup-lib.js:49-112). Pruning only looks at names that start with the prefix of the run (D/backup-lib.js:64-68).
- What the retention numbers are: the instance general setting `backupRetention`, read from the database at each run so a change needs no restart (S/index.js:621-629). Shape `{ dailyDays, weeklyWeeks, monthlyMonths }` (H/validators/instance.js:9-13), default `{ 7, 4, 1 }` (H/types/instance.js:4-8), allowed values 3, 7 or 14 days, 1, 2 or 4 weeks, 1, 3 or 6 months (H/types/instance.js:1-3). Read with `GET /api/instance/settings/general` and set with `PATCH` on the same path (S/routes/instance-settings.js:144-189).

## 3. Does Paperclip back up by itself, and how often

Yes. A timer in the server process does it (S/index.js:1524-1538):

- When `config.databaseBackupEnabled` is true, `setInterval` calls a scheduled backup every `config.databaseBackupIntervalMinutes` minutes (S/index.js:1524-1537).
- The first automatic backup is one full interval after the server starts. There is no backup at startup (S/index.js:1531-1537, no call before the timer).
- A warm standby server skips it (S/index.js:1532).
- A scheduled run that finds a backup already running is skipped and logged, while a manual run in the same state gets 409 (S/index.js:606-614).

The settings that control it come from the config file or the environment, not from instance settings (S/config.js:158-166):

- `database.backup.enabled`, or `PAPERCLIP_DB_BACKUP_ENABLED`. Default true (S/config.js:158-160, H/config-schema.js:14).
- `database.backup.intervalMinutes`, or `PAPERCLIP_DB_BACKUP_INTERVAL_MINUTES`. Default 60 minutes, minimum 1 (S/config.js:161-163, H/config-schema.js:15).
- `database.backup.dir`, or `PAPERCLIP_DB_BACKUP_DIR` (S/config.js:167-169).

`database.backup.retentionDays`, or `PAPERCLIP_DB_BACKUP_RETENTION_DAYS`, is read into the config (S/config.js:164-166) but the server timer does not use it. It is only printed in the startup banner (S/index.js:1587-1589, S/startup-banner.js:79-80). The timer prunes with the instance setting from section 2.

Two other automatic backups exist outside the server timer:

- `paperclipai db:backup` makes one backup on demand, into the same folder and with the same prefix, with its own retention default of the config value or 30 days, and `--json` prints `{ backupFile, sizeBytes, prunedCount, backupDir, retentionDays, connectionSource }` (C:46013-46054, C:67221). This one does not go through the HTTP route.
- `paperclipai update` runs that same command before updating unless `--no-backup` is given (C:46472, C:46556, C:67188), and skips it when the instance has no data yet (C:46306-46311).

## 4. How the time of the last backup can be read

`GET /api/health` carries a `databaseBackup` block (S/routes/health.js:311-313, 361-362). It is built fresh on every request by `inspectDatabaseBackupHealth`, with no cache (S/routes/health.js:311-313, S/services/database-backup-health.js:60-103).

Fields (S/services/database-backup-health.js:94-102):

- `enabled`: the config flag.
- `status`: `ok` when there is no warning, otherwise `warning`.
- `backupDir`: the folder that was scanned.
- `maxAgeHours`: the staleness limit.
- `latestBackup`: `{ name, path, mtime, ageHours, sizeBytes }`, or null.
- `lastFailure`: `{ path, mtime, message }` from a failure marker file, or null.
- `warnings`: a list of `{ code, message }`.

How each is found:

- `latestBackup` is the newest file in `backupDir` whose name ends in `.sql.gz`, by modification time (S/services/database-backup-health.js:38-59). Any such name counts, not only `paperclip-` ones (S/services/database-backup-health.js:41-42).
- `mtime` is an ISO string and `ageHours` is the age rounded to one decimal (S/services/database-backup-health.js:3-5, 55-56).
- Warning codes: `database_backup_missing` when no file is there (S/services/database-backup-health.js:69-74), `database_backup_stale` when `ageHours` is above `maxAgeHours` (S/services/database-backup-health.js:75-80), `database_backup_last_failure` when a marker file exists (S/services/database-backup-health.js:81-86, 14-37), `database_backup_check_failed` when the scan throws (S/services/database-backup-health.js:88-93).
- `maxAgeHours` is `PAPERCLIP_DB_BACKUP_MAX_AGE_HOURS`, else `max(26, ceil(interval minutes / 60 * 2))`, so twice the interval with a floor of 26 hours (S/index.js:596-597). It is forced to at least 1 (S/services/database-backup-health.js:63).
- Failure markers: the default marker is `<backupDir>/../health/db-backup-to-s3.failure` (S/index.js:598-599), and two more paths are always checked, `<backupDir>/db-backup-to-s3.failure` and `<backupDir>/../db-backup-to-s3.failure` (S/index.js:600-604, S/services/database-backup-health.js:6-13).

Who sees what:

- The block is absent when `config.databaseBackupEnabled` is false, because the options are only passed then (S/index.js:685-693).
- In `local_trusted` mode every caller gets the full block (S/routes/health.js:20-23).
- In `authenticated` mode only a board or agent actor gets the full block. Anyone else gets `{ enabled, status, warnings }` with fixed sentences in place of the real messages, and no `backupDir`, `maxAgeHours`, `latestBackup` or `lastFailure` (S/routes/health.js:20-24, 50-68, 321-343). The comment at S/routes/instance-database-backups.js:9-12 says the server-side backup directory path must not reach a managed tenant.

## 5. How to restore a backup

Not found in the code: a route, a CLI command, or a UI that restores a backup file. The CLI has `db:backup` and no `db:restore` (C:67221, and the command list at C:67186-67265), and the only backup router is the one in section 1.

What the code does show:

- The restore function is `runDatabaseRestore` (D/backup-lib.js:882-915). It feeds the file to `psql` (D/backup-lib.js:258-281). The binary is `PAPERCLIP_PSQL_PATH` or `psql` (D/backup-lib.js:258). The arguments are `--dbname=<connection string> --set=ON_ERROR_STOP=1 --quiet --no-psqlrc`, and stdin is the file gunzipped when its name ends in `.gz` (D/backup-lib.js:259-276).
- If `psql` fails and the file holds no statement breakpoints, it throws (D/backup-lib.js:889-894). If the breakpoints are there, it replays the file statement by statement over the database client instead (D/backup-lib.js:282-336, 895-914).
- Its only caller outside the tests is the worktree seed flow, which resets the target database first and then restores into it (C:49150-49155).
- The dump is plain SQL made with `--clean --if-exists` (D/backup-lib.js:236-241), so replaying it drops and recreates the objects it holds. The JavaScript engine writes `DROP TABLE IF EXISTS ... CASCADE` and `CREATE TABLE` inside one transaction (D/backup-lib.js:484-491, 591-643, 846).

Step by step, as far as the code shows:

1. Stop the Paperclip server. Not found in the code: anything that stops it for you, or any check that the database is idle. The seed flow does stop its own database handle before it resets the database (C:49144-49155), which is the closest thing to a rule in the code.
2. Find the connection string. `DATABASE_URL` first, then the config file's `database.connectionString` when `database.mode` is `postgres`, otherwise the embedded Postgres at `127.0.0.1:<embeddedPostgresPort>/paperclip` with port default 54329 (D/backup.js:22-36, H/config-schema.js:19-23). The password is masked in these files (D/backup.js:35), so take it from the embedded Postgres setup.
3. Replay the file into that database the way the code does: `gunzip -c paperclip-YYYYMMDD-HHMMSS.sql.gz | psql "<connection string>" --set=ON_ERROR_STOP=1 --quiet --no-psqlrc` (D/backup-lib.js:259-276). Set `PAPERCLIP_PSQL_PATH` if `psql` is not on the path.
4. Start the server again. The seed flow applies pending migrations right after its restore (C:49158), and the normal startup path applies them too.
5. Not found in the code: a backup of the current database before a restore, a version or schema check on the file, a check that the file belongs to this instance, or any rollback.

## 6. What MachineRoom can use

- Back up now: `POST /api/instance/database-backups` with no body, from the bridge. The bridge sends no token, so this works only in `local_trusted` mode; in `authenticated` mode Paperclip refuses it. It answers `201` with `backupFile`, `sizeBytes`, `prunedCount` and the times. A second call during a run answers `409`.
- Backup age: `GET /api/health`, `databaseBackup.latestBackup.mtime` and `ageHours`, plus `databaseBackup.status` and the warning codes. In `local_trusted` mode these fields are always there. In `authenticated` mode the caller must be a board actor, or the block is redacted; the bridge is not a board actor, so it gets the redacted block.
- Both routes must be listed in `server/surface.js` before the bridge calls them, so `npm run doctor` compares them with the running Paperclip's spec.
- Nothing in the code gives a list of backup files. The newest file is the only one the health answer names, and a restore has no route at all, so the viewer can show the age and offer a backup, but not offer a restore.
