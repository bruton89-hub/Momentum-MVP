const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Required for Firebase v10+ with React Native.
// Without this, Metro misresolves Firebase's package exports
// and the bundle fails silently (white screen).
config.resolver.unstable_enablePackageExports = false;
config.resolver.unstable_conditionNames = [];

module.exports = config;
