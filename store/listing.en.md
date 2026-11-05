# Chrome Web Store listing — English

Copy each block into the matching field of the developer dashboard. The name
and the summary come from the manifest and cannot be edited there.

## Name (manifest, 55 characters)

BnBridge – Bridge your rates across platforms and years

## Summary (manifest description, 132 characters max)

Export, import and carry over your Airbnb and Vrbo calendar prices, from one platform to another and from one year to the next.

## Category

Productivity › Workflow & Planning

## Detailed description

BnBridge is a side panel for hosts who set their own nightly rates on Airbnb and Abritel / Vrbo. It reads your calendar, keeps your prices in a file you own, and writes them back where you want them: on the other platform, or on next year's calendar, with the school holidays moved to their new dates.

No API, no subscription, no account. The extension works inside your own session, on the calendar page you already have open, at a human pace, exactly the way you would do it by hand, only without the five hundred clicks.

WHAT IT DOES

• Read a whole year of prices, night by night, into a grid you can read at a glance.
• Export the prices to a .bnbprices file (plain JSON), and import such a file on another listing or another platform.
• Carry a year over to the next: the prices of year N are turned into rules per period (Christmas, winter zone A, summer, outside holidays…) and applied to the matching dates of year N+1, which never fall on the same days. Saturdays, or any days you choose, keep their own rate.
• Never overwrite a price you customised by hand, unless you ask for it: only nights still at the base price are changed.
• Preview before anything is written: every night appears in the colour of the rate it will get, nights already right and nights kept as they are stand apart, and the rules inferred from the source year are listed in detail.
• Apply everything, or only a selection: click or drag on the grid to choose nights. The rest can be applied later without a new preview.
• Pause or stop at any time. Each operation is checked on the calendar before the next one starts, and the log keeps a trace of everything.
• Interface in English and French, following Chrome's language or your own choice.

SUPPORTED SITES

• Airbnb, the host multicalendar (airbnb.fr and airbnb.com).
• Abritel / Vrbo, the owner calendar (abritel.fr and vrbo.com).

School and public holidays come from the French open data (Éducation nationale and calendrier.api.gouv.fr), so the year-to-year carry-over is tuned for listings in France.

PRIVACY

BnBridge talks only to the calendar page open in your browser and to the two public holiday APIs. Your prices stay in your browser's local storage and in the files you export. Nothing is sent to us or to anyone else, there is no account and no tracking. Full policy: https://github.com/Gizmo091/bnb-calendar-prices-sync/blob/main/PRIVACY.md

BnBridge is an independent project. It is not affiliated with, endorsed by or connected to Airbnb, Abritel, Vrbo or Expedia Group. The sites' interfaces change; if a step fails, the extension stops without writing and tells you what it saw in the log.

## Single purpose (privacy tab)

Read, export, import and apply the nightly prices of a vacation rental calendar on Airbnb and Abritel / Vrbo, including carrying one year's prices over to the next.

## Permission justifications (privacy tab)

storage — Keeps the prices read for a listing, the base price and the user's settings (factor, rounding, special days, language, log visibility) in the browser, so the panel can resume where it left off.

sidePanel — The whole interface lives in Chrome's side panel, next to the calendar it works on.

Host permissions airbnb.fr, airbnb.com, abritel.fr, vrbo.com — The content script reads the calendar displayed on these sites and fills in the price form on the user's behalf. No other site is touched.

Content scripts — Loaded only on the sites above; they answer the side panel's requests (read the calendar, apply a price) and do nothing on their own.

Remote code — None. All code ships in the package.

## Data usage (privacy tab)

Data collected: Website content (the prices and booking status shown on the user's own calendar). It is stored locally in the browser and in files the user exports. It is never transmitted to the developer or to third parties.

Certifications: not sold to third parties, not used for purposes unrelated to the item's single purpose, not used to determine creditworthiness or for lending purposes.

Privacy policy URL: https://github.com/Gizmo091/bnb-calendar-prices-sync/blob/main/PRIVACY.md
