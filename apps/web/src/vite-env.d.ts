// Build-time variables used by the web app. Vite inlines them; never put secrets here.
interface ImportMetaEnv {
  /** "true" only for the gated dev site: honours ?phase=. Remove before go-live. */
  readonly VITE_ALLOW_PHASE_OVERRIDE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
