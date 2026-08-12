# VPS Video Library 3.0.2 — Coolify Fixed Build

> **Important:** The frontend is in `client/`. The Docker/Vite configuration is already set up correctly for this layout. You do **not** need to move `client/src` into `/src`.

# VPS Video Library v3

A self-hosted, authenticated video library for a VPS-mounted media directory, designed for deployment with Coolify.

## What changed in v3

v3 adds **browser-aware video delivery**.

Instead of assuming that every file can be played directly by the browser:

1. The application identifies the browser/session from the request's User-Agent.
2. It probes the source with `ffprobe`.
3. If the source is already compatible with the selected browser profile, it is streamed directly.
4. If it is not compatible, FFmpeg converts it to a cached browser-friendly format.
5. The converted file is then served with normal HTTP Range requests, so seeking works.
6. The converted result is reused on future plays until the source file changes.

### Browser profiles

| Browser/session | Target when conversion is needed |
|---|---|
| iPhone/iPad/Safari | H.264 + AAC in MP4 |
| Chrome/Chromium/Edge | VP9 + Opus in WebM |
| Firefox | VP9 + Opus in WebM |
| Unknown browser | H.264 + AAC in MP4 |

H.264/AAC MP4 is used as the universal fallback because it has the broadest browser/device compatibility.

> Conversion is intentionally cached. The first play of a file that needs conversion can take time and consume CPU/disk. Later plays use the cached output.

## v3 feature list

- Username/password authentication
- Redis-backed sessions
- HttpOnly authentication cookies
- Login rate limiting
- bcrypt password hashing
- Persistent SQLite database
- Redis playback/resume state
- Continue Watching
- Watch History
- Favorites
- Recursive folder navigation
- Automatic episode detection
- Previous/Next episode navigation
- Automatic thumbnails using FFmpeg
- Thumbnail cache
- SRT subtitle support
- VTT subtitle support
- SRT → VTT conversion/cache
- Custom subtitle selector
- Browser-aware transcoding
- Transcoding cache
- HTTP Range streaming
- Direct streaming for already-compatible files
- Read-only media mount support
- Responsive UI
- Coolify Dockerfile deployment

---

# 1. Architecture

```text
                         Internet
                            │
                            ▼
                  ┌─────────────────────┐
                  │       NGINX         │
                  │  your domain :443   │
                  └──────────┬──────────┘
                             │ proxy_pass
                             ▼
                  ┌─────────────────────┐
                  │       Coolify       │
                  │  Application Proxy  │
                  └──────────┬──────────┘
                             │
                             ▼
              ┌─────────────────────────────┐
              │ VPS Video Library container │
              │            :3000             │
              └──────┬─────────┬────────────┘
                     │         │
             ┌───────▼───┐ ┌──▼─────────────┐
             │   /media  │ │     /data      │
             │ VPS videos │ │ DB/cache/state │
             └───────────┘ └──┬──────────────┘
                              │
                    ┌─────────┼──────────┐
                    ▼         ▼          ▼
                 SQLite    thumbnails  transcoded
                    │
                    ▼
                 Redis
              sessions/progress
```

### Important

You do **not** need to expose the application's internal port directly to the Internet.

The application listens on port `3000` inside its container.

NGINX can reverse proxy your domain to the Coolify-exposed application port, or you can use Coolify's built-in proxy.

---

# 2. Requirements

You need:

- A Linux VPS
- Coolify installed
- Docker available to Coolify
- A domain/subdomain
- Your video directory on the VPS
- Redis
- Enough disk space for generated thumbnails and transcoded videos
- Enough CPU for FFmpeg when conversion is required

For large libraries, SSD storage is strongly recommended.

---

# 3. Recommended directory layout

For example:

```text
/opt/media/
├── Movies/
├── Anime/
├── TV Shows/
├── Courses/
└── Other/
```

Your actual location can be anywhere.

For example:

```text
/mnt/storage/videos
```

The application does not require the videos to be copied into the Docker image.

The host directory is mounted into the container as:

```text
/media
```

---

# 4. Get the project

You can deploy the project from GitHub, GitLab, a private repository, or another Git source supported by Coolify.

Recommended Git layout:

```text
vps-video-library/
├── Dockerfile
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── README.md
├── .dockerignore
├── .env.example
├── server/
│   └── index.ts
└── client/
    └── src/
        ├── App.tsx
        ├── main.tsx
        └── styles.css
```

---

# 5. Create a persistent data directory/volume

This step is important.

The application stores:

```text
/data/library.db
/data/thumbs/
/data/subtitles/
/data/transcoded/
```

Therefore `/data` must survive container recreation.

If `/data` is not persistent, you will lose:

- users
- favorites
- watch history
- thumbnail cache
- subtitle conversion cache
- transcoding cache

### Recommended Coolify storage

Create a persistent volume for the application and mount it at:

```text
/data
```

Do not mount your media directory at `/data`.

---

# 6. Mount the VPS video directory

In Coolify, open the application's **Storages / Persistent Storage** configuration.

Add a host/bind mount.

Example:

```text
Host path:
/opt/media

Container path:
/media
```

If your videos are here:

```text
/mnt/storage/videos
```

use:

```text
Host path:
/mnt/storage/videos

Container path:
/media
```

### Make the media mount read-only

The application only needs to read videos.

If your Coolify/storage configuration supports a read-only option, enable it.

The application never needs to modify the original media files.

---

# 7. Redis

Redis is required for authentication sessions.

It also stores fast playback state.

Create a Redis service in Coolify.

The application and Redis should be on the same Coolify network/environment so the application can use Redis's internal hostname.

For example:

```env
REDIS_URL=redis://redis:6379
```

The exact hostname may be different depending on the Redis resource name shown by Coolify.

Use the internal Redis connection URL supplied by Coolify.

Do **not** expose Redis publicly.

The application should communicate with Redis internally.

---

# 8. Create the Coolify application

In Coolify:

1. Open your project.
2. Open the desired environment.
3. Click **Create New Resource**.
4. Select **Application**.
5. Select your Git repository.
6. Select the appropriate branch.
7. Select **Dockerfile** as the build pack.
8. Set the base directory to `/` if the Dockerfile is at the repository root.
9. Deploy/configure the application.

Coolify's Dockerfile build pack uses your Dockerfile to build the application image.

---

# 9. Configure the application port

The application listens on:

```text
3000
```

Set Coolify's application port/exposed port to:

```text
3000
```

Do not change the Dockerfile's exposed port unless you also change:

```env
PORT=3000
```

to the new value.

Coolify uses the exposed application port for routing.

---

# 10. Environment variables

Add these to the Coolify application.

```env
NODE_ENV=production

PORT=3000
HOST=0.0.0.0

MEDIA_ROOT=/media
DATA_ROOT=/data

REDIS_URL=redis://redis:6379

ADMIN_USERNAME=admin
ADMIN_PASSWORD=REPLACE_WITH_A_LONG_RANDOM_PASSWORD

SESSION_TTL=2592000

VIDEO_EXTENSIONS=mp4,mkv,webm,m4v,mov,avi,ts,mts,m2ts

THUMB_WIDTH=640
```

### Important

Change:

```env
ADMIN_PASSWORD=REPLACE_WITH_A_LONG_RANDOM_PASSWORD
```

before the first deployment.

Use a long random password.

Example:

```text
not-this-password
```

Do not use a weak password like the example above.

---

# 11. First administrator

On first startup, the application checks SQLite.

If there are no users, it creates:

```text
ADMIN_USERNAME
ADMIN_PASSWORD
```

as the first account.

For example:

```env
ADMIN_USERNAME=tanmay
ADMIN_PASSWORD=<strong random password>
```

After the first successful startup, the account is stored in SQLite.

Changing `ADMIN_PASSWORD` in Coolify later does **not** overwrite the existing database account.

If you forget the password, use the application's password-management/recovery procedure you establish for your deployment rather than deleting the database.

---

# 12. Domain configuration — recommended Coolify method

The simplest setup is to let Coolify's reverse proxy handle the domain.

For example, suppose you want:

```text
https://videos.example.com
```

Create DNS:

```text
Type: A
Name: videos
Value: YOUR_SERVER_IP
```

If using Cloudflare, configure the record appropriately for your setup.

Then in Coolify's domain field use:

```text
https://videos.example.com
```

Coolify supports FQDNs and automatically configures its reverse proxy and HTTPS when an HTTPS domain is configured.

This is the **recommended method** if you do not specifically need a separate NGINX proxy.

---

# 13. If you specifically want NGINX in front

You said you want to use your own NGINX reverse proxy.

In that case the architecture becomes:

```text
Browser
   │
   │ https://videos.example.com
   ▼
NGINX
   │
   │ proxy_pass
   ▼
Coolify application
   │
   │ :YOUR_COOLIFY_PORT
   ▼
VPS Video Library
```

There are two important things to understand.

## Option A — NGINX → host port

If Coolify maps the application to a host port, for example:

```text
127.0.0.1:3210
```

then NGINX can proxy to:

```text
http://127.0.0.1:3210
```

This is the cleanest approach when using a manually managed NGINX.

Configure the application to listen internally on:

```text
3000
```

and map:

```text
3210:3000
```

Only expose that port locally if possible.

Then NGINX uses:

```nginx
proxy_pass http://127.0.0.1:3210;
```

---

# 14. NGINX configuration

Create a server configuration such as:

```text
/etc/nginx/sites-available/videos.example.com
```

Example:

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name videos.example.com;

    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:3210;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;

        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        send_timeout 3600s;
    }
}
```

### Why these settings matter

Video streaming is different from normal websites.

The browser uses:

```text
Range: bytes=...
```

requests to seek through videos.

The application supports these Range requests.

Long timeouts also prevent NGINX from prematurely terminating slow/long video operations.

`proxy_buffering off` prevents NGINX from unnecessarily buffering the streamed response.

---

# 15. Enable the NGINX configuration

On a standard Debian/Ubuntu NGINX installation:

```bash
sudo ln -s /etc/nginx/sites-available/videos.example.com \
/etc/nginx/sites-enabled/videos.example.com
```

Test:

```bash
sudo nginx -t
```

If it says the configuration is valid:

```bash
sudo systemctl reload nginx
```

---

# 16. HTTPS

Do not expose the login page over plain HTTP.

Use HTTPS.

If NGINX is responsible for TLS, you can use Certbot.

Typical setup:

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx
```

Then:

```bash
sudo certbot --nginx -d videos.example.com
```

Follow the prompts.

Afterwards your traffic should be:

```text
https://videos.example.com
```

and NGINX should forward it to the Coolify application.

---

# 17. Cloudflare

If your domain is behind Cloudflare, you can use:

```text
Browser
   ↓ HTTPS
Cloudflare
   ↓ HTTPS
NGINX
   ↓ HTTP
Coolify
```

For a secure setup, preferably use HTTPS between Cloudflare and NGINX as well.

Do not disable authentication just because Cloudflare is protecting the domain.

The application's own authentication remains the actual access control.

---

# 18. Important proxy configuration for video streaming

Make sure your NGINX configuration does not impose a tiny response limit.

Use:

```nginx
client_max_body_size 0;
```

and:

```nginx
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
send_timeout 3600s;
```

The application itself sends:

```text
Accept-Ranges: bytes
```

and handles:

```text
206 Partial Content
```

responses.

This is what allows browser seeking.

---

# 19. How automatic transcoding works

Suppose you upload:

```text
Movie.mkv
```

with:

```text
HEVC / H.265
10-bit video
DTS audio
```

and the current browser cannot decode it.

The application does:

```text
Movie.mkv
     │
     ▼
ffprobe
     │
     ├── Browser-compatible? ── YES ──► Direct stream
     │
     └── NO
          │
          ▼
       FFmpeg
          │
          ▼
 Browser-specific cached format
```

For Safari/iPhone:

```text
H.264
AAC
MP4
```

For Chromium/Firefox:

```text
VP9
Opus
WebM
```

The converted file is cached in:

```text
/data/transcoded/
```

---

# 20. Why we cache transcoded files

Without caching, this would happen:

```text
Open video
    ↓
FFmpeg starts
    ↓
watch

Close video

Open again
    ↓
FFmpeg starts again
```

That would waste CPU continuously.

Instead:

```text
First play
   ↓
FFmpeg
   ↓
/data/transcoded/<hash>.mp4
```

Next play:

```text
Open video
   ↓
Cached file
   ↓
Instant streaming
```

If the source video's:

- path
- size
- modification time
- browser target profile

changes, a new cache key is generated.

---

# 21. Transcoding CPU considerations

This feature is intentionally CPU-heavy when a file needs conversion.

For example, converting:

```text
4K HEVC → 1080p H.264
```

can consume significant CPU.

The current implementation preserves the source resolution.

Therefore a 4K source may become a 4K H.264 file.

For a future optimization, you can add profiles such as:

```text
1080p
720p
480p
```

and adaptive streaming using HLS/DASH.

That would be the next major evolution if your library contains many 4K videos.

---

# 22. Transcoding storage

Transcoded files can become large.

Example:

```text
Original:
10 GB MKV

Generated:
6 GB MP4
```

The original remains untouched.

The cache may therefore consume additional storage.

Monitor:

```bash
du -sh /path/to/coolify-data
```

and specifically:

```bash
du -sh /data/transcoded
```

Do not manually delete `/data/library.db`.

If you need to reclaim transcoding storage, the files under:

```text
/data/transcoded/
```

can be deleted. They will be regenerated when required.

Likewise thumbnails can be regenerated.

---

# 23. Thumbnail generation

When a video appears in the UI:

```text
/api/thumb?path=...
```

the application checks the thumbnail cache.

If it doesn't exist:

```text
FFmpeg
   ↓
first suitable frame
   ↓
JPEG
   ↓
/data/thumbs/
```

The thumbnail is then reused.

---

# 24. Subtitles

Matching subtitles can be placed next to the video.

Example:

```text
Anime/
└── Episode 01/
    ├── Episode 01.mkv
    ├── Episode 01.en.srt
    ├── Episode 01.hi.srt
    └── Episode 01.ja.vtt
```

The player detects them automatically.

The CC menu will show:

```text
CC Off
EN
HI
JA
```

SRT files are converted to WebVTT automatically because browsers natively consume WebVTT through the HTML video track API.

---

# 25. Episode detection

The application understands:

```text
Show.S01E01.mkv
Show.S01E02.mkv
Show.S01E03.mkv
```

and:

```text
Show.1x01.mkv
Show.1x02.mkv
```

and:

```text
Episode 01.mkv
Episode 02.mkv
```

Episodes are sorted by:

```text
Season
   ↓
Episode
```

The player also provides:

```text
Previous
Current episode
Next
```

---

# 26. Continue Watching

Playback progress is saved approximately every 10 seconds and when the video pauses/leaves.

The database records:

```text
video
position
duration
last watched time
completed state
```

Redis additionally holds the fast resume state.

A video is considered completed around the final 5% of its duration.

Completed videos therefore disappear from Continue Watching while remaining in Watch History.

---

# 27. Favorites

Favorites are stored in SQLite.

They are tied to the authenticated user:

```text
User A
 ├── Favorite 1
 └── Favorite 2

User B
 ├── Favorite 3
 └── Favorite 4
```

This means adding multiple users later does not require redesigning the database.

---

# 28. Authentication security

The application uses:

- bcrypt password hashing
- random session tokens
- Redis session storage
- HttpOnly cookies
- SameSite cookies
- Secure cookies in production
- login rate limiting

The media endpoints require authentication too.

That includes:

```text
/stream
/api/thumb
/subtitles
/api/*
```

So someone cannot simply discover the media URL and bypass the login.

---

# 29. Firewall

If NGINX is directly handling the domain, you generally only need:

```text
80
443
```

publicly accessible for the website.

The Coolify application port should preferably not be publicly exposed if NGINX is the only intended entry point.

For example:

```text
Internet
  ↓
443
  ↓
NGINX
  ↓
127.0.0.1:3210
  ↓
Coolify
  ↓
container:3000
```

This is preferable to:

```text
Internet
  ↓
3210
  ↓
Coolify
```

because the latter exposes the application directly.

---

# 30. Verify the application

After deployment, first check:

```text
https://videos.example.com
```

You should see the login page.

Log in using:

```text
ADMIN_USERNAME
ADMIN_PASSWORD
```

Then check:

### Library

Your `/media` contents should appear.

### Thumbnail

Open a video folder and wait for thumbnails.

### Player

Open a video.

### Resume

Watch for a while, close it, reopen it.

It should resume near the previous position.

### Favorite

Click:

```text
♡ Add to favorites
```

Then open Favorites.

### History

Open:

```text
Watch History
```

### Subtitle

Put an `.srt` next to a video and reopen the video.

The CC selector should appear.

### Transcoding

Use a browser-incompatible video.

The first play should trigger FFmpeg.

Check the application logs:

```text
[transcode] ...
```

Then play it again.

The second playback should use the cached conversion.

---

# 31. Check container logs

In Coolify, open:

```text
Application → Logs
```

You should see something similar to:

```text
VPS Video Library v3 listening on 0.0.0.0:3000
[auth] created initial user: admin
```

When transcoding occurs:

```text
[transcode] Movies/example.mkv -> safari-h264
```

or:

```text
[transcode] Anime/example.mkv -> chromium-vp9
```

---

# 32. Useful VPS checks

Check disk:

```bash
df -h
```

Check media size:

```bash
du -sh /your/media/path
```

Check transcoding cache:

```bash
du -sh /path/to/coolify-data/transcoded
```

Check thumbnails:

```bash
du -sh /path/to/coolify-data/thumbs
```

Check Docker:

```bash
docker ps
```

Check NGINX:

```bash
sudo nginx -t
```

---

# 33. Troubleshooting

## Login says Redis unavailable

Check:

```env
REDIS_URL=redis://redis:6379
```

and make sure the Redis service is running.

The Redis hostname must be the internal Coolify service hostname.

---

## Library is empty

Check the mount.

Inside the container, `/media` should contain your videos.

Use the Coolify terminal and run:

```bash
ls -lah /media
```

Then:

```bash
find /media -maxdepth 2 -type f | head
```

If nothing appears, your storage mount is incorrect.

---

## Thumbnail doesn't appear

Check FFmpeg:

```bash
ffmpeg -version
```

The supplied Dockerfile installs FFmpeg automatically.

---

## Video keeps transcoding

Check:

```bash
du -sh /data/transcoded
```

If `/data` isn't persistent, every container recreation will remove the cache.

Make sure `/data` is a persistent Coolify storage volume.

---

## Video starts but seeking doesn't work

Check that NGINX contains:

```nginx
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
```

The application supports HTTP Range requests.

---

## 502 Bad Gateway

Check:

```bash
sudo nginx -t
```

Then verify that your Coolify host port is actually listening:

```bash
ss -lntp
```

For example, if NGINX uses:

```nginx
proxy_pass http://127.0.0.1:3210;
```

then port `3210` must be mapped to the application's container port `3000`.

---

# 34. Recommended production layout

For your use case, I recommend:

```text
                    videos.yourdomain.com
                              │
                              ▼
                         Cloudflare
                              │
                              ▼
                         NGINX :443
                              │
                              ▼
                     127.0.0.1:3210
                              │
                              ▼
                    Coolify application
                              │
                  ┌───────────┼───────────┐
                  ▼           ▼           ▼
               /media       /data       Redis
                  │           │
                  │       ┌───┼────┐
                  │       ▼   ▼    ▼
                  │      DB thumbs transcodes
                  │
             Your original
               videos
```

This keeps the media directory outside the application image, keeps application state persistent, and prevents Redis from being exposed publicly.

---

# 35. Important performance recommendation

For a large library, do **not** pre-convert every video.

That could consume hundreds of GB or even TB.

Use the current cache-on-demand approach:

```text
Video requested
      ↓
Is browser compatible?
   ↙       ↘
 YES       NO
  ↓         ↓
Direct    Convert
stream      ↓
          Cache
            ↓
          Stream
```

This means you only spend CPU/storage on videos that you actually watch.

---

# 36. Future upgrade path

The next major improvement after this version would be:

```text
HLS / MPEG-DASH
+
1080p / 720p / 480p
+
adaptive bitrate
+
hardware acceleration
```

That would allow:

```text
4K original
     │
     ├── 1080p
     ├── 720p
     └── 480p
          ↓
    Adaptive streaming
          ↓
     Browser chooses
     appropriate quality
```

That is significantly better than converting an entire 4K file to another full-resolution file, especially when watching from an iPhone or over a slower connection.

---

# 37. Final deployment checklist

Before going live:

- [ ] Git repository created
- [ ] Coolify application created
- [ ] Dockerfile build pack selected
- [ ] Application port set to `3000`
- [ ] Redis service created
- [ ] `REDIS_URL` configured
- [ ] `/media` mounted to the actual video directory
- [ ] `/data` mounted as persistent storage
- [ ] Strong `ADMIN_PASSWORD` configured
- [ ] Application deployed successfully
- [ ] Login works
- [ ] Library appears
- [ ] Thumbnails generate
- [ ] Video plays
- [ ] Seeking works
- [ ] Continue Watching works
- [ ] Favorites work
- [ ] History works
- [ ] Subtitles work
- [ ] Transcoding works
- [ ] Transcoded cache persists
- [ ] Domain DNS points to the correct server
- [ ] NGINX configured if using external NGINX
- [ ] HTTPS configured
- [ ] Ports 80/443 available
- [ ] Application port not unnecessarily exposed publicly
- [ ] Redis not exposed publicly
- [ ] Media mount is read-only where possible

---

## Coolify documentation references

Coolify's current documentation confirms that Dockerfile applications can use a custom Dockerfile, that the application port must match the port the container listens on, and that persistent storage/environment variables are configured through the application settings. citeturn0search0turn0search2

Coolify also supports assigning FQDNs directly to applications and automatically configuring HTTPS through its reverse proxy. citeturn0search1turn0search6

If you use a separate NGINX instance as described above, keep the application port private where practical and expose only the NGINX HTTP/HTTPS endpoints. citeturn0search8
