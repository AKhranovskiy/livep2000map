const EventEmitter = require('events');
class FeedUpdateEmitter extends EventEmitter {}

let Parser = require('rss-parser');
let parser = new Parser();

const https = require('https');
const options = {
  hostname: 'feeds.livep2000.nl',
  path: '/',
  method: 'HEAD'
};

var lastETag = ""

const feedUpdatesEmitter = new FeedUpdateEmitter()
feedUpdatesEmitter.on('check', () => {
  emitter = this
  https.request(options, (res) => {
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
  https.get('https://feeds.livep2000.nl/', (res) => {
    etag = res.headers.etag
    lastETag = etag
    console.log('Downloaded %d bytes', parseInt(res.headers['content-length'], 10))
    var rawData = '';
    res.on('data', (chunk) => { rawData += chunk})
    res.on('end', () => {
      setImmediate((data) => feedUpdatesEmitter.emit('update', rawData), rawData)
    });
}).on('error', (e) => {
  console.error(e);
}).end();
})

feedUpdatesEmitter.on('update', (data) => {
  //console.log('All data received, %d bytes', data.length)

  (async () => {
    let feed = await parser.parseString(data)
    console.log(feed.title)
    console.log(feed.items.length)
  })();
});

feedUpdatesEmitter.emit('hasUpdate')
checkTimer = setInterval(() => feedUpdatesEmitter.emit('check'), 5 * 1000)
