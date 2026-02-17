<a href="https://livekit.io/">
  <img src="./.github/assets/livekit-mark.png" alt="LiveKit logo" width="100" height="100">
</a>

# LiveKit Meet

<p>
  <a href="https://meet.livekit.io"><strong>Try the demo</strong></a>
  •
  <a href="https://github.com/livekit/components-js">LiveKit Components</a>
  •
  <a href="https://docs.livekit.io/">LiveKit Docs</a>
  •
  <a href="https://livekit.io/cloud">LiveKit Cloud</a>
  •
  <a href="https://blog.livekit.io/">Blog</a>
</p>

<br>

LiveKit Meet is an open source video conferencing app built on [LiveKit Components](https://github.com/livekit/components-js), [LiveKit Cloud](https://cloud.livekit.io/), and Next.js. It's been completely redesigned from the ground up using our new components library.

![LiveKit Meet screenshot](./.github/assets/livekit-meet.jpg)

## Tech Stack

- This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).
- App is built with [@livekit/components-react](https://github.com/livekit/components-js/) library.

## Demo

Give it a try at https://meet.livekit.io.

## Dev Setup

Steps to get a local dev setup up and running:

1. Run `pnpm install` to install all dependencies.
2. Copy `.env.example` in the project root and rename it to `.env.local`.
3. Update the missing environment variables in the newly created `.env.local` file.
4. Run `pnpm dev` to start the development server and visit [http://localhost:3000](http://localhost:3000) to see the result.
5. Start development 🎉

## GitHub Auto Deploy (EC2)

This repo includes `.github/workflows/deploy-ec2.yml` to auto-deploy on pushes to `main`.

Set these repository secrets in GitHub:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `DEPLOY_BUCKET`
- `EC2_INSTANCE_ID`

Deploy flow:

1. GitHub Actions builds the app.
2. Uploads `.next` and selected app files to `s3://$DEPLOY_BUCKET/ui-update/`.
3. Triggers AWS SSM on the EC2 instance to sync artifacts and restart `bristlecone-app.service`.

## Interview Recording To S3

The app includes recording APIs backed by LiveKit Egress:

- `POST /api/record/start?roomName=<room>`
- `POST /api/record/stop?roomName=<room>`
- `GET /api/record/status?roomName=<room>`

Recording output is written as MP4 into S3.

Required env (server):

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `RECORDING_S3_BUCKET` (or legacy `S3_BUCKET`)

Optional env:

- `RECORDING_S3_REGION`
- `RECORDING_S3_ENDPOINT`
- `RECORDING_S3_PREFIX` (default: `recordings`)
- `RECORDING_LAYOUT` (default: `speaker`)
- `RECORDING_LIVEKIT_URL` (optional egress-control URL, e.g. `http://127.0.0.1:7880`)
- `RECORDING_S3_ACCESS_KEY_ID` / `RECORDING_S3_SECRET_ACCESS_KEY`
  (not required when EC2 IAM role already has S3 write permissions)

Frontend toggles:

- `NEXT_PUBLIC_LK_RECORD_ENDPOINT=/api/record`
- `NEXT_PUBLIC_AUTO_RECORD_INTERVIEW=true` to auto start/stop recording on room connect/disconnect

## EC2 Lease Mode (Auto Stop)

To avoid leaving EC2 running for long periods, use lease scripts in `ops/`:

- `ops/ec2-lease-start.sh`: starts EC2, restores services, and arms auto-stop (default `120` minutes)
- `ops/ec2-lease-stop.sh`: stops EC2 immediately
- `ops/ec2-lease-status.sh`: shows instance + lease timer status

Examples:

```bash
cd livekit-meet-local
LEASE_MINUTES=120 ./ops/ec2-lease-start.sh
./ops/ec2-lease-status.sh
./ops/ec2-lease-stop.sh
```

Notes:

- Scripts auto-read `/tmp/bristlecone_deploy_vars` when present.
- Auto-stop is implemented on EC2 via a transient systemd timer (`bristlecone-auto-stop`).
