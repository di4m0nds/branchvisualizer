import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubError, configureGitHub, fetchRepo } from './github';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REPO_BODY = {
  full_name: 'octo/hello',
  name: 'hello',
  owner: { login: 'octo' },
  default_branch: 'main',
  description: 'demo',
  homepage: null,
  stargazers_count: 5,
  forks_count: 1,
  private: false,
  pushed_at: '2026-01-01T00:00:00Z',
  html_url: 'https://github.com/octo/hello',
};

function makeResponse(opts: {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}): Response {
  const headers = new Headers({
    'X-RateLimit-Remaining': '4999',
    'X-RateLimit-Limit': '5000',
    'X-RateLimit-Reset': '1750000000',
    ...opts.headers,
  });
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => opts.body ?? {},
    text: async () => opts.text ?? '',
  } as unknown as Response;
}

const fetchMock = vi.fn();

/** Await a promise expected to reject, returning the typed error. */
async function expectGitHubError(p: Promise<unknown>): Promise<GitHubError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GitHubError);
    return e as GitHubError;
  }
  throw new Error('expected the request to reject');
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  configureGitHub({ getToken: () => '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>).localStorage;
});

// ─── Auth header ─────────────────────────────────────────────────────────────

describe('authentication', () => {
  it('sends no Authorization header without a token', async () => {
    fetchMock.mockResolvedValue(makeResponse({ body: REPO_BODY }));
    await fetchRepo('octo', 'hello');
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('sends a Bearer token (trimmed) when configured', async () => {
    fetchMock.mockResolvedValue(makeResponse({ body: REPO_BODY }));
    configureGitHub({ getToken: () => '  ghp_abc  ' });
    await fetchRepo('octo', 'hello');
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ghp_abc');
  });
});

// ─── Error mapping ───────────────────────────────────────────────────────────

describe('error mapping', () => {
  it('maps an exhausted 403 to a rate-limit GitHubError', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({ status: 403, headers: { 'X-RateLimit-Remaining': '0' } }),
    );
    const err = await expectGitHubError(fetchRepo('octo', 'hello'));
    expect(err.status).toBe(403);
    expect(err.rateLimitExceeded).toBe(true);
    expect(err.message).toContain('rate limit');
  });

  it('adds an SSO hint on a non-rate-limit 403 mentioning SSO', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({ status: 403, text: 'Resource protected by organization SSO' }),
    );
    const err = await expectGitHubError(fetchRepo('octo', 'hello'));
    expect(err.rateLimitExceeded).toBe(false);
    expect(err.message).toContain('SSO');
  });

  it('maps 404 to "not found or private"', async () => {
    fetchMock.mockResolvedValue(makeResponse({ status: 404 }));
    const err = await expectGitHubError(fetchRepo('octo', 'hello'));
    expect(err.status).toBe(404);
    expect(err.message).toContain('not found');
  });

  it('maps 401 to an invalid-token message', async () => {
    fetchMock.mockResolvedValue(makeResponse({ status: 401 }));
    const err = await expectGitHubError(fetchRepo('octo', 'hello'));
    expect(err.status).toBe(401);
    expect(err.message).toContain('invalid or expired');
  });

  it('includes a body snippet for other statuses', async () => {
    fetchMock.mockResolvedValue(makeResponse({ status: 500, text: 'server exploded' }));
    const err = await expectGitHubError(fetchRepo('octo', 'hello'));
    expect(err.status).toBe(500);
    expect(err.message).toContain('server exploded');
  });
});

// ─── Rate-limit parsing + live callback ──────────────────────────────────────

describe('rate limit', () => {
  it('parses headers and notifies the callback on every response', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        body: REPO_BODY,
        headers: {
          'X-RateLimit-Remaining': '42',
          'X-RateLimit-Limit': '5000',
          'X-RateLimit-Reset': '1750000000',
        },
      }),
    );
    const seen = vi.fn();
    configureGitHub({ getToken: () => '', onRateLimit: seen });
    const { rateLimit } = await fetchRepo('octo', 'hello');
    expect(rateLimit).toEqual({
      remaining: 42,
      limit: 5000,
      resetAt: new Date(1750000000 * 1000),
    });
    expect(seen).toHaveBeenCalledWith(rateLimit);
  });

  it('returns null rate limit when headers are absent', async () => {
    const res = makeResponse({ body: REPO_BODY });
    (res.headers as Headers).delete('X-RateLimit-Limit');
    fetchMock.mockResolvedValue(res);
    const { rateLimit } = await fetchRepo('octo', 'hello');
    expect(rateLimit).toBeNull();
  });
});

// ─── Response caching ────────────────────────────────────────────────────────

describe('caching', () => {
  it('serves the second identical request from cache without refetching', async () => {
    // cache.ts writes through localStorage — provide a working stub.
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    };
    fetchMock.mockResolvedValue(makeResponse({ body: REPO_BODY }));

    const first = await fetchRepo('octo', 'hello');
    const second = await fetchRepo('octo', 'hello');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.info).toEqual(first.info);
    expect(second.rateLimit).toBeNull(); // cache hits carry no rate-limit info
  });
});
