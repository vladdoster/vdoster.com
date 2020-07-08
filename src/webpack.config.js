var webpack = require('webpack')
const path = require('path')
module.exports = {
  entry: {
    'files-vdoster.js': [
      path.resolve(__dirname, 'files-vdoster.js')
    ]
  },
  output: {
    filename: 'files-vdoster.js',
    path: path.resolve(__dirname, '../public')
  },
  plugins: [
    new webpack.ProvidePlugin({
      $: 'jquery',
      jQuery: 'jquery'
    })
  ]
}
