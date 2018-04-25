import { send, json } from 'micro'
import { router, post } from 'microrouter'
import microCors from 'micro-cors'
import nosniff from 'micro-nosniff'
import ratelimit from 'micro-ratelimit'
import { isEmail } from 'validator'
import Sparkpost from 'sparkpost'
import { compose, curry } from 'ramda'
import sanitizeHtml from 'sanitize-html'

const cors = microCors({
  allowMethods: [`POST`],
  origin: `https://www.gaiama.org`,
})

const Strings = {
  en: {
    subject: `Contact Request`,
  },
  de: {
    subject: `Kontaktanfrage`,
  },
}

const sanitizeHtmlOptions = {
  allowedTags: [],
  allowedAttributes: [],
}

const middlewares = compose(
  nosniff,
  cors,
  curry(ratelimit)({ window: 5000, limit: 1, headers: true })
)

const spark = new Sparkpost()

const handleContactRequest = async (req, res) => {
  try {
    const { email, message: _message, lang: _lang = `en` } = await json(req)

    const lang = sanitizeHtml(`${_lang}`, sanitizeHtmlOptions)
    const message = sanitizeHtml(`${_message}`, sanitizeHtmlOptions)
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
          name: `GaiAma ContactForm`,
          email: process.env.GAIAMA_SPARKPOST_EMAIL,
        },
        reply_to: email,
        subject,
        // html: `<html><body><p>${message}</p></body></html>`,
        text: message,
      },
      recipients: [
        {
          address: {
            name: `GaiAma.org`,
            email: process.env.GAIAMA_CONTACT_EMAIL,
          },
        },
      ],
    })

    return send(res, 200, { msg: `OK` })
  } catch (error) {
    return send(res, 500, { msg: `ERROR`, error })
  }
}

export default router(post(`/`, middlewares(handleContactRequest)))
