const path = require("path");
const fastify = require("fastify")({ logger: false });
const fetch = require("node-fetch");
const CryptoJS = require("crypto-js");

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
