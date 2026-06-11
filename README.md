# Manhunt — location-based tag for mobile browsers

A production-ready, mobile-first PWA implementing Manhunt/Infected for 15–30 players inside a geofenced area. Built with Next.js 14 (App Router) + TypeScript, Supabase Postgres, Supabase Realtime broadcast, Leaflet/OpenStreetMap.

**To deploy without writing code, follow [DEPLOYMENT.md](./DEPLOYMENT.md).**

## How a game works

1. Host opens `/new`, names the game, draws a geofence (circle, polygon, or preset), sets duration, ping interval, hunter count, capture range, decoys, and out-of-bounds penalty.
2. Players join via room code or shared link. Host starts; roles are assigned randomly.
3. Every ping interval, hunters receive survivor positions (fuzzed — see balance) and survivors receive hunter positions. No real-time tracking; survivors never see each other.
4. A hunter who physically tags a survivor taps **Capture**, showing a QR code (with a 6-character backup code). The tagged survivor scans it. The server verifies the capture (see below) and the survivor becomes a hunter immediately — their UI re-skins red, all survivors are notified and receive a fresh hunter ping.
5. Hunters win if every survivor is infected before the timer ends; survivors win if at least one remains.

## Architecture

```
Phones (PWA) ── HTTPS ──> Next.js API routes (Vercel) ──> Supabase Postgres
      ▲                                 │
      └── Supabase Realtime broadcast ◄─┘  (data-free "wake" signals)
```

- **No separate server or worker.** Game ticks run "lazily": every location update and state fetch checks whether a ping round is due; an atomic conditional `UPDATE` on `games.next_ping_at` guarantees exactly one request executes each round. With 15–30 phones posting location every ~20 s, rounds fire within seconds of being due.
- **Realtime without leaking data.** The server broadcasts an empty "update" signal on `game:{id}`; clients then fetch `/api/games/{id}/state`, where visibility rules are enforced server-side. A cheater sniffing the channel learns nothing. Clients also poll every 10 s as a fallback.
- **Sessions** are bearer tokens (one per player per game) stored in `localStorage`, sent as `x-player-token`. Rejoining resumes the same player and role.
- **RLS is enabled with no policies** on all tables, so the public anon key cannot read game data; only API routes (service role) touch the database.

## Capture verification (not simple proximity)

A capture requires **all** of:

1. **Physical co-presence:** the hunter's phone displays a rotating, single-use, 120-second QR token; the survivor's phone must scan it (or type the 6-char backup code). QR scanning range is ~arm's length, which is the real proximity test.
2. **GPS cross-check:** both phones must have a location fix fresher than 2 minutes, inside the fence, and within the configured capture radius of each other (plus reported GPS accuracy, capped at 50 m slack) — this defeats remote code-sharing over a phone call.
3. **Token integrity:** tokens are single-use, expire in 120 s, and are bound to the specific game and hunter.

This combination minimises GPS error (GPS is only a sanity band, not the trigger), works outdoors on any modern phone (camera + browser), and needs no BLE/NFC permissions, which are unreliable or unavailable in mobile browsers.

**Known limitation:** a tagged survivor can refuse to scan. Mitigations: it's visible refereeing (the hunter is standing next to them), the backup typed code removes "my camera is broken" excuses, and hosts can adopt the table rule that refusal = forfeit. Fully unattended enforcement is not possible in a browser.

## Game balance — recommendation: Option C + light Option B

Implemented and enabled by default:

- **Option C (dynamic information scaling):** survivor pings shown to hunters are exact in the first third of the match, fuzzed to a ~150 m zone in the middle third, and ~400 m in the final third. As the hunter team snowballs, their information degrades, so the last survivors get a genuine endgame instead of a pile-on.
- **Option B (lite):** each survivor gets a configurable number of decoy pings (default 2). Arming a decoy substitutes a false position into the next hunter ping round, indistinguishable from a real ping.

Why this over the alternatives: Option A (degrading frequency/precision by hunter count) punishes hunters for succeeding in a way that feels arbitrary and is hard to tune across player counts; Option D (objectives/safe zones) is the most fun ceiling but requires per-venue content authoring, which conflicts with "host sets up a game in two minutes". C is automatic, predictable, and scales with match progress rather than team size; the decoy ration adds survivor agency without UI or moderation overhead. D can be layered on later.

## Anti-cheat

| Threat | Mitigation | Residual risk |
|---|---|---|
| GPS spoofing / mock locations | Speed gate (updates implying >15 m/s rejected and flagged), accuracy >150 m rejected, capture requires mutual QR scan so teleporting can't score captures | Sophisticated slow-drift spoofing undetectable in a browser |
| Reading other players' data | All visibility computed server-side; realtime channel carries no data; RLS blocks anon key | — |
| Leave/rejoin for fresh info | Token resumes the same player; state returns only the current ping round | — |
| Multiple devices | One token per player; a second join is a second player slot, visible in the roster | Social enforcement |
| Hiding outside the fence | 45 s grace, then configurable penalty: warning broadcast, position revealed to the opposing team each round, or instant infection | — |
| Deliberate disconnects | Last known position remains in ping rounds; stale (>3 min) fixes are marked | Can't force a phone on |

## Project layout

```
supabase/schema.sql        run once in Supabase SQL editor
src/lib/server/engine.ts   tick loop, ping rounds, infection, win conditions, fence penalties
src/lib/server/*           db client, auth, realtime broadcast
src/app/api/**             REST API (create/join/start/location/state/capture/decoy/leave)
src/app/page.tsx           join screen      /new  host setup      /game/[code]  lobby+game
src/components/*           Leaflet map, fence editor, QR show/scan, timer
public/sw.js               offline shell (never caches /api)
```

## Local development

```bash
npm install
cp .env.example .env.local   # fill in Supabase keys
npm run dev
```

Note: browsers only grant geolocation on HTTPS or localhost. Real multi-phone testing needs the deployed URL.

## Limitations

- **Notifications are in-app** (toasts + vibration), not OS push. Web push on iOS requires an installed PWA and per-user opt-in flows that don't fit a pick-up game; every meaningful event also rides the realtime channel and the 10 s poll, so players are notified while the app is open — which it is, during play.
- Battery: continuous `watchPosition` for a 60–90 min game is the expected cost; updates are throttled to one POST per 20 s.
