require('dotenv').config();
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const fastifyView = require('@fastify/view');
const path = require('path');
const handlebars = require('handlebars');
const fetch = require('node-fetch');
const CryptoJS = require('crypto-js');

const fastify = Fastify({ logger: true });

// Serve static files like CSS
fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/', // optional: default '/'
});

// Set up view engine with Handlebars
fastify.register(fastifyView, {
  engine: {
    handlebars,
  },
  root: path.join(__dirname, 'src/pages'),
  layout: false,
});

// Helper function to create Binance API signature
function createSignature(queryString, secret) {
  return CryptoJS.HmacSHA256(queryString, secret).toString(CryptoJS.enc.Hex);
}

// Define your route
fastify.get('/', async (request, reply) => {
  const API_KEY = process.env.BINANCE_API_KEY;
  const API_SECRET = process.env.BINANCE_API_SECRET;
  const BASE_URL = 'https://testnet.binance.vision';
  
  const COINS = ['AI', 'BTC', 'MANA', 'USDT'];
  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}`;
  const signature = createSignature(queryString, API_SECRET);
  
  try {
    const response = await fetch(`${BASE_URL}/api/v3/account?${queryString}&signature=${signature}`, {
      headers: {
        'X-MBX-APIKEY': API_KEY,
      },
    });

    const data = await response.json();

    const relevantBalances = data.balances.filter(balance => COINS.includes(balance.asset));
    const assets = {};
    let totalValue = 0;

    relevantBalances.forEach(balance => {
      const coin = balance.asset;
      const freeAmount = parseFloat(balance.free);
      assets[coin] = freeAmount;
      totalValue += coin === 'USDT' ? freeAmount : freeAmount * 1; // Simplified example
    });

    const values = {
      'AI': assets['AI'] || 0,
      'BTC': assets['BTC'] || 0,
      'MANA': assets['MANA'] || 0,
      'USDT': assets['USDT'] || 0,
    };

    reply.view('index.hbs', {
      coins: COINS,
      values,
      total: totalValue.toFixed(2),
    });
  } catch (error) {
    fastify.log.error(error);
    reply.send('Error fetching data');
  }
});

// Start server
fastify.listen({ port: 3000, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`Server running at ${address}`);
});
