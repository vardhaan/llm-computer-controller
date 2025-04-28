const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

const commonConfig = {
  mode: process.env.NODE_ENV || 'development',
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.(js|ts|tsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader'
        }
      }
    ]
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js']
  }
};

const mainConfig = {
  name: 'main',
  ...commonConfig,
  target: 'electron-main',
  entry: './src/main/index.ts',
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'dist/main')
  }
};

const rendererConfig = {
  name: 'renderer',
  ...commonConfig,
  target: 'web',
  entry: './src/renderer/index.tsx',
  output: {
    filename: 'app.js',
    path: path.resolve(__dirname, 'dist/renderer'),
    globalObject: 'this'
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/renderer/index.html',
      meta: {
        'Content-Security-Policy': {
          'http-equiv': 'Content-Security-Policy',
          content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';"
        }
      }
    }),
    new webpack.DefinePlugin({ global: 'globalThis' })
  ],
  devServer: {
    static: {
      directory: path.join(__dirname, 'dist/renderer')
    },
    port: process.env.DEV_PORT || 9000
  }
};

module.exports = [mainConfig, rendererConfig]; 