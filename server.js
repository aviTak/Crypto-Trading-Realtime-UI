require('dotenv').config(); // Load environment variables

const path = require('path');
const Fastify = require('fastify');
const fetch = require('node-fetch');
const WebSocket = require('ws');
const CryptoJS = require('crypto-js');
const Bottleneck = require('bottleneck');
const fastify = Fastify({ logger: false });

// Define the coins you want to track
const COINS = process.env.COINS ? process.env.COINS.split(',') : ['AI', 'BTC', 'MANA', 'USDT'];

// General request limiter for APIs that fall under REQUEST_WEIGHT
const generalRequestLimiter = new Bottleneck({
  reservoir: 6000, // 6000 weight units per minute
  reservoirRefreshAmount: 6000, // Refill 6000 units every minute
  reservoirRefreshInterval: 60 * 1000, // Refill every 60 seconds
  minTime: 10 // Minimum time between requests (10ms per request)
});

// Raw requests limiter
const rawRequestLimiter = new Bottleneck({
  reservoir: 61000, // Allow 61,000 requests per 5 minutes
  reservoirRefreshAmount: 61000, // Refill 61,000 requests
  reservoirRefreshInterval: 5 * 60 * 1000, // Refill every 5 minutes
  minTime: 5 // Minimum time between requests (5ms per request)
});

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
    totalValue: assets.totalValue.toFixed(2)
  });
});

// Function to fetch the latest prices and balances
async function fetchCurrentData() {
  try {
    const API_KEY = process.env.BINANCE_API_KEY;
    const API_SECRET = process.env.BINANCE_API_SECRET;
    const BASE_URL = process.env.BASE_URL;

    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = CryptoJS.HmacSHA256(queryString, API_SECRET).toString(CryptoJS.enc.Hex);

    const accountResponse = await generalRequestLimiter.schedule({ weight: 10 }, () =>
      rawRequestLimiter.schedule({ weight: 10 }, () =>
        fetch(`${BASE_URL}/api/v3/account?${queryString}&signature=${signature}`, {
          headers: {
            'X-MBX-APIKEY': API_KEY,
          }
        })
      )
    );

    if (!accountResponse.ok) {
      throw new Error(`API Error: ${accountResponse.statusText}`);
    }

    const accountData = await accountResponse.json();
    const relevantBalances = accountData.balances.filter(balance => COINS.includes(balance.asset));

    const assets = {};
    let totalValue = 0;

    for (const coin of COINS) {
      const balance = relevantBalances.find(b => b.asset === coin);
      const quantity = parseFloat(balance ? balance.free : 0);

      let usdtEquivalent = quantity;

      if (coin !== 'USDT') {
        const priceResponse = await generalRequestLimiter.schedule({ weight: 1 }, () =>
          rawRequestLimiter.schedule({ weight: 1 }, () =>
            fetch(`${BASE_URL}/api/v3/ticker/price?symbol=${coin}USDT`)
          )
        );

        if (!priceResponse.ok) {
          throw new Error(`Price API Error: ${priceResponse.statusText}`);
        }
        const priceData = await priceResponse.json();
        const price = parseFloat(priceData.price);

        usdtEquivalent = quantity * price;
      }

      assets[coin] = {
        quantity: quantity.toFixed(6),
        usdtEquivalent: usdtEquivalent.toFixed(2),
      };

      totalValue += usdtEquivalent;
    }

    return { assets, totalValue };

  } catch (error) {
    console.error('Error fetching current data:', error);
    throw error; // Re-throw to handle elsewhere if needed
  }
}

wss.on('connection', (ws) => {
  console.log('Client connected');

  // Dynamically construct streams for the coins you're tracking, excluding USDT
  const streams = COINS.filter(coin => coin !== 'USDT')
      .map(coin => `${coin.toLowerCase()}usdt@ticker`)
      .join('/');
  const binanceUrl = `wss://stream.binance.com:9443/ws/${streams}`;
  console.log(`Connecting to Binance WebSocket: ${binanceUrl}`);

  const wsBinance = new WebSocket(binanceUrl);

  wsBinance.on('open', () => {
    console.log('Connected to Binance WebSocket');
  });

  wsBinance.on('error', (error) => {
    console.error('WebSocket error:', error.message);
    ws.send(JSON.stringify({ error: 'Error connecting to Binance WebSocket' }));
  });

  wsBinance.on('close', (code, reason) => {
    console.error('Binance WebSocket closed:', code, reason);
  });

  wsBinance.on('message', async (data) => {
    try {
      const parsedData = JSON.parse(data);
      const coin = parsedData.s.slice(0, -4).toUpperCase(); // Get the coin symbol from the ticker

      console.log('Received data from Binance:', parsedData);

      // Fetch the latest data including all coins
      const latestData = await fetchCurrentData();

      // Send data back to the connected client for the specific coin
      ws.send(JSON.stringify({
        coin: coin,
        ...latestData.assets[coin],
        totalValue: latestData.totalValue.toFixed(2),
      }));

      // If any coin's balance changed, ensure it's sent to the client
      for (const updatedCoin of COINS) {
        ws.send(JSON.stringify({
          coin: updatedCoin,
          ...latestData.assets[updatedCoin],
          totalValue: latestData.totalValue.toFixed(2),
        }));
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (wsBinance.readyState === WebSocket.OPEN || wsBinance.readyState === WebSocket.CONNECTING) {
      wsBinance.close();
    }
  });
});

fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error('Fastify server error:', err);
    process.exit(1);
  }

  console.log(`Server running at ${address}`);

  const server = fastify.server;

  server.on('upgrade', (request, socket, head) => {
    console.log('WebSocket upgrade request received');  // Logging here to ensure the upgrade request is handled
    wss.handleUpgrade(request, socket, head, (ws) => {
      console.log('Handling WebSocket upgrade'); // Confirm that the upgrade is being handled
      wss.emit('connection', ws, request);
    });
  });
});



