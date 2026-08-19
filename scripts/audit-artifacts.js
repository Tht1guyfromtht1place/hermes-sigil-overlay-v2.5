const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function collectFiles(root, output = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) collectFiles(absolute, output);
    else if (entry.isFile() && ['.exe', '.asar', '.js'].includes(path.extname(entry.name).toLowerCase())) output.push(absolute);
  }
  return output;
}

function auditArtifacts(root) {
  const username = os.userInfo().username;
  const cwd = process.cwd();
  const rules = [
    ['Windows user path', username.length >= 3 ? ['C:', 'Users', username].join('\\') : null],
    ['Windows user path', username.length >= 3 ? ['C:', 'Users', username].join('/') : null],
    ['Unix user path', username.length >= 3 ? ['', 'home', username].join('/') : null],
    ['macOS user path', username.length >= 3 ? ['', 'Users', username].join('/') : null],
    ['absolute build path', cwd],
    ['personal cloud-sync path', username.length >= 3 ? `${username}\\OneDrive` : null],
    ['personal cloud-sync path', username.length >= 3 ? `${username}/OneDrive` : null],
    ['GitHub access token', 'gho_'],
    ['GitHub personal token', 'github_pat_'],
    ['private key material', 'BEGIN PRIVATE KEY']
  ].filter(([, value]) => value);

  const findings = [];
  for (const absolute of collectFiles(root)) {
    const bytes = fs.readFileSync(absolute);
    const searchable = `${bytes.toString('latin1')}\n${bytes.toString('utf16le')}`.toLowerCase();
    for (const [label, value] of rules) {
      if (searchable.includes(String(value).toLowerCase())) {
        findings.push(`${path.relative(root, absolute)}: ${label}`);
      }
    }
  }
  return findings;
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || 'dist');
  const findings = auditArtifacts(root);
  if (findings.length) {
    console.error('Artifact audit failed:');
    for (const finding of findings) console.error(`- ${finding}`);
    process.exit(1);
  }
  console.log(`Artifact audit passed: ${root}`);
}

module.exports = { auditArtifacts };
