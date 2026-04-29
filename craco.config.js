const { AlphaTabWebPackPlugin } = require('@coderline/alphatab-webpack');
const path = require('path');
const express = require('express');

module.exports = {
  webpack: {
    plugins: {
      add: [new AlphaTabWebPackPlugin()],
    },
  },
  devServer: {
    setupMiddlewares: (middlewares, devServer) => {
      // Serve alphatab resources from node_modules in dev mode
      // (webpack plugin only does this during build, not in dev server)
      const alphatab = path.join(__dirname, 'node_modules/@coderline/alphatab/dist');
      devServer.app.use('/soundfont', express.static(path.join(alphatab, 'soundfont')));
      devServer.app.use('/alphatab', express.static(path.join(alphatab, 'alphatab')));
      devServer.app.use('/font', express.static(path.join(alphatab, 'font')));
      return middlewares;
    },
  },
};
