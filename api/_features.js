// Feature switches. Chat was turned off on 2026-11-08 at the owner's request ("turn off all chat features").
// The chat code, tables and safeguarding filter are kept, so it can come back by flipping this to true
// (and CHAT_ON in app.js, plus restoring the two nav links in index.html). While false:
//   /api/chat answers 404 to everything; /api/admin refuses chat, mutes, flags and review;
//   the admin portal hides the Chat and Flags tabs and the mute controls.
export const CHAT_ENABLED = false;
