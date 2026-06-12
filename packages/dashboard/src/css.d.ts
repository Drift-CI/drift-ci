// TypeScript 6 requires a module/type declaration for side-effect imports of
// non-code assets. The app imports global stylesheets (e.g. `./globals.css`)
// purely for their side effects — Next.js owns the actual CSS pipeline — so an
// untyped ambient declaration is sufficient.
declare module '*.css';
