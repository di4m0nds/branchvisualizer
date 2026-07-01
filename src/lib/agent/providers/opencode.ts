import { invoke, isTauri } from '../../platform';
import type {
  AgentRequest, AgentTransport, ModelInfo, NeutralContent, NeutralResponse,
  NeutralStopReason, NeutralUsage, ProbeResult, Provider, StreamCallbacks,
} from '../transport';

// OpenCode is the CLI/OSS coding agent (opencode.ai). Detection is CLI-based via
// the Rust `check_cli_provider("opencode")` command (reads `opencode auth status`
// + `~/.opencode/auth.json`). Sessions run through OpenCode's local HTTP server
// (default port 4096) so we don't reimplement its tool loop — we forward tools
// as an external agent and let OpenCode orchestrate.

const DEFAULT_ENDPOINT = 'http://127.0.0.1:4096';

const MODELS: ModelInfo[] = [
  { id: 'opencode-default', label: 'OpenCode (default profile)', defaultTier: 'unknown' },
  { id: 'opencode-fast',    label: 'OpenCode (fast profile)',    defaultTier: 'unknown' },
];

interface CliProbePayload {
  detected: boolean;
  connected: boolean;
  version?: string;
  authKind?: string;
  error?: string;
}

async function checkCli(): Promise<CliProbePayload | null> {
  if (!isTauri()) return null;
  return invoke<CliProbePayload>('check_cli_provider', { name: 'opencode' }).catch(() => null);
}

async function endpointHealthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

class OpenCodeTransport implements AgentTransport {
  readonly id = 'opencode';
  constructor(readonly modelId: string, private endpoint: string) {}

  async createMessage(req: AgentRequest, cbs: StreamCallbacks): Promise<NeutralResponse> {
    // Minimal shim: POST { model, system, messages, tools } to /agent, stream text.
    // This is intentionally aligned with OpenCode's beta HTTP surface; adjust if
    // your local build exposes a different route.
    const body = {
      profile: this.modelId,
      system: req.system,
      messages: req.messages,
      tools: req.tools,
      max_tokens: req.maxTokens,
      effort: req.effort,
      thinking: req.thinking,
      stream: true,
    };

    const res = await fetch(`${this.endpoint}/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenCode HTTP ${res.status}: ${await res.text().catch(() => '')}`);

    const content: NeutralContent[] = [];
    const usage: NeutralUsage = { inputTokens: 0, outputTokens: 0, total: 0 };
    let stopReason: NeutralStopReason = 'end_turn';
    let providerModel = this.modelId;

    if (!res.body) return { content, stopReason, usage, providerModel };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let lineEnd;
      while ((lineEnd = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, lineEnd).trim();
        buf = buf.slice(lineEnd + 1);
        if (!line) continue;
        let frame: { type?: string; delta?: string; content?: NeutralContent[]; usage?: NeutralUsage; stopReason?: NeutralStopReason; model?: string };
        try { frame = JSON.parse(line); } catch { continue; }
        if (frame.type === 'text_delta' && frame.delta) { cbs.onText?.(frame.delta); }
        else if (frame.type === 'thinking_delta' && frame.delta) { cbs.onThinking?.(frame.delta); }
        else if (frame.type === 'done') {
          if (frame.content) content.push(...frame.content);
          if (frame.usage) Object.assign(usage, frame.usage);
          if (frame.stopReason) stopReason = frame.stopReason;
          if (frame.model) providerModel = frame.model;
        }
      }
    }

    return { content, stopReason, usage, providerModel };
  }
}

export const opencodeProvider: Provider = {
  id: 'opencode',
  label: 'OpenCode',
  description: 'OpenCode CLI (opencode.ai) — runs against its local server.',
  models: () => MODELS,

  async probe(): Promise<ProbeResult> {
    const cli = await checkCli();
    const endpoint = import.meta.env.VITE_OPENCODE_ENDPOINT ?? DEFAULT_ENDPOINT;
    const serverUp = await endpointHealthy(endpoint);

    if (cli?.connected && serverUp) {
      return { state: 'connected', tier: 'unknown', label: `CLI auth · server ${endpoint}`, version: cli.version };
    }
    if (cli?.connected) {
      return { state: 'detected', tier: 'unknown', label: `CLI ok · local server not running (${endpoint})`, version: cli.version };
    }
    if (cli?.detected) {
      return { state: 'detected', tier: 'unknown', label: 'CLI present but not authenticated', version: cli.version, error: cli.error };
    }
    if (serverUp) return { state: 'detected', tier: 'unknown', label: `server up at ${endpoint} but CLI missing` };
    return { state: 'not_detected', tier: 'unknown', label: 'opencode CLI not found and server not reachable' };
  },

  async createTransport(modelId: string): Promise<AgentTransport> {
    const endpoint = import.meta.env.VITE_OPENCODE_ENDPOINT ?? DEFAULT_ENDPOINT;
    if (!(await endpointHealthy(endpoint))) {
      throw new Error(`OpenCode server not reachable at ${endpoint}. Run \`opencode serve\`.`);
    }
    return new OpenCodeTransport(modelId, endpoint);
  },
};
