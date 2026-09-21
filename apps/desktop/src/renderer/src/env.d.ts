/// <reference types="vite/client" />

import type { AgentviewApi } from "../../preload";

declare global {
  interface Window {
    agentview?: AgentviewApi;
  }
}

export {};
