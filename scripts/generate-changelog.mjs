import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const categoryOrder = [
  'breaking',
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'maintenance'
];

const categoryLabels = {
  breaking: '⚠️ 破坏性变更',
  feat: '✨ 新功能',
  fix: '🐛 问题修复',
  perf: '⚡ 性能优化',
  refactor: '♻️ 重构',
  docs: '📝 文档',
  maintenance: '🛠 工程维护'
};

function readArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = value;
    index += 1;
  }
  return result;
}

function escapeMarkdown(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]');
}

function parseCommit(record) {
  const [hash, rawSubject, author] = record.split('\x1f');
  const subject = rawSubject?.trim() || '未命名提交';
  const conventional = subject.match(/^([a-zA-Z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);

  if (!conventional) {
    return { hash, author, category: 'maintenance', message: subject };
  }

  const [, rawType, scope, breakingMarker, rawMessage] = conventional;
  const type = rawType.toLowerCase();
  const category = breakingMarker
    ? 'breaking'
    : ['feat', 'fix', 'perf', 'refactor', 'docs'].includes(type)
      ? type
      : 'maintenance';
  const message = scope ? `**${escapeMarkdown(scope)}：** ${rawMessage}` : rawMessage;

  return { hash, author, category, message };
}

function gitLog(range) {
  const output = execFileSync(
    'git',
    ['log', '--no-merges', '--reverse', '--format=%H%x1f%s%x1f%an%x1e', range],
    { encoding: 'utf8' }
  );

  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map(parseCommit);
}

const args = readArguments(process.argv.slice(2));
let from = typeof args.from === 'string' ? args.from : '';
const to = typeof args.to === 'string' ? args.to : 'HEAD';
const version = typeof args.version === 'string' ? args.version : to;
const repository =
  typeof args.repository === 'string' ? args.repository : process.env.GITHUB_REPOSITORY || '';
const outputPath = typeof args.output === 'string' ? args.output : '';
if (!from && args['auto-from']) {
  try {
    from = execFileSync('git', ['describe', '--tags', '--abbrev=0', to], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    from = '';
  }
}
const range = from ? `${from}..${to}` : to;
const commits = gitLog(range);
const grouped = Object.fromEntries(categoryOrder.map((category) => [category, []]));

for (const commit of commits) {
  grouped[commit.category].push(commit);
}

const lines = [
  '此版本由 GitHub Actions 自动构建并发布，以下更新日志根据 Git 提交记录生成。',
  '',
  '## 更新日志',
  ''
];

if (commits.length === 0) {
  lines.push('- 本版本没有可列出的非合并提交。', '');
} else {
  for (const category of categoryOrder) {
    const entries = grouped[category];
    if (entries.length === 0) continue;

    lines.push(`### ${categoryLabels[category]}`, '');
    for (const entry of entries) {
      const shortHash = entry.hash.slice(0, 7);
      const commitLink = repository
        ? `[\`${shortHash}\`](https://github.com/${repository}/commit/${entry.hash})`
        : `\`${shortHash}\``;
      lines.push(`- ${entry.message} (${commitLink})`);
    }
    lines.push('');
  }
}

lines.push(
  '## 下载说明',
  '',
  '- Windows：x64 提供 NSIS、MSI 与便携 ZIP；ARM64 提供 NSIS 与便携 ZIP。',
  '- Linux：x64、ARM64 均提供 AppImage、DEB、RPM 与便携 ZIP。',
  '- macOS：提供 Intel、Apple Silicon 和 Universal 的 DMG、APP 更新包与便携 ZIP。',
  '- 应用内更新会校验 Tauri 签名，签名不匹配时拒绝安装。',
  ''
);

if (repository) {
  const comparisonUrl = from
    ? `https://github.com/${repository}/compare/${from}...${version}`
    : `https://github.com/${repository}/commits/${version}`;
  lines.push(`**完整变更记录：** [${from ? `${from} → ${version}` : version}](${comparisonUrl})`, '');
}

const authors = [...new Set(commits.map((commit) => commit.author).filter(Boolean))];
if (authors.length > 0) {
  lines.push(`**提交贡献者：** ${authors.map(escapeMarkdown).join('、')}`, '');
}

const changelog = `${lines.join('\n').trim()}\n`;
if (outputPath) {
  writeFileSync(outputPath, changelog, 'utf8');
} else {
  process.stdout.write(changelog);
}
