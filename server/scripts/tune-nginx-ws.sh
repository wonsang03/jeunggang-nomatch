#!/usr/bin/env bash
set -euo pipefail

sudo tee /etc/nginx/sites-available/jeunggang >/dev/null <<'EOF'
map $http_upgrade $connection_upgrade {
  default upgrade;
  '' close;
}

server {
  server_name 13.124.220.37.sslip.io;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
    # 소켓 지연·버퍼링 줄이기
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_cache off;
    tcp_nodelay on;
  }

  listen 443 ssl;
  ssl_certificate /etc/letsencrypt/live/13.124.220.37.sslip.io/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/13.124.220.37.sslip.io/privkey.pem;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
  listen 80;
  server_name 13.124.220.37.sslip.io;
  return 301 https://$host$request_uri;
}
EOF

sudo nginx -t
sudo systemctl reload nginx
echo nginx_ok
