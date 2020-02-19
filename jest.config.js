// https://jestjs.io/docs/en/configuration.html
module.exports = {
  clearMocks: true,
  coverageDirectory: "coverage",
  coverageReporters: [ "text" ],
  reporters: [ "default" ], //, "jest-junit" ],
  testEnvironment: "node",
  verbose: true,
};
