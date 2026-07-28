const previewBuildTypes = new Set(['feat', 'fix', 'perf', 'refactor', 'build', 'revert']);
const conventionalSubjectPattern = /^([a-z]+)(?:\(([a-z0-9][a-z0-9-]*)\))?(!)?: .+$/;

export function triggersPreviewBuild(subject) {
  const conventional = subject.match(conventionalSubjectPattern);
  if (!conventional) return false;

  const [, type, scope] = conventional;
  return previewBuildTypes.has(type) || (type === 'chore' && scope === 'deps');
}

export function findPreviewBuildTrigger(subjects) {
  return subjects.find(triggersPreviewBuild) || '';
}
