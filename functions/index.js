'use strict'

const https = require('https');
const functions = require('firebase-functions');
const parser = require('rss-parser');
const util = require('util')

const FEED_URL = 'https://feeds.livep2000.nl/';

exports.checkrssfeed = functions.https.onRequest((request, response) => {
  return  new Promise((resolve, reject) => {
    https.request(FEED_URL, {
        method: "HEAD"
    }, (res) => {
        const etag = res.headers.etag
        console.log('Feed ETag %s', etag)
        response.status(200).send(util.format('ETag %s', etag))
        res.on('end', () => resolve())
    }).on('error', (e) => {
        console.error(e);
        response.status(200).send("Failed to get etag")
        res.on('end', () => resolve())
    }).end();
  })
});
