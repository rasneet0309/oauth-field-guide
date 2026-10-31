# Deploy the demo link (Render, free)

The app is one Node process with no runtime dependencies, so it needs a host that runs a single Node instance and doesn't buffer streamed responses. Render's free web service does both: it builds from a GitHub repo, runs Node natively, and passes the generator's Server-Sent Events through (the server also sends a heartbeat every 15 s).

What the free tier means for the demo ([Render's free-tier limits](https://render.com/docs/free)):

- It sleeps after 15 minutes without traffic, and the next visit takes about a minute to wake it.
- Its disk is wiped on every restart, redeploy and sleep, so **the share store forgets generated guides**. A share link carries the app and intent, so an expired one offers to generate the guide again in one click. Library guide links such as `/guides/slack` always work.
- One instance, and 750 free instance hours a month per workspace.

## 1. Put the code on GitHub

Create an empty repository on GitHub (no README or licence, so the first push is clean). Then, from the project folder:

```bash
git init -b main
git add -A
git grep -nIE "sk-ant-[A-Za-z0-9_-]{20,}|xox[abpors]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----" || echo "no keys staged"
git commit -m "OAuth Field Guide v3.4.0"
git remote add origin https://github.com/YOUR-NAME/oauth-field-guide.git
git push -u origin main
```

`.gitignore` already keeps `.env`, `.data/`, `node_modules/` and `dist/` out of the repo.

Leave `ANTHROPIC_API_KEY` unset everywhere. It turns on the live research agent, which uses a paid API; without it the generator runs the offline engine, which costs nothing.

## 2. Create the web service

In the Render dashboard: **New → Web Service**, connect GitHub and pick the repository.

| Setting | Value |
|---|---|
| Language | Node (Render reads `.nvmrc`, so Node 22) |
| Build command | `npm ci --omit=dev` (installs nothing: there are no runtime dependencies) |
| Start command | `npm start` |
| Instance type | Free |
| Health check path | `/api/health` (under Advanced) |

Set only these three environment variables:

| Key | Value | Why |
|---|---|---|
| `HOST` | `0.0.0.0` | The server listens on loopback by default; Render needs every interface. Render sets `PORT` itself |
| `ALLOWED_HOSTS` | `YOUR-SERVICE.onrender.com` | Requests for any other host name get a 421 (a DNS-rebinding guard). Render shows the address once the service exists; if it differs, update this value, which redeploys |
| `GENERATE_RATE_LIMIT` | `60` | Fresh generations per visitor per 10 minutes. Behind Render's proxy many visitors can look like one, so the default of 10 is too tight for a demo |

## 3. Check it

- `https://YOUR-SERVICE.onrender.com/api/health` returns `{"status":"ok","version":"3.4.0",…}`.
- On the site, open **Live Generator** and run "Zoom": six stages stream in, and the guide's provider approval reads "Unconfirmed".
- Press **Share link** and open the copied link in a private window.

## 4. Link it from the README

Replace `YOUR-SERVICE.onrender.com` and `github.com/YOUR-NAME/oauth-field-guide` at the top of `README.md` with the real addresses, then commit and push. Render redeploys on every push to `main`.
