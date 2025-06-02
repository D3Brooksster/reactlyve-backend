module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'], // Look for tests in the src directory
  testMatch: [ // Pattern for test files
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)',
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      // diagnostics: {
      //   ignoreCodes: ['TS151001'] // Example: If you have specific TS errors to ignore during test compilation
      // }
    }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
  // Prevent running tests from dist
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  // Setup environment variables for tests
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // Coverage reporting
  // collectCoverage: true,
  // coverageDirectory: "coverage",
  // coverageReporters: ["json", "lcov", "text", "clover"],
  // collectCoverageFrom: [
  //   "src/**/*.{ts,tsx}",
  //   "!src/**/*.d.ts",
  //   "!src/**/index.ts", // Usually, you don't need to test index files that just export
  //   "!src/config/**", // Usually, config files are not tested directly
  //   "!src/entity/**", // If entities are just type definitions
  // ],
  globals: {
    // ts-jest specific options
    // 'ts-jest': {
    //   diagnostics: {
    //     // Do not fail on TS errors during test runs (useful if you want to run tests even if there are type errors)
    //     // warnOnly: true, 
    //   }
    // }
  }
};
