# Dhiren Pathak Present Musical Housie

A real-time multiplayer Musical Housie (Music Bingo) web application built with React, TypeScript, Tailwind CSS, Express, Firebase Firestore, Firebase Anonymous Authentication, and the official YouTube IFrame Player API.

## Architecture Overview
- **Zero Third-Party Developer Credentials Needed**: Works out of the box with Public and Unlisted YouTube playlist links (desktop or mobile YouTube app links) — no Google OAuth Client ID/Secret, YouTube API Key, or Spotify credentials required.
- **Anonymous Joining**: Players and hosts join with just a name via Firebase Anonymous Authentication.
- **Zero-Spoiler & Server-Verified Wins**: Unrevealed songs and the secret queue live in `rooms/{roomId}/hostState/secret` (host-only in `firestore.rules`), and all claims are validated independently on the server via `/api/game/verify-claim`.

---

## 1. Firebase Setup

1. Ensure `firebase-applet-config.json` contains your Firebase web app config.
2. Enable **Cloud Firestore** and **Authentication → Sign-in method → Anonymous** in Firebase Console.
3. Deploy `firestore.rules` when updated.

---

## 2. Local Development & Build

```bash
npm install
npm run dev
```

Runs the Express + Vite server on port `3000`.

```bash
npm run lint
npm run build
```
