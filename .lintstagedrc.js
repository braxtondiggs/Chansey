module.exports = {
  '*.{ts,js,scss,css}': () => ['nx affected --target=lint --uncommitted', 'nx format:write --uncommitted'],
  '*.html': () => ['nx format:write --uncommitted']
};
