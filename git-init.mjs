import * as git from 'isomorphic-git';
import fs from 'fs';
import path from 'path';

const dir = process.cwd();

async function main() {
  console.log("Init git in", dir);
  
  // Init
  await git.init({ fs, dir });
  console.log("✓ git init");
  
  // Add all files (respect .gitignore manually - isomorphic-git doesn't auto handle it, so we add manually)
  // We will add files recursively except node_modules and .next
  const blacklist = ['node_modules', '.next', '.git', 'portablegit', 'job4us-temp'];
  
  async function addRecursively(base, relative = '') {
    const full = path.join(base, relative);
    const entries = fs.readdirSync(full, { withFileTypes: true });
    for (const e of entries) {
      const rel = path.join(relative, e.name);
      // Check blacklist
      if (blacklist.some(b => rel.startsWith(b) || rel.includes(`\\${b}\\`) || rel === b)) {
        continue;
      }
      // Check .gitignore simple patterns
      if (e.name === '.env') continue; // don't commit .env (secret)
      const fullPath = path.join(base, rel);
      if (e.isDirectory()) {
        await addRecursively(base, rel);
      } else {
        try {
          await git.add({ fs, dir, filepath: rel.replace(/\\/g, '/') });
          console.log("added", rel);
        } catch (err) {
          console.log("skip", rel, err.message);
        }
      }
    }
  }
  
  await addRecursively(dir);
  
  // Also add .gitignore, PROCEDURE.md etc explicitly
  const status = await git.statusMatrix({ fs, dir });
  console.log("\nStatus matrix (first 20):");
  console.log(status.slice(0, 20));
  
  const sha = await git.commit({
    fs,
    dir,
    author: { name: 'JOB4Us', email: 'job4us@example.com' },
    message: `feat: init JOB4Us - conversion Laravel emploi-app → Next.js 16 + Prisma

- Stack: Next.js 16 App Router + TypeScript + Tailwind 4 + Prisma 6.8 (MySQL)
- Migration: 16 tables (users, candidats, entreprises, offres, candidatures, etc.)
- Source: emploi-app (Laravel 10) analysé et converti
- Backend Pro: Next.js Fullstack (pas de backend séparé)
- API: src/app/api/offres/route.ts
- Pages: src/app/offres/page.tsx
- Docs: PROCEDURE.md + prisma/schema.prisma

Procedure enregistrée.`
  });
  console.log("\n✓ commit", sha);
  
  const log = await git.log({ fs, dir, depth: 1 });
  console.log(JSON.stringify(log, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
