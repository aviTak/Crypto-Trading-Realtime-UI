const path = require("path");
const fastify = require("fastify")({ logger: false });
const fetch = require("node-fetch");
const CryptoJS = require("crypto-js");

const COINS = ['AI', 'BTC', 'MANA', 'USDT']; // Define your coins here

// Setup our static files
fastify.register(require("@fastify/static"), {
  root: path.join(__dirname, "public"),
  prefix: "/", // optional: default '/'
});

// Formbody lets us parse incoming forms
fastify.register(require("@fastify/formbody"));

// View is a templating manager for fastify
fastify.register(require("@fastify/view"), {
  engine: {
    handlebars: require("handlebars"),
  },
});

// Helper function to create Binance API signature
function createSignature(queryString, secret) {
  return CryptoJS.HmacSHA256(queryString, secret).toString(CryptoJS.enc.Hex);
}

// Home page route to fetch and display real-time values

fastify.get("/", async function (request, reply) {
  try {
    const API_KEY = process.env.BINANCE_API_KEY;
    const API_SECRET = process.env.BINANCE_API_SECRET;
    const BASE_URL = 'https://testnet.binance.vision';
  
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = createSignature(queryString, API_SECRET);

    const accountResponse = await fetch(`${BASE_URL}/api/v3/account?${queryString}&signature=${signature}`, {
      headers: {
        'X-MBX-APIKEY': API_KEY,
      },
    });

    if (!accountResponse.ok) {
      throw new Error(`API Error: ${accountResponse.status} - ${accountResponse.statusText}`);
    }

    const accountData = await accountResponse.json();
    const relevantBalances = accountData.balances.filter(balance => COINS.includes(balance.asset));
    
    const assets = {};
    let totalValue = 0;

    for (const coin of COINS) {
      const balance = relevantBalances.find(b => b.asset === coin);
      const quantity = parseFloat(balance ? balance.free : 0);

      let usdtEquivalent = quantity; // Assume 1:1 for USDT itself

      if (coin !== 'USDT') {
        const priceResponse = await fetch(`${BASE_URL}/api/v3/ticker/price?symbol=${coin}USDT`);
        const priceData = await priceResponse.json();
        const price = parseFloat(priceData.price);

        usdtEquivalent = quantity * price;
      }

      assets[coin] = {
        quantity: quantity.toFixed(6),
        usdtEquivalent: usdtEquivalent.toFixed(2)
      };

      totalValue += usdtEquivalent;
    }

    return reply.view("/src/pages/index.hbs", {
      coins: COINS,
      assets: assets,
      totalValue: totalValue.toFixed(2),
    });

  } catch (error) {
    console.error(error);
    return reply.status(500).send('Error fetching data');
  }
});

// Run the server and report out to the logs
fastify.listen(
  { port: process.env.PORT, host: "0.0.0.0" },
  function (err, address) {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Your app is listening on ${address}`);
  }
);
