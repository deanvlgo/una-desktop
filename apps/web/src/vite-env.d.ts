/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UNA_API_BASE_URL?: string;
  readonly VITE_HOCUS_URL?: string;
  readonly VITE_HOCUSPOCUS_URL?: string;
  readonly VITE_USE_SHARED_COLLECTIONS_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
