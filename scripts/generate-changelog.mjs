import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const categoryOrder = ['breaking', 'feat', 'fix', 'perf', 'refactor', 'docs', 'maintenance'];

const categoryLabels = {
  breaking: '⚠️ 破坏性变更',
  feat: '✨ 新功能',
  fix: '🐛 问题修复',
  perf: '⚡ 性能优化',
  refactor: '♻️ 重构',
  docs: '📝 文档',
  maintenance: '🛠 工程维护'
};

const supportedTypes = new Set([
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'build',
  'ci',
  'chore',
  'style',
  'test',
  'revert'
]);
const scopePattern = /^[a-z0-9][a-z0-9-]*$/;
const subjectMaxLength = 100;

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

function validateCommitSubject(subject, conventional) {
  if (!conventional) {
    return ['标题必须使用 <type>(<scope>)!: <description> 格式'];
  }

  const [, rawType, scope, breakingMarker, rawMessage] = conventional;
  const type = rawType.toLowerCase();
  const errors = [];

  if (rawType !== type) {
    errors.push('type 必须使用小写字母');
  }
  if (!supportedTypes.has(type)) {
    errors.push(`不支持 type "${rawType}"`);
  }
  if (scope && !scopePattern.test(scope)) {
    errors.push('scope 只能使用小写字母、数字和短横线');
  }

  const expectedSubject = `${rawType}${scope ? `(${scope})` : ''}${
    breakingMarker || ''
  }: ${rawMessage}`;
  if (subject !== expectedSubject) {
    errors.push('冒号后必须有且只有一个空格');
  }
  if (subject.length > subjectMaxLength) {
    errors.push(`标题不能超过 ${subjectMaxLength} 个字符`);
  }
  if (/[。.]\s*$/.test(rawMessage)) {
    errors.push('description 末尾不能使用句号');
  }

  return errors;
}

function parseCommit(record) {
  const [hash, rawSubject, author] = record.split('\x1f');
  const subject = rawSubject?.trim() || '未命名提交';
  const conventional = subject.match(/^([a-zA-Z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  const validationErrors = validateCommitSubject(subject, conventional);

  if (!conventional) {
    return {
      hash,
      author,
      subject,
      validationErrors,
      category: 'maintenance',
      message: subject
    };
  }

  const [, rawType, scope, breakingMarker, rawMessage] = conventional;
  const type = rawType.toLowerCase();
  const category = breakingMarker
    ? 'breaking'
    : ['feat', 'fix', 'perf', 'refactor', 'docs'].includes(type)
      ? type
      : 'maintenance';
  const message = scope ? `**${escapeMarkdown(scope)}：** ${rawMessage}` : rawMessage;

  return { hash, author, subject, validationErrors, category, message };
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

function latestStableTag(to) {
  const output = execFileSync('git', ['tag', '--merged', to, '--sort=-version:refname'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return (
    output
      .split(/\r?\n/)
      .map((tag) => tag.trim())
      .find((tag) => /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) || ''
  );
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
    const autoFromRef = typeof args['auto-from-ref'] === 'string' ? args['auto-from-ref'] : to;
    from = latestStableTag(autoFromRef);
  } catch {
    from = '';
  }
}
const range = from ? `${from}..${to}` : to;
const commits = gitLog(range);
if (args.strict || args.check) {
  const invalidCommits = commits.filter((commit) => commit.validationErrors.length > 0);
  if (invalidCommits.length > 0) {
    const details = invalidCommits.flatMap((commit) => [
      `- ${commit.hash.slice(0, 7)} ${commit.subject}`,
      ...commit.validationErrors.map((error) => `  - ${error}`)
    ]);
    process.stderr.write(
      [
        `发现 ${invalidCommits.length} 个不符合 CONTRIBUTING.md 的提交标题：`,
        '',
        ...details,
        '',
        '请整理提交历史后重试。'
      ].join('\n') + '\n'
    );
    process.exit(1);
  }
}

if (args.check) {
  process.stdout.write(`已检查 ${commits.length} 个非合并提交，标题均符合规范。\n`);
  process.exit(0);
}

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

if (args.preview) {
  lines.push(
    '## 测试版说明',
    '',
    '- 此版本来自 `main` 分支最新成功 CI，可能包含尚未进入稳定版的改动。',
    '- Windows x64 提供 NSIS，Linux x64 提供 AppImage 和 DEB，macOS 提供 Universal 构建。',
    '- 应用内更新会校验与稳定版相同的 Tauri 签名，签名不匹配时拒绝安装。',
    ''
  );
} else {
  lines.push(
    '## 下载说明',
    '',
    '- Windows：x64 提供 NSIS、MSI 与便携 ZIP；ARM64 提供 NSIS 与便携 ZIP。',
    '- Linux：x64、ARM64 均提供 AppImage、DEB、RPM 与便携 ZIP。',
    '- macOS：提供 Intel、Apple Silicon 和 Universal 的 DMG、APP 更新包与便携 ZIP。',
    '- 应用内更新会校验 Tauri 签名，签名不匹配时拒绝安装。',
    ''
  );
}

if (repository) {
  const comparisonUrl = from
    ? `https://github.com/${repository}/compare/${from}...${version}`
    : `https://github.com/${repository}/commits/${version}`;
  lines.push(
    `**完整变更记录：** [${from ? `${from} → ${version}` : version}](${comparisonUrl})`,
    ''
  );
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
