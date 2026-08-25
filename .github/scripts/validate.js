const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = process.cwd();
console.log('🔍 Starting RSVP Shift CI Validation...');

// 1. Syntax check JS files
const jsFiles = ['settings.js', 'content.js', 'popup.js', 'background.js'];
for (const file of jsFiles) {
  const filePath = path.join(ROOT_DIR, file);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Missing required JS file: ${file}`);
    process.exit(1);
  }
  try {
    execSync(`node --check "${filePath}"`, { stdio: 'pipe' });
    console.log(`  ✓ Syntax check passed: ${file}`);
  } catch (err) {
    console.error(`❌ Syntax error in ${file}:\n`, err.stderr.toString());
    process.exit(1);
  }
}

// 2. Validate manifest.json
const manifestPath = path.join(ROOT_DIR, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('❌ manifest.json missing!');
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`  ✓ Valid JSON: manifest.json (v${manifest.version})`);
} catch (err) {
  console.error('❌ Failed to parse manifest.json as JSON:', err.message);
  process.exit(1);
}

if (manifest.manifest_version !== 3) {
  console.error(`❌ Manifest version must be 3, found: ${manifest.manifest_version}`);
  process.exit(1);
}

// 3. Verify icon paths
if (manifest.icons) {
  for (const [size, iconPath] of Object.entries(manifest.icons)) {
    const fullIconPath = path.join(ROOT_DIR, iconPath);
    if (!fs.existsSync(fullIconPath)) {
      console.error(`❌ Icon file missing for size ${size}: ${iconPath}`);
      process.exit(1);
    }
  }
  console.log('  ✓ All icon assets exist');
}

// 4. Verify popup HTML references
const popupHtmlPath = path.join(ROOT_DIR, 'popup.html');
if (fs.existsSync(popupHtmlPath)) {
  const htmlContent = fs.readFileSync(popupHtmlPath, 'utf8');
  if (!htmlContent.includes('popup.css')) {
    console.error('❌ popup.html missing reference to popup.css');
    process.exit(1);
  }
  if (!htmlContent.includes('popup.js')) {
    console.error('❌ popup.html missing reference to popup.js');
    process.exit(1);
  }
  console.log('  ✓ HTML integrity check passed: popup.html');
}

console.log('\n✅ All CI validation checks passed successfully!');
