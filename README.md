# VPS Video Library v3 — SIMPLE COOLIFY SETUP

This guide is written for the Coolify screen you are using.

**Important:** this project already contains a `Dockerfile`. Do **not** use Nixpacks.

## 1. What you are setting up

```text
Internet
   ↓
your-domain.com
   ↓
Coolify (or your NGINX → Coolify)
   ↓
Video Library container
   ├── /media → your existing VPS video folder
   ├── /data  → database + thumbnails + converted videos
   └── Redis  → sessions + playback state
```

The app listens **inside the container on port `3000`**.

---

# 2. Put the project on GitHub

Create a repository and upload the contents of this ZIP.

The repository root should contain:

```text
Dockerfile
package.json
server/
client/
index.html
vite.config.ts
tsconfig.json
.env.example
README.md
```

---

# 3. Create the Coolify application

In Coolify:

```text
Project
→ Environment
→ Create New Resource
→ Application
→ Public Repository
```

Select your GitHub repository.

Then open:

```text
Configuration → General
```

---

# 4. Change Build Pack

Your screenshot currently shows:

```text
Build Pack: Nixpacks
```

Change it to:

```text
Build Pack: Dockerfile
```

This is important because this project needs its own Dockerfile. Coolify supports Dockerfile applications directly. citeturn0search6turn0search12

After selecting Dockerfile:

```text
Base Directory: /
```

If a Dockerfile path field is shown:

```text
/Dockerfile
```

Leave these empty:

```text
Install Command
Build Command
Start Command
Publish Directory
```

The Dockerfile already contains those instructions.

---

# 5. Fix the port

Your screenshot currently shows:

```text
Ports Exposes: 3004
```

Change it to:

```text
3000
```

The application listens on port 3000 inside its container.

Coolify uses `Ports Exposes` to know which port the application listens on. citeturn0search1

For the simplest setup:

```text
Ports Exposes:
3000

Port Mappings:
EMPTY
```

You do **not** need `3004:3000` if Coolify's proxy is handling your domain.

---

# 6. Create Redis

In the same Coolify project/environment:

```text
Create New Resource
→ Redis
```

Use the normal/default Redis configuration.

Do **not** expose Redis publicly.

The video application and Redis should be in the same Coolify environment/network so the app can use Redis internally.

---

# 7. Add environment variables

Open:

```text
Configuration
→ Environment Variables
```

Add:

```text
MEDIA_ROOT=/media
DATA_ROOT=/data
PORT=3000
HOST=0.0.0.0
SESSION_TTL=2592000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=YOUR_LONG_RANDOM_PASSWORD
```

For:

```text
REDIS_URL
```

use the **internal Redis URL shown by your Coolify Redis resource**.

It may look similar to:

```text
redis://redis:6379
```

but use the value Coolify actually provides.

Your password should be at least 12 characters.

---

# 8. Add your video directory

This is the part that connects the application to your existing VPS videos.

Go to:

```text
Configuration
→ Persistent Storage
→ + Add
```

Create a **Directory / Bind Mount**.

### Source Path

Enter the real path of your videos on the VPS.

For example:

```text
/home/ubuntu/videos
```

This is only an example. Use the actual directory containing your videos.

### Destination Path

Enter exactly:

```text
/media
```

So it becomes:

```text
Source Path:
YOUR_REAL_VIDEO_DIRECTORY

Destination Path:
/media
```

Coolify's bind mounts use a host `Source Path` and container `Destination Path`. citeturn0search0

**Do not put `/media` as the source unless your videos really are stored at `/media` on the VPS.**

---

# 9. Add persistent application storage

Add another storage entry.

Choose:

```text
Volume
```

Name:

```text
video-library-data
```

Destination:

```text
/data
```

This stores:

```text
/data/library.db
/data/thumbs/
/data/subtitles/
/data/transcoded/
```

Your screenshot already shows a `/data` directory. **Keep that.**

The `/data` storage must be persistent, otherwise the database and caches can disappear when the container is recreated. Coolify supports persistent Docker volumes for this purpose. citeturn0search0

---

# 10. Your storage should look like this

You should end up with two entries:

```text
1. VIDEO DIRECTORY

Source:
YOUR_REAL_VIDEO_DIRECTORY

Destination:
/media
```

and:

```text
2. APPLICATION DATA

Volume:
video-library-data

Destination:
/data
```

---

# 11. Domain

The easiest setup is to let Coolify handle your domain and HTTPS.

In:

```text
Configuration
→ General
→ Domains
```

enter:

```text
https://video.example.com
```

Replace `video.example.com` with your real domain.

Then point your DNS record to the VPS running Coolify.

For example:

```text
Type: A
Name: video
Value: YOUR_VPS_PUBLIC_IP
```

If you use Cloudflare, the DNS record can point to the VPS as normal.

**You do not need external NGINX for the first deployment.**

Get the application working through Coolify first.

---

# 12. Save and deploy

At this point your important Coolify settings should be:

```text
Build Pack:
Dockerfile

Base Directory:
/

Ports Exposes:
3000

Port Mappings:
(empty)

Environment:
MEDIA_ROOT=/media
DATA_ROOT=/data
PORT=3000
HOST=0.0.0.0
REDIS_URL=your-internal-redis-url
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-password
SESSION_TTL=2592000

Storage:
/your/video/folder → /media
video-library-data → /data
```

Now:

```text
Save
→ Deploy
```

---

# 13. Check the deployment

Open:

```text
Deployments
→ latest deployment
→ Logs
```

You want to see something similar to:

```text
VPS Video Library v3 listening on 0.0.0.0:3000
```

If you see that, the application has started.

---

# 14. First login

Open your domain.

You should see the login page.

Use the credentials you put into:

```text
ADMIN_USERNAME
ADMIN_PASSWORD
```

---

# 15. Test before using your entire library

For your first test, put a few files in the mounted video folder:

```text
Test/
├── Test.mp4
├── Test.mkv
├── Test S01E01.mkv
├── Test S01E02.mkv
├── Test.en.srt
└── Test.en.vtt
```

Then check:

```text
✓ Login
✓ Folder navigation
✓ Thumbnail
✓ MP4 playback
✓ MKV playback/transcoding
✓ Resume
✓ Continue Watching
✓ Favorites
✓ Watch History
✓ SRT subtitles
✓ VTT subtitles
✓ Episode detection
✓ Next episode
```

Only after that should you point `/media` at your complete library.

---

# 16. How video conversion works

You do **not** need to manually convert your videos.

When a video is requested:

```text
Browser requests video
        ↓
Application detects browser
        ↓
Checks video format/codec
        ↓
Compatible?
   ┌────┴────┐
  YES       NO
   ↓         ↓
Direct     FFmpeg
stream     conversion
             ↓
          cache result
             ↓
          stream result
```

Compatible videos are streamed directly.

Incompatible videos are converted to a browser-friendly format.

The converted files are stored in:

```text
/data/transcoded/
```

The same source/browser combination can then reuse the cached conversion.

---

# 17. Why transcoding can use a lot of CPU

For example:

```text
H.264 MP4
→ direct playback
→ very little transcoding CPU
```

but:

```text
HEVC/H.265 MKV
→ H.264/AAC conversion
→ significant CPU usage
```

Several simultaneous incompatible videos can therefore use a lot of CPU.

For a personal library this is normally fine, but keep this in mind on a small VPS.

---

# 18. Subtitles

Put subtitles next to the video:

```text
Movie.mkv
Movie.en.srt
Movie.hi.srt
Movie.ja.vtt
```

The player automatically discovers them.

The player will provide a subtitle selector such as:

```text
CC Off
EN
HI
JA
```

---

# 19. Episode detection

These patterns are recognized:

```text
Show S01E01.mkv
Show S01E02.mkv
Show S01E03.mkv
```

Also:

```text
Show 1x01.mkv
Show 1x02.mkv
```

And:

```text
Show Episode 01.mkv
Show Episode 02.mkv
```

The application automatically sorts detected episodes and provides Previous/Next controls.

---

# 20. Continue Watching

Playback position is saved automatically.

For example:

```text
Movie
████████████░░░░ 72%
```

Open the movie again and it resumes around the saved position.

Redis stores the fast playback/session state, while SQLite stores the durable user/history information.

---

# 21. Favorites

While watching a video, press:

```text
♡ Add to favorites
```

It then appears under:

```text
Favorites
```

---

# 22. Watch History

The application stores:

```text
Video
Last watched time
Playback position
Duration
Completion status
```

History is stored in:

```text
/data/library.db
```

---

# 23. If you want NGINX in front

**Do this only after the Coolify version works.**

The simplest and recommended first deployment is:

```text
Internet
 ↓
Coolify proxy
 ↓
Video Library
```

You originally asked for:

```text
Internet
 ↓
NGINX
 ↓
Coolify
 ↓
Video Library
```

That is also possible.

If you want this setup, you need a host port.

For example:

```text
Container port:
3000

Host port:
3004
```

In Coolify this can be:

```text
Ports Exposes:
3000

Port Mappings:
127.0.0.1:3004:3000
```

The important difference is:

```text
3000 = application/container port

3004 = VPS/host port
```

Coolify documents host port mappings as `host:container`; direct port mappings are separate from proxy-based domain routing. citeturn0search1

---

# 24. NGINX configuration

On the VPS:

```bash
sudo nano /etc/nginx/sites-available/video-library
```

Put:

```nginx
server {
    listen 80;
    server_name video.example.com;

    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:3004;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;

        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Change:

```text
video.example.com
```

to your domain.

Change:

```text
3004
```

if you chose another host port.

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/video-library /etc/nginx/sites-enabled/video-library
```

Test:

```bash
sudo nginx -t
```

If it says the configuration is OK:

```bash
sudo systemctl reload nginx
```

---

# 25. HTTPS with NGINX

Install Certbot:

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx
```

Then:

```bash
sudo certbot --nginx -d video.example.com
```

After it finishes, use:

```text
https://video.example.com
```

---

# 26. If using NGINX, do NOT expose the Coolify port publicly

Use:

```text
127.0.0.1:3004:3000
```

not:

```text
0.0.0.0:3004:3000
```

The first keeps the application reachable only from the VPS itself, where NGINX can access it.

---

# 27. Do not expose Redis

Never expose Redis to the public Internet.

Do not open:

```text
6379
```

in your firewall.

The video application talks to Redis internally.

---

# 28. If Coolify says "Exited"

Do not change random settings.

Open:

```text
Deployments
→ latest deployment
→ Logs
```

Look at the final error.

Common causes:

### `ADMIN_PASSWORD` error

Make sure it is at least 12 characters.

### Redis error

Check:

```text
REDIS_URL
```

and make sure Redis is running.

### `/media` empty

Check the Persistent Storage bind mount:

```text
Source = real VPS video directory
Destination = /media
```

### Build fails

Make sure:

```text
Build Pack = Dockerfile
```

not Nixpacks.

### Application starts but cannot open

Make sure:

```text
Ports Exposes = 3000
```

---

# 29. The exact changes needed on your current Coolify screen

From your screenshots:

### Change this:

```text
Build Pack
Nixpacks
```

to:

```text
Dockerfile
```

### Change this:

```text
Ports Exposes
3004
```

to:

```text
3000
```

### Change this:

```text
Port Mappings
3000:3000
```

to:

```text
EMPTY
```

for the simple Coolify-proxy setup.

### Keep this:

```text
Persistent Storage
Destination:
/data
```

Then add your actual video directory:

```text
YOUR_VIDEO_DIRECTORY → /media
```

---

# 30. Recommended setup for you

Start with this:

```text
                 YOUR DOMAIN
                     │
                     ▼
               ┌───────────┐
               │  Coolify  │
               │   Proxy   │
               └─────┬─────┘
                     │
                     ▼
          ┌────────────────────┐
          │ VPS Video Library  │
          │      :3000         │
          └──────┬─────┬──────┘
                 │     │
          ┌──────┘     └──────┐
          ▼                   ▼
       /media               /data
          │                   │
     Your videos        DB + caches

                         Redis
```

Get this working first.

**Do not add NGINX until this works.**

Once the application is confirmed working, NGINX can be placed in front without changing the application itself.
