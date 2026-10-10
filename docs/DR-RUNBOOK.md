# Backups and restoring them

Every night at 02:30 Malaysia time GitHub makes an encrypted copy of all Property OS data (owners, units,
bookings, statements, payouts, users, settings, the audit trail) and keeps it for 30 days. Nothing else
needs to be paid for or signed up to: the copies sit on the GitHub repository itself, as "artifacts" of
the **Nightly database backup** workflow.

What is copied: everything in the database schema `pos`, plus `public.pos_migrations` (which database
updates have been applied). Not copied: the supply chain engine (`scm`) and photos and documents in
Cloudflare R2 (they are not in this database).

The copy is encrypted with a passphrase only you hold. Without the passphrase a downloaded copy is
unreadable, and nobody (including GitHub) can restore it.

---

## 1. Set it up (once, about 10 minutes)

You add two secrets to the GitHub repository. Do this yourself; never paste either of them into a chat.

**a. Get the database connection string**

1. Open https://supabase.com/dashboard and sign in.
2. Open the production project: its id is `cweomoenhsjvsxfsmiiw` (check the address bar).
3. Click **Connect** at the top of the page.
4. Under **Connection string**, pick **Session pooler** (not "Direct connection": GitHub cannot reach
   that one; not "Transaction pooler": backups do not work through it).
5. Copy the string. It looks like
   `postgresql://postgres.cweomoenhsjvsxfsmiiw:[YOUR-PASSWORD]@aws-0-....pooler.supabase.com:5432/postgres`.
   Replace `[YOUR-PASSWORD]` with the database password. If you do not have it, use **Reset database
   password** on the project's Database settings page, then update `.dev.vars.production` on your computer
   with the new password too.

**b. Choose a backup passphrase**

Make up a long passphrase (at least 12 characters; four or five random words is good). Write it down
somewhere safe that is **not** GitHub, for example your password manager. If it is lost, every backup is
lost with it.

**c. Add both to GitHub**

1. Open https://github.com/hookka-dev/Conts-ERP
2. Click **Settings** (top bar of the repository) > **Secrets and variables** (left side) > **Actions**.
3. Click **New repository secret**. Name: `PROD_DB_URL`. Secret: the connection string from (a).
   Click **Add secret**.
4. Click **New repository secret** again. Name: `BACKUP_PASSPHRASE`. Secret: the passphrase from (b).
   Click **Add secret**.

## 2. Run it once now, by hand

1. Open https://github.com/hookka-dev/Conts-ERP/actions
2. Click **Nightly database backup** on the left.
3. Click **Run workflow** (right side), keep branch `main`, click the green **Run workflow**.
4. Wait about two minutes and refresh. A green tick means it worked. Click the run: at the bottom,
   under **Artifacts**, there is `conts-pos-backup-<number>`.
5. Open the **Dump, compress and encrypt** step: the last line says how many tables and rows were copied,
   for example `Backup written: ... 61 tables, 24,310 rows.`

A red cross: click the run to see why. "Repository secret(s) not set" means step 1c was missed;
"connection refused" or "password authentication failed" means the connection string in step 1a is
wrong (check it is the **Session pooler** one and the password is in it).

From then on it runs every night by itself. When a scheduled run fails, GitHub emails the person who last changed the workflow file, not necessarily you, so glance at the Actions page once a week: the newest **Nightly database backup** run should have a green tick.

## 3. Check a backup is good (any time, does not touch any database)

On a computer with this repository and Node installed:

1. Download the artifact (Actions > the run > Artifacts > `conts-pos-backup-<number>`) and unzip it.
   Inside is `conts-pos-<date>.sql.gz.enc`.
2. In the repository folder run:

   ```
   node scripts/restore-backup.mjs --file=<path to the .sql.gz.enc> --check-only
   ```

3. Type the backup passphrase when asked (nothing shows while you type). It prints every table and its
   row count. "The passphrase is wrong" means the passphrase does not match that backup.

## 4. Restore

Restoring **replaces** the data in the database you point it at. Practise on staging first.

**Into staging (a drill, or to inspect old data):**

1. Get the staging connection string the same way as step 1a, from project `ecgyrmblqfxvbfjlqkdq`.
2. Run:

   ```
   node scripts/restore-backup.mjs --file=<path to the .sql.gz.enc> --prompt --replace
   ```

3. Paste the **staging** connection string when asked, then the backup passphrase. It shows the target
   project id before it does anything, restores, then compares every table's row count with the backup
   and prints `All N tables match`. Any `DIFF` line means do not rely on that restore.

**Into production (only after data loss):**

Same command; the script refuses production unless you also add exactly:

```
--confirm-production="restore over production cweomoenhsjvsxfsmiiw"
```

Before doing that: take a fresh backup of what is there now (step 2), so the restore can be undone, and
tell staff to stop using the system until it is finished. After the restore, sign in and check a few
bookings and the latest owner statement.

**Into a brand new database:** run the same command against it (no `--replace` needed), then set the app's
database password with `node scripts/migrate-pg.mjs --prompt` (POS_APP_PASSWORD) and point the
Cloudflare Hyperdrive at the new database.

## How it works (for whoever maintains it)

- `.github/workflows/backup.yml` runs `scripts/backup-dump.sh` with the PostgreSQL 18 client: two
  `pg_dump` runs (schema `pos`; table `public.pos_migrations`) as plain SQL INSERTs, the exact row count of
  every table appended as `-- rowcount` comments, `gzip -9`, then `openssl enc -aes-256-cbc -pbkdf2
  -iter 200000 -md sha256`. Only the encrypted file is uploaded, kept 30 days.
- `scripts/restore-backup.mjs` decrypts the same format in Node (no openssl or psql needed), refuses a target
  that already has `pos` tables unless `--replace`, refuses production without the phrase, restores in one
  transaction (all or nothing), hands every `pos` table to the app's role `pos_app`, then checks the counts.
- Proven locally on 10 Oct 2026 against a copy of the real-sized data (139 units, 4,288 bookings); the
  table-by-table counts are in the pull request that added this file.
- Artifacts count towards the repository's GitHub storage; one backup is a few megabytes.
