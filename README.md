# Mythbound

A free-to-play, Link-style hold & spin slot game with a mythic beasts theme. Play money only: nothing can be bought or cashed out.

**Play:** https://watsononlineventures-cell.github.io/Mythbound/

## Install on your phone

- **iPhone (Safari):** open the link, tap **Share**, then **Add to Home Screen**.
- **Android (Chrome):** open the link, tap the **⋮** menu, then **Install app** (or **Add to Home screen**).

After the first visit everything is saved on the device, so it plays offline and launches full screen like an app. New versions download in the background and load the next time the game is idle.

## Develop

```
npm install
npm run dev        # local dev server
npm test           # math unit tests
npm run sim:check  # 10M-spin RTP check (target 97.5–98.5%)
npm run build      # production build in dist/ (with the offline service worker)
```

Math lives in `src/math` (pure, simulated in `sim/`), the game screens in `src/app`, art in `public/art`, sound and music in `public/sfx`.
