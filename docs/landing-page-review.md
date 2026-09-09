# Public landing page — review record

Win condition: existing accepted beach group-photo hero, supporting generated portraits, truthful Bunch explanation, top-right sign-in, readable desktop/mobile, deployed on system.thearcades.me.

One implementation pass, then a correction for an inherited dark-theme headline color. Landing styles are scoped beneath `.bunch-landing`; private-app styles and authorization stay intact.

Anonymous `/` shows the landing page. Existing authenticated users retain CatchUpCommandCenter at `/`. `/welcome` always presents the public page for review while signed in. Sign-in uses the existing `/auth/login` route. Production demo mode is false. No registration, database, or account policy changes.

Assets copied without edits: accepted group photo from writing-archive/blog/arcadesblog/assets/bunch-the-lineup.jpg; Addie portrait from Downloads/addie.jpg; Lucy portrait from 2026-09-02/f/outputs/lucy-profile-avatar-v1.png. User explicitly approved existing generated artwork for the page.

Copy grounded in current Bunch MCP, profile, catch-up and presence implementation. Hosting responsibility remains separate from overlapping fronting presence.

Validation: desktop 1440px and mobile 390px, all images loaded, no horizontal overflow, keyboard skip link first, section navigation works. Headline corrected to rgb(33,37,31). Existing login endpoint redirects to Auth0 Google sign-in. Initial Vercel production build and TypeScript passed. Final corrected build and hosted verification recorded in task handoff.
