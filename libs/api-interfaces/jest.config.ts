export default {
  displayName: 'api-interfaces',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json'
      }
    ]
  },
  moduleFileExtensions: ['ts', 'js'],
  coverageDirectory: '../../coverage/libs/api-interfaces',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts']
};
