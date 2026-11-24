#!/bin/sh
# Build a copy of the app with no folders (every file beside index.html), for uploading
# from a phone, where folder uploads aren't possible.
set -e
rm -rf dist-flat
VITE_FLAT=1 npx vite build
mv dist-flat/art/* dist-flat/ && rmdir dist-flat/art
mv dist-flat/sfx/* dist-flat/ && rmdir dist-flat/sfx
node scripts/gen-sw.mjs dist-flat
