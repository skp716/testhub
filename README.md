# TestHub

Single-exam Firebase/GitHub Pages examination portal.

## Pages

- `index.html` — candidate login, timed test, resume and submission
- `admin.html` — role-protected configuration, live attempts and results
- `chapter.json` — current static question bank

## Required Firebase setup

1. Enable **Anonymous** and **Email/Password** providers in Firebase Authentication.
2. Create `admin/{ADMIN_UID}` with `active: true` and `role: "admin"`.
3. Deploy rules with `firebase deploy --only firestore:rules`.
4. Configure `exam_config/current_test` from `admin.html`.
5. Add the deployed domain to Firebase Authentication → Authorized domains.

The portal intentionally keeps one configuration document: `exam_config/current_test`.

## Security notes

Browser anti-cheating is deterrence, not an OS-level lock. A website cannot reliably block a second device, every Android overlay, screenshots, or external cameras. For server-authoritative scoring and a secret center code, move question delivery and submission validation to a trusted backend/Cloud Function and enable Firebase App Check.
