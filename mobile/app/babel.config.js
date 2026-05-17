module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // react-native-worklets-core: required by vision-camera Frame Processors
      // and vision-camera-plugin-inatvision. Must be listed BEFORE
      // reanimated's plugin if both are present (reanimated is added by
      // babel-preset-expo automatically). Currently we don't run reanimated
      // worklets in the same file as inat frame processors, so order is
      // not yet a concern — flag if that changes.
      'react-native-worklets-core/plugin',
    ],
  };
};
