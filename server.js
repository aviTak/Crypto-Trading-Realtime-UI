const path = require('path');
const Fastify = require('fastify');
const fetch = require('node-fetch');
const WebSocket = require('ws');
const CryptoJS = require('crypto-js');
const fastify = Fastify({ logger: false });

// Define the coins you want to track
const COINS = process.env.COINS ? process.env.COINS.split(',') : ['AI', 'BTC', 'MANA', 'USDT'];

// Setup WebSocket Server
const wss = new WebSocket.Server({ noServer: true });

// Serve static files
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/',
});

// Setup Handlebars view engine
fastify.register(require('@fastify/view'), {
  engine: {
    handlebars: require('handlebars'),
  },
});

// Home page route
fastify.get('/', async (request, reply) => {
  const assets = await fetchCurrentData();
  return reply.view('/src/pages/index.hbs', {
    coins: COINS,
    assets: assets.assets,
    totalValue: assets.totalValue.toFixed(2),
  });
});

// Function to fetch the latest prices and balances
async function fetchCurrentData() {
  const API_KEY = process.env.BINANCE_API_KEY;
  const API_SECRET = process.env.BINANCE_API_SECRET;
  const BASE_URL = 'https://testnet.binance.vision';

  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}`;
  const signature = CryptoJS.HmacSHA256(queryString, API_SECRET).toString(CryptoJS.enc.Hex);

  const accountResponse = await fetch(`${BASE_URL}/api/v3/account?${queryString}&signature=${signature}`, {
    headers: {
      'X-MBX-APIKEY': API_KEY,
    },
  });

  const accountData = await accountResponse.json();
  const relevantBalances = accountData.balances.filter(balance => COINS.includes(balance.asset));

  const assets = {};
  let totalValue = 0;

  for (const coin of COINS) {
    const balance = relevantBalances.find(b => b.asset === coin);
    const quantity = parseFloat(balance ? balance.free : 0);

    let usdtEquivalent = quantity;

    if (coin !== 'USDT') {
      const priceResponse = await fetch(`${BASE_URL}/api/v3/ticker/price?symbol=${coin}USDT`);
      const priceData = await priceResponse.json();
      const price = parseFloat(priceData.price);

      usdtEquivalent = quantity * price;
    }

    assets[coin] = {
      quantity: quantity.toFixed(6),
      usdtEquivalent: usdtEquivalent.toFixed(2),
      websocketUrl: process.env.WEBSOCKET_URL
    };

    totalValue += usdtEquivalent;
  }

  return { assets, totalValue };
}

// WebSocket to handle real-time updates
wss.on('connection', (ws) => {
  console.log('Client connected');

  const streams = COINS.map(coin => `${coin.toLowerCase()}usdt@ticker`).join('/');
  const wsBinance = new WebSocket(`wss://stream.binance.com:9443/ws/${streams}`);

  // Handle errors on the WebSocket connection
  wsBinance.on('error', (error) => {
    console.error('WebSocket error:', error.message);
    ws.send(JSON.stringify({ error: 'Error connecting to Binance WebSocket' }));
  });

  wsBinance.on('message', async (data) => {
    const parsedData = JSON.parse(data);
    const coin = parsedData.s.slice(0, -4); // Get the coin symbol from the ticker

    const latestData = await fetchCurrentData();

    ws.send(JSON.stringify({
      coin: coin.toUpperCase(),
      ...latestData.assets[coin.toUpperCase()],
      totalValue: latestData.totalValue.toFixed(2),
    }));
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (wsBinance.readyState === WebSocket.OPEN || wsBinance.readyState === WebSocket.CONNECTING) {
      wsBinance.close();
    }
  });
});

// Run the server and WebSocket server
fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  console.log(`Server running at ${address}`);

  const server = fastify.server;

  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
});
