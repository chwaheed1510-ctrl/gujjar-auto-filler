const { ProxyAgent } = require('undici');

const url = 'https://ipv4.icanhazip.com';
const client = new ProxyAgent(
  'http://a9ltqZwmcD1J9wqn:eA0OYqC13FvuDrqE@geo.iproyal.com:12321'
);

(async () => {
  const response = await fetch(url, { dispatcher: client })
  console.log(await response.text())
})();