// Single alias anchor for the generated Convex API -- every dashboard
// component imports `api` from here (via the `~/*` alias) instead of
// re-deriving a relative "../../../../convex/_generated/api" path at each
// file's own nesting depth. Goes through the tsconfig `~convex/*` alias
// (frontend/tsconfig.json), not a raw ".." relative import: Next's
// Turbopack dev server refuses to resolve a relative import that crosses
// outside the frontend/ directory (works fine under webpack/`next build`,
// but not `next dev --turbo`), and this repo now has two sibling
// package.json/lockfiles (frontend/ and repo-root convex/) that make
// Turbopack's workspace-root inference land on frontend/ specifically.
export { api } from "~convex/_generated/api";
