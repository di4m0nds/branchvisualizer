// ─── Project command detection (pure) ────────────────────────────────────────
// Maps manifest files to runnable commands. Pure functions over manifest
// CONTENT + the file-presence set, so the whole registry unit-tests without a
// filesystem. The driver (detect.ts) feeds it real files.

export type CommandGroup = 'dev' | 'build' | 'test' | 'quality' | 'docker' | 'other';

export interface DevCommand {
  id: string;
  label: string;
  command: string;
  group: CommandGroup;
  /** Which manifest produced it (display + dedupe). */
  source: string;
}

export interface Detector {
  /** Manifest filename (repo root) whose presence triggers this detector. */
  manifest: string;
  detect(content: string, files: ReadonlySet<string>): DevCommand[];
}

// ── JS/TS: package.json scripts, runner chosen by lockfile ──────────────────

function jsRunner(files: ReadonlySet<string>): string {
  if (files.has('pnpm-lock.yaml')) return 'pnpm';
  if (files.has('yarn.lock')) return 'yarn';
  if (files.has('bun.lockb') || files.has('bun.lock')) return 'bun';
  return 'npm';
}

/** Heuristic grouping for npm script names. */
export function groupForScript(name: string): CommandGroup {
  if (/^(dev|start|serve|watch)/.test(name)) return 'dev';
  if (/^(build|compile|dist|release|package)/.test(name)) return 'build';
  if (/(^|:)(test|e2e|coverage|vitest|jest|cypress|playwright)/.test(name)) return 'test';
  if (/^(lint|format|fmt|typecheck|check|audit|prettier|eslint)/.test(name)) return 'quality';
  return 'other';
}

const packageJson: Detector = {
  manifest: 'package.json',
  detect(content, files) {
    let scripts: Record<string, string> = {};
    try {
      const parsed = JSON.parse(content) as { scripts?: Record<string, string> };
      scripts = parsed.scripts ?? {};
    } catch {
      return [];
    }
    const runner = jsRunner(files);
    const runPrefix = runner === 'yarn' ? 'yarn' : `${runner} run`;
    return Object.entries(scripts).map(([name, body]) => ({
      id: `npm:${name}`,
      label: name,
      // `start` is special-cased by npm itself, but `<runner> run start` works everywhere.
      command: `${runPrefix} ${name}`,
      group: groupForScript(name),
      source: `package.json · ${body.length > 60 ? `${body.slice(0, 57)}…` : body}`,
    }));
  },
};

// ── Makefile targets ─────────────────────────────────────────────────────────

const MAKE_TARGET_RE = /^([A-Za-z0-9_.-]+):(?!=)/gm;
const MAKE_SKIP = new Set(['.PHONY', '.DEFAULT', '.SUFFIXES', '.PRECIOUS', '.INTERMEDIATE']);

const makefile: Detector = {
  manifest: 'Makefile',
  detect(content) {
    const seen = new Set<string>();
    const out: DevCommand[] = [];
    for (const m of content.matchAll(MAKE_TARGET_RE)) {
      const target = m[1];
      if (MAKE_SKIP.has(target) || target.includes('%') || seen.has(target)) continue;
      seen.add(target);
      const group: CommandGroup = /test/.test(target) ? 'test'
        : /^(build|all|release|dist)/.test(target) ? 'build'
        : /^(run|dev|serve|start|watch)/.test(target) ? 'dev'
        : /^(lint|fmt|format|check|clippy)/.test(target) ? 'quality'
        : 'other';
      out.push({ id: `make:${target}`, label: `make ${target}`, command: `make ${target}`, group, source: 'Makefile' });
    }
    return out.slice(0, 24);
  },
};

// ── Fixed command sets keyed on manifest presence ────────────────────────────

function fixed(manifest: string, cmds: Array<[string, string, CommandGroup]>): Detector {
  return {
    manifest,
    detect: () => cmds.map(([label, command, group]) => ({
      id: `${manifest}:${label}`, label, command, group, source: manifest,
    })),
  };
}

const cargo = fixed('Cargo.toml', [
  ['cargo run', 'cargo run', 'dev'],
  ['cargo build', 'cargo build', 'build'],
  ['cargo build --release', 'cargo build --release', 'build'],
  ['cargo test', 'cargo test', 'test'],
  ['cargo clippy', 'cargo clippy', 'quality'],
  ['cargo fmt', 'cargo fmt', 'quality'],
]);

const goMod = fixed('go.mod', [
  ['go run .', 'go run .', 'dev'],
  ['go build ./...', 'go build ./...', 'build'],
  ['go test ./...', 'go test ./...', 'test'],
  ['go vet ./...', 'go vet ./...', 'quality'],
]);

const maven = fixed('pom.xml', [
  ['mvn compile', 'mvn compile', 'build'],
  ['mvn package', 'mvn package', 'build'],
  ['mvn test', 'mvn test', 'test'],
  ['mvn verify', 'mvn verify', 'quality'],
]);

const gradle: Detector = {
  manifest: 'build.gradle',
  detect(_content, files) {
    const g = files.has('gradlew') ? './gradlew' : 'gradle';
    return ([
      [`${g} build`, 'build'],
      [`${g} test`, 'test'],
      [`${g} run`, 'dev'],
      [`${g} check`, 'quality'],
    ] as Array<[string, CommandGroup]>).map(([command, group]) => ({
      id: `gradle:${command}`, label: command, command, group, source: 'build.gradle',
    }));
  },
};

const pyproject: Detector = {
  manifest: 'pyproject.toml',
  detect(content, files) {
    const uv = files.has('uv.lock');
    const prefix = uv ? 'uv run ' : '';
    const out: DevCommand[] = [];
    if (content.includes('[tool.pytest') || content.includes('pytest')) {
      out.push({ id: 'py:pytest', label: 'pytest', command: `${prefix}pytest`, group: 'test', source: 'pyproject.toml' });
    }
    if (content.includes('ruff')) {
      out.push(
        { id: 'py:ruff', label: 'ruff check', command: `${prefix}ruff check .`, group: 'quality', source: 'pyproject.toml' },
        { id: 'py:ruff-fmt', label: 'ruff format', command: `${prefix}ruff format .`, group: 'quality', source: 'pyproject.toml' },
      );
    }
    if (content.includes('mypy')) {
      out.push({ id: 'py:mypy', label: 'mypy', command: `${prefix}mypy .`, group: 'quality', source: 'pyproject.toml' });
    }
    if (out.length === 0) {
      out.push({ id: 'py:pytest', label: 'pytest', command: `${prefix}pytest`, group: 'test', source: 'pyproject.toml' });
    }
    return out;
  },
};

const requirements = fixed('requirements.txt', [
  ['pip install -r requirements.txt', 'pip install -r requirements.txt', 'other'],
  ['pytest', 'pytest', 'test'],
]);

const dockerfile = fixed('Dockerfile', [
  ['docker build .', 'docker build -t app .', 'docker'],
]);

const compose: Detector = {
  manifest: 'docker-compose.yml',
  detect: () => ([
    ['compose up', 'docker compose up -d'],
    ['compose down', 'docker compose down'],
    ['compose logs', 'docker compose logs --tail=100'],
  ] as Array<[string, string]>).map(([label, command]) => ({
    id: `compose:${label}`, label, command, group: 'docker' as const, source: 'docker-compose.yml',
  })),
};

const cmake = fixed('CMakeLists.txt', [
  ['cmake configure', 'cmake -B build', 'build'],
  ['cmake build', 'cmake --build build', 'build'],
  ['ctest', 'ctest --test-dir build', 'test'],
]);

const gemfile = fixed('Gemfile', [
  ['bundle install', 'bundle install', 'other'],
  ['rspec', 'bundle exec rspec', 'test'],
  ['rubocop', 'bundle exec rubocop', 'quality'],
]);

const mixExs = fixed('mix.exs', [
  ['mix deps.get', 'mix deps.get', 'other'],
  ['mix compile', 'mix compile', 'build'],
  ['mix test', 'mix test', 'test'],
  ['mix format', 'mix format', 'quality'],
]);

const composerJson = fixed('composer.json', [
  ['composer install', 'composer install', 'other'],
  ['phpunit', 'vendor/bin/phpunit', 'test'],
]);

const pubspec = fixed('pubspec.yaml', [
  ['flutter run', 'flutter run', 'dev'],
  ['flutter build', 'flutter build apk', 'build'],
  ['flutter test', 'flutter test', 'test'],
  ['flutter analyze', 'flutter analyze', 'quality'],
]);

const swiftPackage = fixed('Package.swift', [
  ['swift build', 'swift build', 'build'],
  ['swift test', 'swift test', 'test'],
]);

const csproj: Detector = {
  // Matched by extension in the driver (any *.csproj / *.sln at root).
  manifest: '*.csproj',
  detect: () => ([
    ['dotnet run', 'dev'],
    ['dotnet build', 'build'],
    ['dotnet test', 'test'],
  ] as Array<[string, CommandGroup]>).map(([command, group]) => ({
    id: `dotnet:${command}`, label: command, command, group, source: '.csproj',
  })),
};

export const DETECTORS: Detector[] = [
  packageJson, makefile, cargo, goMod, maven, gradle, pyproject, requirements,
  dockerfile, compose, cmake, gemfile, mixExs, composerJson, pubspec, swiftPackage, csproj,
];

/** Alternate filenames that satisfy a detector's manifest. */
export const MANIFEST_ALIASES: Record<string, string[]> = {
  Makefile: ['Makefile', 'makefile', 'GNUmakefile'],
  'docker-compose.yml': ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'],
  'build.gradle': ['build.gradle', 'build.gradle.kts'],
};

/** Run every detector whose manifest is present. `read` fetches file content
 *  (empty string tolerated); `files` is the set of root-level names. */
export async function detectCommands(
  files: ReadonlySet<string>,
  read: (name: string) => Promise<string>,
): Promise<DevCommand[]> {
  const out: DevCommand[] = [];
  const seen = new Set<string>();
  for (const det of DETECTORS) {
    let present: string | null = null;
    if (det.manifest.startsWith('*.')) {
      const ext = det.manifest.slice(1); // ".csproj"
      present = [...files].find((f) => f.endsWith(ext)) ?? null;
    } else {
      const names = MANIFEST_ALIASES[det.manifest] ?? [det.manifest];
      present = names.find((n) => files.has(n)) ?? null;
    }
    if (!present) continue;
    const content = await read(present).catch(() => '');
    for (const cmd of det.detect(content, files)) {
      if (seen.has(cmd.id)) continue;
      seen.add(cmd.id);
      out.push(cmd);
    }
  }
  return out;
}
