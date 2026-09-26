# RoomCraft AI Interior Design Backend

Node.js/Express backend for the API in `api_contract.md`. It includes MySQL persistence, JWT authentication, direct Cloudflare R2 uploads, OpenAI room analysis and image editing, asynchronous design jobs, retry/recovery, credits, validation, rate limiting, and automated API tests.

## What is implemented

| Method | Endpoint | Behavior |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Creates a user with 30 configurable credits and returns a JWT |
| `POST` | `/api/auth/login` | Verifies the password and returns a JWT |
| `GET` | `/api/users/me` | Returns the authenticated profile and live credit balance |
| `GET` | `/api/projects` | Returns the user's projects newest first |
| `POST` | `/api/projects` | Creates a project owned by the user |
| `POST` | `/api/rooms/upload-url` | Creates a short-lived, user-scoped R2 `PUT` URL |
| `POST` | `/api/rooms` | Verifies the R2 object and creates idempotent room metadata |
| `POST` | `/api/designs` | Atomically reserves credits and queues a durable design job |
| `GET` | `/api/designs/:id` | Returns polling state and signed/public result URLs |
| `GET` | `/health` | Liveness check |
| `GET` | `/ready` | MySQL readiness check |

The database worker claims jobs using `FOR UPDATE SKIP LOCKED`, so multiple worker processes can run safely. A crashed worker's job is recovered after `WORKER_STALE_AFTER_SECONDS`. Generated object keys and database variants are deterministic/idempotent. Failed jobs are refunded once, transactionally.

## Requirements

- Node.js 20 or newer
- MySQL 8.4 LTS (Docker or MySQL Community Server)
- A Cloudflare R2 bucket and R2 API token with object read/write access
- An OpenAI API key with access to the configured vision and image models

## Local setup

1. Start MySQL (the included Compose file creates the database and user, and exposes port 3306):

   ```bash
   docker compose up -d mysql
   ```

   If you prefer a native installation, install MySQL Community Server 8.4 and run:

   ```sql
   CREATE DATABASE roomcraft CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
   CREATE USER 'roomcraft'@'localhost' IDENTIFIED BY 'choose-a-strong-password';
   GRANT ALL PRIVILEGES ON roomcraft.* TO 'roomcraft'@'localhost';
   ```

2. Copy `.env.example` to `.env` and set the JWT, R2, and OpenAI secrets. For Docker Compose, the included local MySQL credentials already match `DATABASE_URL`; if you change them, keep `MYSQL_PASSWORD` and the password inside `DATABASE_URL` in sync. The connection format is:

   ```dotenv
   DATABASE_URL=mysql://roomcraft:choose-a-strong-password@localhost:3306/roomcraft
   ```

   Percent-encode special characters in the username or password when they are placed in the URL. Generate the JWT secret with a password manager or a cryptographically secure random generator; it must be at least 32 characters.

3. Install, migrate, test, and start:

   ```bash
   npm install
   npm run migrate
   npm test
   npm run dev
   ```

The server listens on `http://localhost:3000`; the Flutter Android emulator can use `http://10.0.2.2:3000/api`.

`RUN_MIGRATIONS=true` applies pending migrations during startup. The migration runner uses a MySQL named lock so only one replica migrates at a time. For deployments with multiple API replicas, you can instead run `npm run migrate` as a release step and set `RUN_MIGRATIONS=false` in application replicas.

The MySQL migration creates all six application tables, foreign keys, indexes, JSON columns, and the migration history table. If this application already has PostgreSQL data, changing `DATABASE_URL` does not transfer that data; export/import it separately before switching production traffic.

## Cloudflare R2 setup

Create a bucket and an S3-compatible API token, then fill in:

```dotenv
R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=roomcraft
```

For a public/custom-domain bucket, set `R2_PUBLIC_BASE_URL=https://cdn.example.com`. For a private bucket, leave it empty; polling responses contain expiring signed read URLs.

The Flutter app uploads directly from the browser/device, so configure the bucket CORS policy for the exact production frontend origins. A development example is:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Use the Flutter app's real web origin in production. Native Android/iOS clients are not subject to browser CORS, but the policy is still needed for Flutter Web.

## Upload flow

1. Call `POST /api/rooms/upload-url` with the file name and MIME type.
2. `PUT` the raw bytes to `uploadUrl`, using exactly the same `Content-Type` value.
3. Call `POST /api/rooms` with the returned `imageKey`.

Example:

```bash
curl -X POST http://localhost:3000/api/rooms/upload-url \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileName":"living-room.jpg","contentType":"image/jpeg"}'

curl -X PUT "$UPLOAD_URL" \
  -H "Content-Type: image/jpeg" \
  --data-binary @living-room.jpg
```

The API accepts JPEG, PNG, and WebP room images up to `MAX_ROOM_IMAGE_BYTES` (20 MiB by default). Upload keys are generated by the backend and cryptographically bound to the authenticated user's ID; client-provided external image URLs are never trusted.

## Design jobs and credits

`preview` costs `PREVIEW_CREDITS_PER_VARIANT` (default 1), while `final` costs `FINAL_CREDITS_PER_VARIANT` (default 3). Credits are reserved in the same transaction that creates the job, preventing concurrent requests from overspending. The final retry refunds those credits in an idempotent transaction.

The embedded worker starts with the API when `RUN_WORKER=true`. In a scaled deployment, use dedicated workers instead:

```bash
# API replicas
RUN_WORKER=false npm start

# One or more worker replicas
npm run worker
```

Accepted polling states are `queued`, `analyzing_room`, `generating_images`, `completed`, and `failed`.

## Production notes

- Set `NODE_ENV=production`, a strong unique `JWT_SECRET`, and explicit comma-separated `CORS_ORIGINS`.
- Put the service behind HTTPS and set `TRUST_PROXY=true` when the reverse proxy is trusted.
- Keep R2, database, JWT, and OpenAI secrets only in the backend environment/secret manager.
- Back up MySQL. Object lifecycle rules can clean up abandoned room uploads and old generated images.
- Run at least one worker. API replicas may run independently of worker replicas.
- Keep the OpenAI model names and pricing environment values current. Usage and request IDs are always stored; `actual_ai_cost_usd` is populated when the per-million pricing values are non-zero.
- Monitor `/health`, `/ready`, HTTP 5xx logs, queue age, retries, failed jobs, and credit refunds.

## Commands

```bash
npm run dev       # API with Node watch mode
npm start         # API production process
npm run worker    # dedicated job worker
npm run migrate   # apply SQL migrations
npm test          # route and prompt/security tests
npm run check     # syntax checks
```

## Project layout

```text
migrations/              MySQL schema migrations
src/app.js               Express middleware and routes
src/auth/                JWT signing and verification
src/db/                  Connection pool and migration runner
src/http/                Validation schemas and error/auth middleware
src/services/            MySQL, R2, OpenAI, and domain services
src/worker/              Durable design worker and prompt construction
test/                    Contract-level HTTP and security tests
```
