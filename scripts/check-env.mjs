/**
 * Pre-build environment variable check.
 * Runs automatically via "prebuild" in package.json before `next build`.
 * Exits with code 1 (aborting the Vercel build) if any REQUIRED var is missing.
 */

const REQUIRED = [
  // Firebase — app cannot connect to Firestore without these
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  // Surf data — wave forecast is broken without StormGlass
  'STORMGLASS_API_KEY',
  // Security — cron endpoint is unprotected without this
  'CRON_SECRET',
];

const OPTIONAL = [
  // Falls back to harmonic tide model — degraded but functional
  'WORLDTIDES_API_KEY',
  // Email notifications — only needed for send-welcome route
  'RESEND_API_KEY',
  // Image uploads — only needed for profile photos
  'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME',
  'NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET',
];

const PLACEHOLDER_RE = /^placeholder$/i;

let failed = false;

console.log('\n── Pre-build environment check ────────────────────────────');

for (const key of REQUIRED) {
  const val = process.env[key];
  if (!val || PLACEHOLDER_RE.test(val)) {
    console.error(`  ❌  REQUIRED: ${key} is ${val === undefined ? 'not set' : '"PLACEHOLDER"'}`);
    failed = true;
  } else {
    console.log(`  ✅  ${key} (${val.length} chars)`);
  }
}

for (const key of OPTIONAL) {
  const val = process.env[key];
  if (!val || PLACEHOLDER_RE.test(val)) {
    console.warn(`  ⚠️   OPTIONAL: ${key} not set — feature will degrade gracefully`);
  } else {
    console.log(`  ✅  ${key} (${val.length} chars)`);
  }
}

if (failed) {
  console.error('\n  🚫  Build aborted — set missing vars in Vercel → Settings → Environment Variables\n');
  process.exit(1);
}

console.log('\n  ✅  All required environment variables are present. Starting build...\n');
