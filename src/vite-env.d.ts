/// <reference types="vite/client" />

// Raw text imports (used to embed the system-prompt document verbatim).
declare module '*.md?raw' {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  readonly VITE_ANTHROPIC_API_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
