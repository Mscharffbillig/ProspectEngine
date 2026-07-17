# Deploying the research worker to Ubuntu EC2

The worker is a plain Python process that talks to Postgres. It has no inbound
ports; a t3.micro/t4g.micro is plenty.

## 1. Provision

- Ubuntu 24.04 LTS AMI, default VPC, no inbound rules needed (SSH only).
- Outbound HTTPS must be allowed (Supabase, Brave Search, business websites).

## 2. Install

```bash
sudo apt update && sudo apt install -y python3.12-venv git
git clone <your-repo-url> ~/leadgenerator
cd ~/leadgenerator/services/research-worker
python3 -m venv .venv
.venv/bin/pip install -e .
```

## 3. Configure

Create `~/leadgenerator/.env` (the worker reads the repo-root `.env`):

```text
DATABASE_URL=postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DEMO_MODE=false
BRAVE_SEARCH_API_KEY=<key>
CRAWLER_USER_AGENT=LeadResearchBot/0.1
CRAWLER_CONTACT_EMAIL=<your email>
WORKER_ID=ec2-worker-1
```

Use the Supabase **session pooler** connection string (IPv4) from
Project Settings → Database. Verify with:

```bash
.venv/bin/python -m worker.main status
```

## 4. Run as a systemd service (continuous polling)

`sudo tee /etc/systemd/system/lead-worker.service`:

```ini
[Unit]
Description=Lead research worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/leadgenerator/services/research-worker
ExecStart=/home/ubuntu/leadgenerator/services/research-worker/.venv/bin/python -m worker.main poll
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lead-worker
journalctl -u lead-worker -f        # structured logs
```

The Settings page in the web app shows the worker heartbeat (green when it has
checked in within 2 minutes).

## 5. Alternative: cron (batch mode)

Instead of the service, drain the queue a few times a day:

```cron
*/30 7-19 * * 1-5 cd /home/ubuntu/leadgenerator/services/research-worker && .venv/bin/python -m worker.main once >> /home/ubuntu/worker.log 2>&1
```

## 6. Web app hosting

The Next.js app deploys anywhere Node runs (Vercel is simplest; set the
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, and provider keys as project env vars). It can also
run on the same EC2 box (`npm run build && npm run start` behind nginx), but the
worker does not require it — the app and worker only share the database.

## 7. Updating

```bash
cd ~/leadgenerator && git pull
cd services/research-worker && .venv/bin/pip install -e .
sudo systemctl restart lead-worker
```

Apply new migrations from your machine with `supabase db push`.
