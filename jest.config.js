/** @type {import('jest').Config} */
const shared = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/../test/support/jest-setup.ts'],
};

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    { ...shared, displayName: 'unit', rootDir: 'src', testRegex: '.*\\.spec\\.ts$' },
    { ...shared, displayName: 'e2e', rootDir: 'test', testRegex: '.*\\.e2e-spec\\.ts$' },
  ],
};
