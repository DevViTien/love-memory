import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix } from "node:path";

const allowedEnvironmentFiles = new Set([".env.example"]);
const secretPatterns = [
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  {
    name: "MongoDB URI with embedded credentials",
    pattern: /mongodb(?:\+srv)?:\/\/[^\s/:]+:[^\s@]+@/i,
  },
  {
    name: "private key",
    pattern: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/,
  },
  { name: "Vercel Blob token", pattern: /vercel_blob_(?:ro|rw)_[A-Za-z0-9_-]{16,}/i },
];

function isForbiddenEnvironmentFile(file) {
  const name = posix.basename(file.replaceAll("\\", "/"));
  return (
    !allowedEnvironmentFiles.has(name) &&
    (name === ".env" || name.startsWith(".env.") || name.endsWith(".env"))
  );
}

const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-per-directory=.gitignore", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const findings = [];

for (const file of repositoryFiles) {
  if (isForbiddenEnvironmentFile(file)) {
    findings.push(`${file}: tracked environment file`);
    continue;
  }

  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;

  const contents = bytes.toString("utf8");
  for (const { name, pattern } of secretPatterns) {
    if (pattern.test(contents)) findings.push(`${file}: ${name}`);
  }
}

if (findings.length > 0) {
  process.stderr.write(
    `Potential secrets detected:\n${findings.map((item) => `- ${item}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`Secret scan passed for ${repositoryFiles.length} repository files.\n`);
}
