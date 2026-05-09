// Re-export auth helpers for use in Server Actions / RSC. Keeping a separate
// file lets route handlers import only the request handlers without pulling
// the action-only surface into edge bundles.
export { auth, signIn, signOut } from "./auth";
