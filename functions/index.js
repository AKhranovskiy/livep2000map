'use strict'

const https = require('https');
const functions = require('firebase-functions');
const parser = require('rss-parser');
const util = require('util')

const FEED_URL = 'https://feeds.livep2000.nl/';

const getClientIp = req => {
    return (req.headers['x-forwarded-for'] || '').split(',').shift() ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        (req.connection.socket && req.connection.socket.remoteAddress) ||
        '127.0.0.1'
};

exports.checkrssfeed = functions.region('europe-west1').https.onRequest((request, response) => {
    const isLocalEnv = process.env.GCP_PROJECT === undefined;
    const config = functions.config() || {};
    const crontabAuth = config && 'crontab' in config && 'auth' in config.crontab && config.crontab.auth || null;

    if (!isLocalEnv && crontabAuth === null) {
        console.critical('Authentication is not set. All requests are rejected');
        response.status(401).send('No service')
        return;
    }

    const auth = request.query['auth'] || null;
    console.debug('Client auth %s', auth)
    if (crontabAuth !== null && (auth === null || auth !== crontabAuth)) {
        console.log('Unauthorized request has been rejected, auth=%s, ip=%s', auth, getClientIp(request))
        response.status(401).send('No service')
        return;
    }

    console.log('Authorized request from ip=%s', getClientIp(request))
    return new Promise((resolve, reject) => {
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
