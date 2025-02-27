module.exports = (nextConfig = {}) => {
  return Object.assign({}, nextConfig, {
    webpack(config, options) {
      const newOptions = {
        ...options,
        dev: false,
      };

      if (typeof nextConfig.webpack === 'function') {
        return nextConfig.webpack(config, newOptions);
      }

      return config;
    },
  });
};
