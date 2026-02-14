# Local LiveKit Meet Setup (macOS)

## 1) Clone the official Meet sample
```bash
cd /Users/ankur.garg1/Documents/LivestreamBot
git clone https://github.com/livekit-examples/meet livekit-meet-local
cd livekit-meet-local
```

## 2) Start a local LiveKit server in dev mode
Preferred (if Homebrew is available):
```bash
brew install livekit
livekit-server --dev
```

Fallback used here (no Homebrew/sudo): build from source with local Go, then run `livekit-server --dev`.
```bash
cd /Users/ankur.garg1/Documents/LivestreamBot
mkdir -p .local bin .local/bin
curl -L 'https://go.dev/dl/go1.26.0.darwin-arm64.tar.gz' -o /tmp/go1.26.0.darwin-arm64.tar.gz
tar -C .local -xzf /tmp/go1.26.0.darwin-arm64.tar.gz
PATH="$PWD/.local/go/bin:$PATH" GOBIN="$PWD/bin" go install github.com/livekit/livekit-server/cmd/server@v1.9.11
ln -sf "$PWD/bin/server" "$PWD/.local/bin/livekit-server"
PATH="$PWD/.local/bin:$PATH" livekit-server --dev
```

`livekit-server --dev` uses:
- API key: `devkey`
- API secret: `secret`
- HTTP: `http://localhost:7880`

## 3) Install Meet dependencies
```bash
cd /Users/ankur.garg1/Documents/LivestreamBot/livekit-meet-local
corepack pnpm install
```

## 4) Configure environment
```bash
cp .env.example .env.local
```

Final `.env.local` keys:
```env
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_URL=ws://localhost:7880
```

## 5) Run the Meet app
```bash
corepack pnpm dev
```
Open: http://localhost:3000

## 6) Quick local verification
- Open the same room URL in 2 browser tabs.
- Allow mic/camera in both tabs.
- Confirm each tab sees/hears the other participant.

CLI smoke checks used:
- `GET http://localhost:3000` -> `200`
- `GET /api/connection-details?roomName=localtest&participantName=tab1` -> `200` with token JSON
- `GET http://localhost:7880/` -> `OK`
