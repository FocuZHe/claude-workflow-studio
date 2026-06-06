/**
 * Copy compiled frontend JS files from dist/client-tmp back to src/client/js
 * Strips 'export {};' lines that TypeScript adds (browser scripts can't use ESM exports)
 */
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'dist', 'client-tmp');
const destDir = path.join(__dirname, '..', 'src', 'client', 'js');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else if (entry.name.endsWith('.js')) {
      // Read, strip ESM exports, write
      let content = fs.readFileSync(srcPath, 'utf-8');
      // Remove 'export {};' lines (TypeScript adds these for module scoping)
      content = content.replace(/^export \{\};\s*$/gm, '');
      // Remove 'export default' that might appear
      content = content.replace(/^export default\s+/gm, '');
      fs.writeFileSync(destPath, content, 'utf-8');
      console.log(`  ${path.relative(destDir, destPath)}`);
    }
  }
}

console.log('Copying compiled frontend JS files...');
copyDir(srcDir, destDir);
console.log('Done.');
