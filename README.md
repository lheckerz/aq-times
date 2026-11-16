# The AQ Times

Newspaper-style news and announcements app for the AQ Smash / AQ sports community.

- `/` — member app (front page, updates, news, area settings). Installable to the phone home screen.
- `/admin` — admin app (post announcements with buttons and images, manage, news desk, ticker, live feed, AQ suggests).

Static site, no build step. Data, admin sign-in, image storage and live updates run on Supabase project **AQ Times** (`phucvubabltiicbyynxj`, Singapore). The `link-preview` edge function reads a web link's image, title and summary for admins.

Deploy: import this repo in Vercel with no framework, no build command.
