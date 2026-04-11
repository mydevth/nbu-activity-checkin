#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
NBU Activity — Deploy Script
rsync project files → server, install deps, setup PM2 + Nginx
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
import paramiko, os, time, tarfile
from pathlib import Path
from stat import S_ISDIR

# ─── Config ───────────────────────────────────────────────────────────────────
HOST     = "147.50.10.29"
PORT     = 22
USER     = "akkadate"
PASSWORD = "Tct85329$"
REMOTE   = "/var/www/app/nbu-activity-checkin"
LOCAL    = Path(__file__).parent.parent  # root ของ project

# ไฟล์/folder ที่ไม่ต้อง upload
EXCLUDES = {
    "node_modules", ".git", ".env", "*.log", "__pycache__",
    "*.pyc", ".DS_Store", "nbu-activity.zip", "scripts/deploy.py",
    "public/thumbnails", "*.xlsx", "*.xls", "~$*",
}

def should_exclude(path: str) -> bool:
    import fnmatch
    parts = Path(path).parts
    for p in parts:
        if p in EXCLUDES:
            return True
        for exc in EXCLUDES:
            if '*' in exc or '?' in exc:
                if fnmatch.fnmatch(p, exc):
                    return True
    return False

# ─── SSH helpers ──────────────────────────────────────────────────────────────
def run(ssh, cmd, check=True):
    print(f"  $ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, get_pty=True)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    rc  = stdout.channel.recv_exit_status()
    if out.strip(): print("   ", out.strip()[:500])
    if err.strip() and rc != 0: print("  !", err.strip()[:300])
    if check and rc != 0:
        raise RuntimeError(f"Command failed (rc={rc}): {cmd}")
    return out, rc

def sudo_run(ssh, cmd, check=True):
    return run(ssh, f"echo '{PASSWORD}' | sudo -S {cmd}", check)

# ─── Upload via SFTP (tar stream) ─────────────────────────────────────────────
def upload_project(ssh):
    print("\n[Step 1] กำลัง pack และ upload ไฟล์...")
    sftp = ssh.open_sftp()

    # สร้าง tar ใน memory
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for root, dirs, files in os.walk(LOCAL):
            # กรอง dirs in-place
            dirs[:] = [d for d in dirs if not should_exclude(
                str(Path(root).relative_to(LOCAL) / d)
            )]
            for f in files:
                filepath = Path(root) / f
                arcname  = filepath.relative_to(LOCAL)
                if should_exclude(str(arcname)):
                    continue
                tar.add(str(filepath), arcname=str(arcname))
    buf.seek(0)
    size = buf.getbuffer().nbytes
    print(f"   Pack size: {size/1024:.0f} KB")

    # upload tar
    remote_tar = "/tmp/nbu_deploy.tar.gz"
    sftp.putfo(buf, remote_tar)
    sftp.close()
    print(f"   Upload → {remote_tar} ✓")
    return remote_tar

# ─── Main deploy ──────────────────────────────────────────────────────────────
def deploy():
    print("=" * 55)
    print("  NBU Activity — Deploy")
    print(f"  Host : {USER}@{HOST}")
    print(f"  Dest : {REMOTE}")
    print("=" * 55)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=30)
    print("✅ SSH connected\n")

    # 1. Upload
    remote_tar = upload_project(ssh)

    # 2. Extract
    print("\n[Step 2] Extract ไฟล์...")
    sudo_run(ssh, f"mkdir -p {REMOTE}")
    sudo_run(ssh, f"chown -R {USER}:{USER} {REMOTE}")
    run(ssh, f"tar -xzf {remote_tar} -C {REMOTE}")
    run(ssh, f"rm -f {remote_tar}")

    # 3. .env (ถ้ายังไม่มี)
    print("\n[Step 3] ตรวจสอบ .env...")
    out, _ = run(ssh, f"test -f {REMOTE}/.env && echo exists || echo missing", check=False)
    if "missing" in out:
        run(ssh, f"cp {REMOTE}/.env.example {REMOTE}/.env 2>/dev/null || touch {REMOTE}/.env", check=False)
        print("   สร้าง .env จาก .env.example — กรุณาแก้ไข .env ก่อน start")
    else:
        print("   .env มีอยู่แล้ว ✓")

    # 4. Node.js check
    print("\n[Step 4] ตรวจสอบ Node.js...")
    out, rc = run(ssh, "node --version", check=False)
    if rc != 0 or not out.strip().startswith("v"):
        print("   ติดตั้ง Node.js 20...")
        sudo_run(ssh, "apt-get update -qq")
        sudo_run(ssh, "apt-get install -y ca-certificates curl gnupg")
        run(ssh, "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -")
        sudo_run(ssh, "apt-get install -y nodejs")
        run(ssh, "node --version")
    else:
        print(f"   Node.js {out.strip()} ✓")

    # 5. npm install
    print("\n[Step 5] npm install...")
    run(ssh, f"cd {REMOTE} && npm install --production 2>&1 | tail -5")

    # 6. PM2
    print("\n[Step 6] ตั้งค่า PM2...")
    out, rc = run(ssh, "which pm2", check=False)
    if rc != 0:
        run(ssh, "sudo npm install -g pm2")

    # สร้าง ecosystem config
    ecosystem = f"""module.exports = {{
  apps: [{{
    name: 'nbu-activity',
    script: 'server.js',
    cwd: '{REMOTE}',
    interpreter: 'node',
    env: {{ NODE_ENV: 'production' }},
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    error_file: '/var/log/nbu-activity/error.log',
    out_file:   '/var/log/nbu-activity/out.log',
  }}]
}};
"""
    sftp2 = ssh.open_sftp()
    sftp2.putfo(io.BytesIO(ecosystem.encode()), f"{REMOTE}/ecosystem.config.cjs")
    sftp2.close()

    sudo_run(ssh, "mkdir -p /var/log/nbu-activity")
    sudo_run(ssh, f"chown -R {USER}:{USER} /var/log/nbu-activity")

    # restart / start
    run(ssh, f"cd {REMOTE} && pm2 restart ecosystem.config.cjs 2>/dev/null || pm2 start ecosystem.config.cjs", check=False)
    run(ssh, f"pm2 save")
    out2, rc2 = run(ssh, "pm2 startup 2>/dev/null | grep sudo", check=False)
    if out2.strip().startswith("sudo"):
        run(ssh, out2.strip(), check=False)

    # 7. Nginx
    print("\n[Step 7] ตั้งค่า Nginx...")
    out, rc = run(ssh, "which nginx", check=False)
    if rc != 0:
        sudo_run(ssh, "apt-get install -y nginx")

    nginx_conf = f"""server {{
    listen 80;
    server_name activity.northbkk.ac.th {HOST};

    # Thumbnails (static)
    location /thumbnails/ {{
        alias /var/www/activity/public/thumbnails/;
        expires 7d;
        add_header Cache-Control "public";
    }}

    # Proxy → Node.js
    location / {{
        proxy_pass         http://127.0.0.1:5533;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }}
}}
"""
    sftp3 = ssh.open_sftp()
    sftp3.putfo(io.BytesIO(nginx_conf.encode()), "/tmp/nbu-activity.conf")
    sftp3.close()

    sudo_run(ssh, "mv /tmp/nbu-activity.conf /etc/nginx/sites-available/nbu-activity")
    sudo_run(ssh, "ln -sf /etc/nginx/sites-available/nbu-activity /etc/nginx/sites-enabled/nbu-activity", check=False)
    sudo_run(ssh, "rm -f /etc/nginx/sites-enabled/default", check=False)
    sudo_run(ssh, "nginx -t")
    sudo_run(ssh, "systemctl reload nginx")

    # 8. สรุป
    print("\n" + "=" * 55)
    print("✅ Deploy เสร็จสมบูรณ์!")
    print(f"   App URL : http://{HOST}")
    print(f"   Admin   : http://{HOST}/admin")
    print(f"   Scanner : http://{HOST}/scanner")
    print(f"   API     : http://{HOST}/api/health")
    print()
    print("⚠️  สิ่งที่ต้องทำเพิ่ม:")
    print(f"   1. แก้ไข .env → ssh {USER}@{HOST} 'nano {REMOTE}/.env'")
    print(f"   2. รัน migrate → ssh {USER}@{HOST} 'cd {REMOTE} && node database/migrate.js'")
    print(f"   3. Import นักศึกษา → python scripts/import_students.py students.csv")
    print(f"   4. เปลี่ยน password server!")
    print("=" * 55)

    # show pm2 status
    print()
    run(ssh, "pm2 list", check=False)

    ssh.close()

if __name__ == "__main__":
    deploy()
