/** Connection status for the Pencil MCP server */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Full connection state */
export interface PencilConnection {
  status: ConnectionStatus;
  serverInfo?: { name: string; version: string };
  toolNames?: string[];
  instructions?: string;
  error?: string;
}

/** Mode state for /pencil toggle */
export interface ModeState {
  active: boolean;
  toolNames: string[];
}
