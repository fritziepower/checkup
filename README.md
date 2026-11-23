# checkup ♡

A cute pixel-terminal daily weigh-in app for iPhone. It runs in Safari and can be added to the Home Screen, where it opens full-screen like a normal app and works offline.

## Features
- Log your weight every morning (kg or lb)
- Tick **on my period 🩸** and **pooped yesterday 💩**
- Daily progress photo: **take photo** opens the in-app camera (front/back flip, 3s/10s timer, and a "ghost" overlay of your last photo so you can line up your pose). **from library** picks from Photos.
- Graph with 7d / 30d / 90d / all ranges: the line turns **red on period days** and an **\*** marks days you pooped the day before. Tap the graph to see a day's details.
- **Trend line**: a smooth 7-day average drawn over the daily dots. It's the headline number in stats, so normal day-to-day water swings don't scare you
- **Cycle insights**: cycle day, predicted next period (dashed box on the graph), average cycle/period length, how much water weight the 5 days before your period add, and this cycle vs last cycle on the same days
- **Before/after compare**: pick any two photo days, side-by-side or slider, and save it as a cute "glow up" image
- **Weekly recap**: on Sundays a recap card pops up (days logged, avg weight vs last week, trend, period/poop days, photos, plus a sticker). Open it any day from the stats card.
- **Pixel pet**: name it in settings. It hatches from an egg and grows (baby → bun → fancy with a bow → queen with a crown → legendary) as your best streak grows; it never shrinks. Earn a sticker for every 7-day streak.
- **Themes**: pink, mint, lavender and night (dark)
- Stats (trend, weekly change, total change, streak), optional goal line
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
