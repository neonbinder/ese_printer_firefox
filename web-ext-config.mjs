// Configuration for Mozilla's web-ext tool (https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)
// Usage:
//   npx web-ext lint                          # check the extension for review problems
//   npx web-ext run                           # launch Firefox with the extension loaded
//   npx web-ext build                         # produce an unsigned zip in web-ext-artifacts/
//   npm run sign                              # get a Mozilla-signed .xpi (reads MOZILLA_ISSUER / MOZILLA_SECRET from .env)
export default {
  sourceDir: '.',
  artifactsDir: 'web-ext-artifacts',
  ignoreFiles: [
    'README.md',
    'web-ext-config.mjs',
    'package.json',
    'package-lock.json',
    'node_modules',
    'web-ext-artifacts',
    '.gitignore',
    '.git',
    '.env',
    'scripts',
    // website favicon leftovers that the extension does not use
    'icons/about.txt',
    'icons/site.webmanifest',
    'icons/favicon.ico',
    'icons/apple-touch-icon.png',
    'icons/android-chrome-512x512.png',
    'icons/android-chrome-192x192.png',
  ],
  build: {
    overwriteDest: true,
  },
  run: {
    startUrl: ['https://sportlots.com/s/ui/paid.html'],
  },
};
