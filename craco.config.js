const { AlphaTabWebPackPlugin } = require('@coderline/alphatab-webpack');

module.exports = {
  webpack: {
    plugins: {
      add: [new AlphaTabWebPackPlugin()],
    },
  },
};
