const { composePlugins, withNx } = require('@nx/webpack');
const glob = require('glob');

const path = require('path');

module.exports = composePlugins(
  // Default Nx composable plugin
  withNx(),
  // Custom composable plugin
  (config, { options, context }) => {
    // Add migrations as separate entry points so webpack compiles them to JS
    const migrationsPath = path.resolve(__dirname, 'src/migrations');
    const migrationFiles = glob.sync(`${migrationsPath}/*.ts`);

    migrationFiles.forEach((file) => {
      const basename = path.basename(file, '.ts');
      config.entry[`migrations/${basename}`] = file;
    });

    return config;
  }
);
