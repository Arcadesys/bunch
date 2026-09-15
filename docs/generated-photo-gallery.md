# Generated photo gallery

`/gallery/generated` is the private gallery for completed images from both Images and Group Photo. It is linked from the main navigation and both creation pages; profile photos remain available at `/gallery`.

The owner-authenticated, read-only `GET /api/v1/generated-images` returns 24 completed images at a time, newest first. A cursor retains PostgreSQL timestamp precision and uses source kind and ID to break ties. It returns authenticated image routes, never storage keys or image bytes, and does not start or retry generation. No migration or provider call is required.

## Acceptance log

- Added a combined gallery, full image/reopen/download actions, older-photo pagination, and distinct loading, empty, and failure states.
- Real disposable PostgreSQL test covers mixed-source pagination, tied timestamps, owner isolation, incomplete-image exclusion, invalid cursors, and read-only browsing.
- Browser fixtures cover decoded previews, retained photos after pagination failure, retry, reload, sign-in, empty state, and narrow-screen reflow. These fixtures do not prove production media storage.
