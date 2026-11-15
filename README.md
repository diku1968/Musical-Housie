# Musical Housie

A real-time multiplayer Musical Housie (Music Bingo) web application built with React, TypeScript, Tailwind CSS, Express, Firebase Firestore, Firebase Anonymous Authentication, the official YouTube IFrame Player API, and Spotify OAuth + Embed integration.

## Security & Credential Architecture
- **Application Owner Credentials Only**: `YOUTUBE_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`, and `GOOGLE_OAUTH_CLIENT_SECRET` live exclusively in server-side environment secrets and are never exposed to the browser or stored in Firestore.
- **Zero Developer Setup for Hosts or Players**: Any host can create a room with just their name and paste a YouTube or Spotify playlist URL without entering API keys or client credentials.
- **Per-Host OAuth Isolation**: Optional host OAuth sessions (Spotify Authorization Code + PKCE for private Spotify playlists, Google/YouTube Authorization Code + PKCE for private YouTube playlists) are stored in server memory, bound to the host's verified Firebase UID, and accessed via `HttpOnly; Secure; SameSite=None` cookies. Refresh tokens are never sent to the browser.
- **Zero-Spoiler & Server-Verified Wins**: Unrevealed songs and the secret queue live in `rooms/{roomId}/hostState/secret` (host-only in `firestore.rules`), and claims are verified server-side via `/api/game/verify-claim`.

---

## 1. Firebase Setup

1. Create or open a Firebase project in the [Firebase Console](https://console.firebase.google.com/).
2. Enable **Cloud Firestore** and **Authentication → Sign-in method → Anonymous** (enable and save).
3. Ensure `firebase-applet-config.json` in the project root contains your Firebase web app config (`projectId`, `appId`, `apiKey`, `authDomain`, and optional `firestoreDatabaseId`).
4. Deploy `firestore.rules`:
   ```bash
   firebase deploy --only firestore:rules
   ```

---

## 2. Application Owner API Credentials (Server Environment Secrets)

### YouTube
- **`YOUTUBE_API_KEY`** *(recommended)*: Enable **YouTube Data API v3** in [Google Cloud Console](https://console.cloud.google.com/apis/library) and set `YOUTUBE_API_KEY` in server secrets so hosts can load public/unlisted playlists up to 200 embeddable songs. *(Without `YOUTUBE_API_KEY`, public playlists fall back to the official YouTube IFrame Player + `/api/youtube/oembed`.)*
- **`GOOGLE_OAUTH_CLIENT_ID` & `GOOGLE_OAUTH_CLIENT_SECRET`** *(optional, for private YouTube playlists)*:
  - Create a Web OAuth 2.0 Client in Google Cloud Console with scope `https://www.googleapis.com/auth/youtube.readonly`.
  - Add your exact Redirect URI(s):
    - `https://<your-app-domain>/auth/youtube/callback`
    - `http://localhost:3000/auth/youtube/callback` (local dev)

### Spotify
- **`SPOTIFY_CLIENT_ID` & `SPOTIFY_CLIENT_SECRET`** *(required for Spotify playlist import)*:
  - Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
  - Public playlists work automatically using server-side Client Credentials authorization; private playlists prompt the host to connect their Spotify account via Authorization Code + PKCE.
  - Add your exact Redirect URI(s):
    - `https://<your-app-domain>/auth/spotify/callback`
    - `http://localhost:3000/auth/spotify/callback` (local dev)

---

## 3. Local Development

```bash
npm install
npm run dev
```

Runs the Express + Vite server on `http://localhost:3000`.

### Linting & Build Checks
```bash
npm run lint
npx eslint firestore.rules
npm run build
```

---

## 4. Deployment (Google Cloud Run / Node)

1. Build the frontend bundle:
   ```bash
   npm run build
   ```
2. Start the production server on port `3000`:
   ```bash
   NODE_ENV=production npm start
   ```
3. Configure server environment secrets (`APP_URL`, `YOUTUBE_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`).
