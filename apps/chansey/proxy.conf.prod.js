const PROD_API_URL = process.env.PROD_API_URL || 'https://www.cymbit.com';

console.warn('\n⚠️  PRODUCTION DEBUG PROXY ACTIVE');
console.warn(`   Proxying /api → ${PROD_API_URL}`);
console.warn('   Mutations will affect REAL production data!\n');

module.exports = {
  '/api': {
    target: PROD_API_URL,
    secure: true,
    changeOrigin: true,
    // Use Vite's `configure` callback to attach the event handler directly
    // on the http-proxy instance — `onProxyRes` in options is not reliably
    // forwarded by every dev-server implementation.
    configure(proxy) {
      proxy.on('proxyRes', (proxyRes) => {
        const setCookie = proxyRes.headers['set-cookie'];
        if (setCookie) {
          proxyRes.headers['set-cookie'] = setCookie.map((cookie) =>
            cookie.replace(/;\s*Domain=[^;]*/gi, '').replace(/;\s*Secure/gi, '')
          );
        }
      });
    }
  }
};
