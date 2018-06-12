import { send, json } from 'micro'
import { router, post } from 'microrouter'
import microCors from 'micro-cors'
import nosniff from 'micro-nosniff'
import ratelimit from 'micro-ratelimit'
import contentType from 'content-type'
import { isEmail } from 'validator'
import Autolinker from 'autolinker'
import Sparkpost from 'sparkpost'
import { compose, curry, trim } from 'ramda'
import sanitizeHtml from 'sanitize-html'
import urlEncodedParse from 'urlencoded-body-parser'

const isProduction = process.env.NODE_ENV === `production`

const Strings = {
  en: {
    subject: `Contact Request`,
  },
  de: {
    subject: `Kontaktanfrage`,
  },
}

const sanitizeText = compose(
  str =>
    sanitizeHtml(str, {
      allowedTags: [],
      allowedAttributes: [],
    }),
  trim
)

// preserve <3 and ensure
// sanitize-html won't strip everything behind <3
// preserve line breaks
// auto link urls, truncated to 32 chars
const sanitizeMessage = compose(
  str => Autolinker.link(str, { truncate: { length: 60, location: `smart` } }),
  str => str.replace(/(\r\n|\n\r|\r|\n)/g, `<br>`),
  str => str.replace(/&lt;3/g, `♡`),
  sanitizeText,
  str => str.replace(/<3/g, `&lt;3`)
)

const middlewares = compose(
  nosniff,
  microCors({
    allowMethods: [`OPTIONS`, `POST`],
    origin: isProduction ? process.env.ENDPOINT_CORS_ORIGIN : `*`,
  }),
  curry(ratelimit)({ window: 10000, limit: 2, headers: true })
)

const spark = new Sparkpost()

const parser = {
  'application/json': json,
  'application/x-www-form-urlencoded': urlEncodedParse,
}

const handleContactRequest = async (req, res) => {
  const { type = `application/json` } = contentType.parse(req)

  try {
    const { email, message: _message, lang: _lang = `en` } = await parser[type](
      req
    )

    const lang = sanitizeText(`${_lang}`)
    const message = sanitizeMessage(`${_message}`)
    const { subject } = Strings[lang]

    if (!isEmail(email)) {
      return send(res, 400, { msg: `MALFORMED_EMAIL` })
    }

    if (!message) {
      return send(res, 400, { msg: `MALFORMED_MESSAGE` })
    }

    await spark.transmissions.send({
      options: {
        open_tracking: false,
        click_tracking: false,
      },
      content: {
        from: {
          name: process.env.ENDPOINT_CONTACT_NAME,
          email: process.env.ENDPOINT_SPARKPOST_EMAIL,
        },
        reply_to: email,
        subject,
        text: message,
        html: message,
      },
      recipients: [
        {
          address: {
            name: process.env.ENDPOINT_CONTACT_NAME,
            email: process.env.ENDPOINT_CONTACT_EMAIL,
          },
        },
      ],
    })

    return send(res, 200, { msg: `OK` })
  } catch (error) {
    return send(res, 500, { msg: `ERROR`, error })
  }
}

export default middlewares(router(post(`/`, handleContactRequest)))
