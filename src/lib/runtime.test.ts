import { describe, it, expect } from 'vitest';
import { parseStatsLine } from './runtime';

describe('parseStatsLine', () => {
  it('parses docker pre-formatted string stats', () => {
    const line = JSON.stringify({
      Name: 'web-1', CPUPerc: '0.27%', MemUsage: '1.4MiB / 3.8GiB',
      MemPerc: '0.09%', NetIO: '1.2kB / 0B', BlockIO: '0B / 0B', PIDs: '3',
    });
    const s = parseStatsLine(line)!;
    expect(s.name).toBe('web-1');
    expect(s.cpuPerc).toBe('0.27%');
    expect(s.memUsage).toBe('1.4MiB / 3.8GiB');
    expect(s.pids).toBe('3');
  });

  it('parses podman numeric stats (bytes + Network object)', () => {
    const line = JSON.stringify({
      Name: 'rtprobe', CPU: 0.2723, MemUsage: 1482752, MemPerc: 0.00897,
      Network: { wlp0s20f3: { RxBytes: 258, TxBytes: 542 } },
      BlockInput: 2891776, BlockOutput: 0, PIDs: 1,
    });
    const s = parseStatsLine(line)!;
    expect(s.name).toBe('rtprobe');
    expect(s.cpuPerc).toBe('0.27%');
    expect(s.memUsage).toBe('1.4 MB'); // 1482752 B → MB
    expect(s.memPerc).toBe('0.01%');
    expect(s.netIO).toBe('258 B / 542 B');
    expect(s.pids).toBe('1');
  });

  it('returns null for junk / nameless lines', () => {
    expect(parseStatsLine('not json')).toBeNull();
    expect(parseStatsLine('{}')).toBeNull();
    expect(parseStatsLine('  ')).toBeNull();
  });
});
