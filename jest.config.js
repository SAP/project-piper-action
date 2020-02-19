// https://jestjs.io/docs/en/configuration.html
module.exports = {
  clearMocks: true,
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: [ "text" ],
  reporters: [ "default" ],
  testEnvironment: "node",
  verbose: true,
};
