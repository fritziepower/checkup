# checkup ♡

A cute pixel-terminal daily weigh-in app for iPhone. It runs in Safari and can be added to the Home Screen, where it opens full-screen like a normal app and works offline.

## Features
- Log your weight every morning (kg or lb)
- Tick **on my period 🩸** and **pooped yesterday 💩**
- Daily progress photo: **take photo** opens the in-app camera (front/back flip, 3s/10s timer, and a "ghost" overlay of your last photo so you can line up your pose). **from library** picks from Photos.
- Graph with 7d / 30d / 90d / all ranges: the line turns **red on period days** and an **\*** marks days you pooped the day before. Tap the graph to see a day's details.
- Stats (latest, change vs 1 week, total change, streak), optional goal line
- Photo gallery with swipe-through viewer, history list with edit/delete
- Backup export/import (includes photos)

## Privacy
Everything is stored **only on your phone** (IndexedDB). Nothing is uploaded anywhere. Use Settings ⚙ → **export backup** now and then: if you delete the Home Screen app, its data goes with it.

## Install on iPhone
1. Open the app URL in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open it from the Home Screen icon and allow camera access the first time you take a photo.

## Hosting
The app is plain static files (no build step). `.github/workflows/pages.yml` deploys it to GitHub Pages on every push to `main`.
Enable it once: repo **Settings → Pages → Source: GitHub Actions**.
(GitHub Pages on a *private* repo needs a paid GitHub plan; otherwise make the repo public, or drag the folder onto https://app.netlify.com/drop.)

The camera only works over **https** (GitHub Pages / Netlify are https).

## Local preview
```
python3 -m http.server 8000
```
then open http://localhost:8000.
