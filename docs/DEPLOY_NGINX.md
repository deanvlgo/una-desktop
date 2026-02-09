# Deploy With Nginx + Basic Auth (Lightweight)

This is a practical temporary protection strategy until full application auth is implemented.

## What this gives you

- Password protection for the UI and collaboration endpoint.
- Reverse proxy for Hocuspocus WebSocket traffic.
- Static serving of the web app from Nginx.

## 1. Build the web app with the public collab URL

Build the web app so the browser points at your Nginx-proxied collab path:

```bash
VITE_HOCUSPOCUS_URL=wss://archival.example.org/collab/ npm run -w @archival/web build
```

## 2. Run Hocuspocus on localhost only

Keep collab private behind Nginx by binding to localhost:

```bash
HOCUSPOCUS_HOST=127.0.0.1 HOCUSPOCUS_PORT=1234 npm run -w @archival/collab start
```

## 3. Install Nginx and htpasswd tooling

Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y nginx apache2-utils
```

## 4. Create a password file

```bash
sudo htpasswd -c /etc/nginx/.htpasswd_archival_editor your_username
```

To add another user later:

```bash
sudo htpasswd /etc/nginx/.htpasswd_archival_editor another_user
```

## 5. Install the Nginx site config

1. Open `docs/nginx/archival-editor.conf`.
2. Replace:
- `archival.example.org`
- `/ABSOLUTE/PATH/TO/editor/apps/web/dist`
- `/etc/nginx/.htpasswd_archival_editor` (if needed)

Then install and enable:

```bash
sudo cp docs/nginx/archival-editor.conf /etc/nginx/sites-available/archival-editor.conf
sudo ln -s /etc/nginx/sites-available/archival-editor.conf /etc/nginx/sites-enabled/archival-editor.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 6. (Recommended) Add TLS

If you are public on the internet, terminate HTTPS and use `wss://` from the browser.

With Certbot on Ubuntu:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d archival.example.org
```

Then keep `VITE_HOCUSPOCUS_URL` as `wss://archival.example.org/collab/`.

## Security note

Basic Auth is a temporary perimeter control. It is reasonable for demos and short-term IP protection, but it is not a substitute for full app-level authentication/authorization.
