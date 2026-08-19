const fs = require('node:fs');
const path = require('node:path');

const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const PROHIBITED_NAMES = new Set(['.env', 'auth.json', 'config.yaml', 'credentials.json']);
const PROHIBITED_EXTENSIONS = new Set(['.pem', '.p12', '.pfx', '.key']);
const TEXT_EXTENSIONS = new Set(['.js', '.json', '.md', '.txt', '.html', '.css', '.yml', '.yaml', '.toml', '.ps1', '.bat', '.vbs']);

const TEXT_RULES = [
  ['personal Windows path', /[A-Za-z]:\\Users\\[^\\\r\n]+/i],
  ['personal Unix path', /\/(?:Users|home)\/[^/\s]+/i],
  ['OneDrive path', /OneDrive[\\/]/i],
  ['private key material', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['provider credential', /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/],
  ['credential-like value', /\b(?:api[_-]?key|access[_-]?token|password|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9_./+-]{12,}/i]
];

function walk(root, current = root, output = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) walk(root, absolute, output);
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

function auditTree(root) {
  const findings = [];
  for (const absolute of walk(root)) {
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    const basename = path.basename(absolute).toLowerCase();
    const extension = path.extname(absolute).toLowerCase();
    if (PROHIBITED_NAMES.has(basename) || PROHIBITED_EXTENSIONS.has(extension)) {
      findings.push(`${relative}: prohibited credential/config file`);
      continue;
    }
    if (!TEXT_EXTENSIONS.has(extension) && basename !== '.gitignore' && basename !== 'license') continue;
    const text = fs.readFileSync(absolute, 'utf8');
    for (const [label, pattern] of TEXT_RULES) {
      if (pattern.test(text)) findings.push(`${relative}: ${label}`);
    }
  }
  return findings;
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || '.');
  const findings = auditTree(root);
  if (findings.length) {
    console.error('Release audit failed:');
    for (const finding of findings) console.error(`- ${finding}`);
    process.exit(1);
  }
  console.log(`Release audit passed: ${root}`);
}

module.exports = { auditTree };
