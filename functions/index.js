'use strict'

const https = require('https');
const functions = require('firebase-functions');
const Parser = require('rss-parser');
const util = require('util')
const admin = require('firebase-admin');

const FEED_URL = 'https://feeds.livep2000.nl/';

const getClientIp = req => {
    return (req.headers['x-forwarded-for'] || '').split(',').shift() ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        (req.connection.socket && req.connection.socket.remoteAddress) ||
        '127.0.0.1'
};


const lazy = function (creator) {
    let res = null;
    return function () {
        if (res === null) res = creator.apply(this, arguments);
        return res;
    };
};

const getStorageDb = lazy(() => {
    console.log('Init storage db');
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        databaseURL: 'https://livep2000bot.firebaseio.com'
    });
    return admin.firestore();
});

const writeEtagToStorage = etag => {
    const db = getStorageDb();
    const service = db.collection('service');
    const rssfeed = service.doc('rssfeed');
    rssfeed.set({
        etag: etag
    });
};

exports.checkrssfeed = functions.region('europe-west1').https.onRequest((request, response) => {
    const isLocalEnv = process.env.GCP_PROJECT === undefined;
    const config = functions.config() || {};
    const crontabAuth = config && 'crontab' in config && 'auth' in config.crontab && config.crontab.auth || null;

    if (!isLocalEnv && crontabAuth === null) {
        console.critical('Authentication is not set. All requests are rejected');
        response.status(401).send('No service')
        return Promise.resolve();
    }

    const auth = request.query['auth'] || null;
    console.debug('Client auth %s', auth)
    if (crontabAuth !== null && (auth === null || auth !== crontabAuth)) {
        console.log('Unauthorized request has been rejected, auth=%s, ip=%s', auth, getClientIp(request))
        response.status(401).send('No service')
        return Promise.resolve();
    }

    console.log('Authorized request from ip=%s', getClientIp(request))

    return new Promise((resolve, reject) => {
        https.request(FEED_URL, {
            method: "HEAD"
        }, (res) => {
            const etag = res.headers.etag
            console.log('Feed ETag %s', etag)
            response.status(200).send(util.format('ETag %s', etag))
            writeEtagToStorage(etag);
            res.on('end', () => resolve())
        }).on('error', (e) => {
            console.error(e);
            response.status(200).send("Failed to get etag")
            res.on('end', () => resolve())
        }).end();
    })
});

async function parseRssFeed(data) {
    console.log('Parse RSS Feed, %d bytes', data.length);
    return await new Parser({
        customFields: {
            item: [
                ['geo:lat', 'latitude'],
                ['geo:long', 'longitude']
            ]
        }
    }).parseString(data);
};

const downloadFeed = (url, resolve, reject) => {
    https.request(url, {
        method: "GET"
    }, (res) => {
        var rawData = '';
        res.on('data', (chunk) => {
            rawData += chunk
        });
        res.on('end', () => resolve(rawData));
    }).on('error', (e) => {
        console.error(e);
        reject(e);
    }).end();
}

exports.onFeedEtagChange = functions.firestore.document('service/rssfeed').onUpdate((change, context) => {
    const etag = change.after.data()['etag'];
    console.log('RSS Feed updated at %s, etag=%s', context.timestamp, etag);

    return new Promise((resolve, reject) => downloadFeed(FEED_URL, resolve, reject))
        .then(async data => {
            const feed = await parseRssFeed(data);
            feed.items.reverse().forEach(item => {
                console.log('Add item %s', item.guid);
            });
        });
});
