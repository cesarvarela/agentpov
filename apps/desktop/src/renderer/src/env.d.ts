/// <reference types="vite/client" />

import type { AgentpovApi } from "../../preload";

declare global {
  interface Window {
    agentpov?: AgentpovApi;
  }
}

export {};
