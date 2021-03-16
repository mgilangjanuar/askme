require('dotenv').config()

const axios = require('axios')
const { htmlToText } = require('html-to-text')
const { JSDOM } = require('jsdom')
const Twit = require('twit')
const klasifikasi = require('klasifikasi-js').default

klasifikasi.build({
  creds: [
    {
      clientId: process.env.BAHASA_CLIENT_ID,
      clientSecret: process.env.BAHASA_CLIENT_SECRET
    }
  ]
}).then(() => {
  const bot = new Twit({
    consumer_key: process.env.TWIT_CONSUMER_KEY,
    consumer_secret: process.env.TWIT_CONSUMER_SECRET,
    access_token: process.env.TWIT_ACCESS_TOKEN,
    access_token_secret: process.env.TWIT_ACCESS_TOKEN_SECRET
  })

  const getSentence = (word, text)  => {
    const sentenceArray = text.replace(/([.?!])\s*(?=[A-Z])/g, "$1|").split("|")
    return sentenceArray.filter(sentence => sentence.includes(word)).map(sentence => sentence.replace(word, `*${word}*`)).map(sentence => `${sentence}`)
  }

  bot.stream('statuses/filter', { track: '@askme_bot' }).on('tweet', tweet => {
    if (tweet.in_reply_to_status_id_str) {
      bot.get(`statuses/show/${tweet.in_reply_to_status_id_str}`, (_, data) => {
        if (data.entities.urls[0]) {
          const url = data.entities.urls[0].expanded_url
          axios.get(url).then(data => {
            // const contexts = htmlToText(data.data)
            let tag = 'body'
            if (url.includes('idntimes.com')) {
              tag = '#article-content'
            } else if (url.includes('money.kompas.com')) {
              tag = '.read__content'
            } else if (url.includes('kumparan.com')) {
              tag = '.StoryRenderer__EditorWrapper-mnwwoh-0'
            } else if (url.includes('merdeka.com')) {
              tag = '.mdk-body-paragraph'
            } else if (url.includes('katadata.co.id')) {
              tag = '.detail-body-wrapper'
            } else if (url.includes('cnnindonesia.com')) {
              tag = '#detikdetailtext'
            }
            let dom = new JSDOM(data.data).window.document.querySelector(tag)
            if (!dom) {
              dom = new JSDOM(data.data).window.document.querySelector('body')
            }
            const contexts = htmlToText(dom.innerHTML)
            Promise.all(contexts.split('\n\n').map(async context => {
              if (context.trim()) {
                try {
                  const data = await klasifikasi.qamodelFind(tweet.text.replace('@askme_bot', '').trim(), context.trim())
                  return data.filter(qa => qa.answer !== '-')
                } catch (error) {
                  console.error(error.response ? error.response.data : error)
                }
                return null
              }
            })).then(data => {
              console.log(data)
              data = data.filter(Boolean).reduce((res, dt) => [...res, ...dt], []).filter(Boolean).sort((a, b) => b.score - a.score)
              for (let i = 0; i < 3; i++) {
                if (data[i]) {
                  const text = `@${tweet.user.screen_name} ${i+1}. ${data[i].answer} (score: ${data[i].score.toFixed(4)})\n\n${getSentence(data[i].answer, data[i].context)}`
                  bot.post('statuses/update', { status: text.slice(0, 277) + `${text.length > 280 ? '...' : ''}`, in_reply_to_status_id: tweet.id_str })
                }
              }
            })
          })
        }
      })
    }
  })
})

