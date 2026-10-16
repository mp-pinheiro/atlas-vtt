const fs = require('fs');
const path = require('path');
const { getPluginTargetDirs, markForHotReload } = require('./worktree-targets');

const distDir = path.join(__dirname, '..', 'dist');
const rootManifest = path.join(__dirname, '..', 'manifest.json');
const stylesSource = [path.join(distDir, 'styles.css'), path.join(distDir, 'style.css')].find((file) => fs.existsSync(file)) ?? path.join(distDir, 'styles.css');
const artifactFiles = [
  { source: path.join(distDir, 'main.js'), targetName: 'main.js', required: true },
  { source: stylesSource, targetName: 'styles.css', required: true },
  { source: rootManifest, targetName: 'manifest.json', required: true },
];

const [vault] = process.argv.slice(2);
if (process.argv.length > 3 || vault === '') {
  throw new Error('Usage: node scripts/copy-plugin.js [existing-test-vault]');
}
if (vault !== undefined && !fs.statSync(path.join(path.resolve(vault), '.obsidian'), { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error('Open the test vault in Obsidian once before installing the plugin.');
}
const targets = vault === undefined
  ? getPluginTargetDirs(path.join(__dirname, '..'))
  : [{ label: path.resolve(vault), dirPath: path.join(path.resolve(vault), '.obsidian', 'plugins', 'atlas-vtt') }];

const missingRequired = artifactFiles.filter((file) => file.required && !fs.existsSync(file.source));
if (missingRequired.length > 0) {
  console.error(
    'Required build artifacts not found:',
    missingRequired.map((item) => item.source).join(', ')
  );
  process.exitCode = 1;
} else {
  let copiedCount = 0;

  for (const target of targets) {
    fs.mkdirSync(target.dirPath, { recursive: true });
    markForHotReload(target.dirPath);

    for (const file of artifactFiles) {
      if (!fs.existsSync(file.source)) continue;
      fs.copyFileSync(file.source, path.join(target.dirPath, file.targetName));
    }

    copiedCount += 1;
    console.log(`Copied plugin artifacts to ${target.label}`);
  }

  if (copiedCount === 0) {
    console.log('No local vault targets detected; skipping postbuild copy');
  }
}
