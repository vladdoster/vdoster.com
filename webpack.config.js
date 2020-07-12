var webpack = require('webpack')	
const path = require('path')

module.exports = {
  entry: {
    'rap-diablo.vdoster.com': './rap-diablo.vdoster.com/main.js',
    'files.vdoster.com': './files.vdoster.com/main.js'
  },
  output: {
    path: __dirname,
    filename: "sites/[name]/build/bundle.js"
  },
  plugins: [
    new webpack.ProvidePlugin({
      $: 'jquery',
      jQuery: 'jquery'
    }),
    new HtmlWebpackPlugin({
      inject: false,
      chunks: ['rap-diablo.vdoster.com'],
      filename: 'subdomains/rap-diablo.vdoster.com/build/index.html'
    }),
    new HtmlWebpackPlugin({
      inject: false,
      chunks: ['files.vdoster.com'],
      filename: 'subdomains/files.vdoster.com/build/index.html'
    })
  ]
};
