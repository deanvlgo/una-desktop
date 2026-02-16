/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UNA_API_BASE_URL?: string;
  readonly VITE_HOCUS_URL?: string;
  readonly VITE_HOCUSPOCUS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
