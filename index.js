const https = require('https');
const EventEmitter = require('events');
const Parser = require('rss-parser');

class FeedUpdateEmitter extends EventEmitter {}


const FEED_URL = 'https://feeds.livep2000.nl/';

var lastETag = ""

const feedUpdatesEmitter = new FeedUpdateEmitter()
feedUpdatesEmitter.on('check', () => {
    https.request(FEED_URL, {
        method: "HEAD"
    }, (res) => {
        etag = res.headers.etag
        if (lastETag != etag) {
            console.log('has updates, %s != %s', lastETag, etag)
            lastETag = etag
            feedUpdatesEmitter.emit('hasUpdate')
        } else {
            console.log('No updates')
        }
    }).on('error', (e) => {
        console.error(e);
    }).end();
})

feedUpdatesEmitter.on('hasUpdate', () => {
    console.log('Downloading feed')
    https.request(FEED_URL, {
        method: "GET"
    }, (res) => {
        etag = res.headers.etag
        lastETag = etag
        console.log('Downloaded %d bytes', parseInt(res.headers['content-length'], 10))
        var rawData = '';
        res.on('data', (chunk) => {
            rawData += chunk
        })
        res.on('end', () => {
            setImmediate((data) => feedUpdatesEmitter.emit('update', rawData), rawData)
        });
    }).on('error', (e) => {
        console.error(e);
    }).end();
})

feedUpdatesEmitter.on('update', async (data) => {
    let feed = await new Parser({
        customFields: {
            item: [
                ['geo:lat', 'latitude'],
                ['geo:long', 'longitude']
            ]
        }
    }).parseString(data)
    feed.items.reverse().forEach(item => {
        process.nextTick(item => feedUpdatesEmitter.emit('item', item), item)
    })
});

feedUpdatesEmitter.emit('hasUpdate')
checkTimer = setInterval(() => feedUpdatesEmitter.emit('check'), 5 * 1000)

process.on('SIGINT', (sig) => {
    setImmediate(() => clearInterval(checkTimer))
})

process.on('exit', (code) => {
    console.log('Process exit event with code: ', code);
});

var items = new Map()

feedUpdatesEmitter.on('item', item => {
    if (!items.has(item.guid)) {
        items.set(item.guid, item)
        console.log('Received new item %s, total %d', item.guid, items.size)
        process.nextTick(() => feedUpdatesEmitter.emit('eventAdded', item.guid))
    }
})

feedUpdatesEmitter.on('eventAdded', guid => {
    ev = items.get(guid)
    console.log('New event recoreded %s on %s at %s:%s',
        guid, ev.pubDate, ev.latitude || 'X', ev.longitude || 'Y')
})