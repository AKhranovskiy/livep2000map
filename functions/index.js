'use strict'

const https = require('https');
const functions = require('firebase-functions');
const Parser = require('rss-parser');
const util = require('util')
const admin = require('firebase-admin');
const querystring = require('querystring');

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

const getConfigValue = path => path.split('.').reduce((config, key) => {
    return config && key in config && config[key] || null
}, functions.config());

exports.checkrssfeed = functions.region('europe-west1').https.onRequest((request, response) => {
    const isLocalEnv = process.env.GCP_PROJECT === undefined;
    const crontabAuth = getConfigValue('crontab.auth');

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
}

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

// TODO Add initial events
exports.onFeedEtagChange = functions.region('europe-west1').firestore.document('service/rssfeed').onUpdate((change, context) => {
    const etag = change.after.data()['etag'];
    console.log('RSS Feed updated at %s, etag=%s', context.timestamp, etag);

    return new Promise((resolve, reject) => downloadFeed(FEED_URL, resolve, reject))
        .then(async data => {
            const feed = await parseRssFeed(data);
            let batch = getStorageDb().batch();
            let events = getStorageDb().collection('events');
            const setOpt = {
                merge: true
            };
            feed.items.reverse().forEach(item => {
                batch.set(events.doc(item.guid), item, setOpt);
            });
            return batch.commit();
        }).then(() => {
            console.log('All events are added');
            return Promise.resolve();
        });
});

exports.onNewEventAdded = functions.region('europe-west1').firestore.document('events/{eventGuid}')
    .onWrite((change, context) => {
        console.log('New event added, guid=%s', context.params.eventGuid);
    });

const getTelegramBotApiEndpoint = lazy(() => {
    const token = getConfigValue('telegram.token');
    console.log(functions.config());
    if (token === null) {
        console.error('Telegram Bot token is not set');
        return null;
    }
    return util.format("https://api.telegram.org/bot%s", token);
});

const sendTgMessage = (chatId, text) => {
    const endpoint = getTelegramBotApiEndpoint();
    return endpoint !== null && new Promise((resolve, reject) => {
        const url = util.format("%s/sendMessage?chat_id=%s&text=%s", endpoint, chatId, querystring.escape(text));
        console.debug("TG API call: %s", url);
        https.get(url, res => {
            res.on('end', resolve);
        }).on('error', (e) => {
            console.error(e);
            reject(e);
        }).end();
    }) || Promise.resolve();
};

exports.telegramBotUpdate = functions.region('europe-west1').https.onRequest((request, response) => {
    response.status(200).end();

    const isTelegramMessage = request.body &&
        request.body.message &&
        request.body.message.chat &&
        request.body.message.chat.id &&
        request.body.message.from &&
        request.body.message.from.id;

    if (!isTelegramMessage) {
        console.error("Invalid request");
        console.dir(request.body);
        return Promise.reject();
    }

    const location = request.body.message.location;
    if (location) {
        console.log("Requested updates for location %s:%s", location.latitude, location.longitude);
    }

    return Promise.resolve();
    //const msg = util.format("Message from %s/%s: %s", request.body.message.chat.id, request.body.message.from.first_name,
    //request.body.message.text);

    //console.log("Tg message: %s", msg);
    //return sendTgMessage(request.body.message.chat.id, msg);
});
