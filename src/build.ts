import fsPromise from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'
import { createFFmpeg } from '@ffmpeg/ffmpeg'
import { marpCli } from '@marp-team/marp-cli'
import puppeteer from 'puppeteer'
import type { Browser } from 'puppeteer'
import { template } from './template'

const settings = {
  fps: 25,
  width: 1280 * 0.2,
  height: 720 * 0.2,
  duration: 0.5,
  wait: 0.75,
} as const

const transitions = [
  'clockwise',
  'counterclockwise',
  'cover',
  'coverflow',
  'cube',
  'cylinder',
  'diamond',
  'drop',
  'explode',
  'fade',
  'fade-out',
  'fall',
  'flip',
  'glow',
  'implode',
  'in-out',
  'iris-in',
  'iris-out',
  'melt',
  'overlap',
  'pivot',
  'pull',
  'push',
  'reveal',
  'rotate',
  'slide',
  'star',
  'swap',
  'swipe',
  'swoosh',
  'wipe',
  'wiper',
  'zoom',
]

// ---

interface CaptureData {
  data: string | null
  timestamp: number
}

const rootDir = path.resolve(__dirname, '..')
const outDir = path.resolve(rootDir, 'out')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const usePuppeteer = async (callback: (browser: Browser) => Promise<void>) => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--test-type', '--enable-blink-features=ViewTransition'],
  })

  try {
    await callback(browser)
  } finally {
    await browser.close()
  }
}

// Generate GIF animation
usePuppeteer(async (browser) => {
  // Prepare output directory
  await fsPromise.mkdir(outDir, { recursive: true })

  // Set up tmp directory
  const tmpDir = await fsPromise.mkdtemp(
    path.join(os.tmpdir(), 'marp-cli-script-transitions-gif')
  )
  const tmpMd = path.resolve(tmpDir, './.transition.md')
  const tmpHtml = path.resolve(tmpDir, './.transition.html')

  try {
    for (const transition of transitions) {
      console.log(
        `########## Generate GIF for ${transition} transition ##########`
      )

      // Generate HTML
      const md = template({ transition: `${transition} ${settings.duration}s` })

      await fsPromise.writeFile(tmpMd, md, { encoding: 'utf8' })
      await marpCli([
        tmpMd,
        '-o',
        tmpHtml,
        '--bespoke.osc=false',
        '--bespoke.transition=true',
      ])

      // Capture GIF animation with Puppeteer
      const captured: CaptureData[] = []
      const page = await browser.newPage()

      try {
        page.setViewport({
          width: 1280,
          height: 720,
          deviceScaleFactor: 1,
        })

        console.log('# Loading HTML...')

        await page.goto(url.pathToFileURL(tmpHtml).toString(), {
          waitUntil: ['domcontentloaded', 'networkidle0'],
        })

        // ---
        console.log('# Warming up...')

        await page.keyboard.press('ArrowRight')
        await sleep(settings.duration * 1000 + 250)

        await page.keyboard.press('ArrowLeft')
        await sleep(settings.duration * 1000 + 250)

        // ---
        console.log('# Capturing screenshot...')

        const cdpClient = await page.target().createCDPSession()
        await cdpClient.send('Page.enable')

        cdpClient.on('Page.screencastFrame', async ({ data, sessionId }) => {
          captured.push({ timestamp: Date.now(), data })
          await cdpClient.send('Page.screencastFrameAck', { sessionId })
        })

        await cdpClient.send('Page.startScreencast', { format: 'png' })
        await sleep(settings.wait * 500)

        await page.keyboard.press('ArrowRight')
        await sleep((settings.duration + settings.wait) * 1000)

        await page.keyboard.press('ArrowLeft')
        await sleep(settings.duration * 1000 + settings.wait * 500)

        await cdpClient.send('Page.stopScreencast')
      } finally {
        await page.close()
      }

      const lastTimestamp = Date.now()
      console.log('# Generating frames...')

      const firstTimestamp = captured[0].timestamp
      const durationMs = lastTimestamp - firstTimestamp
      const frames = Math.floor((durationMs * settings.fps) / 1000)

      const findFrame = (() => {
        const capturedTimestamps = captured.map(({ timestamp }) => timestamp)
        capturedTimestamps.push(Infinity)

        return (timestamp: number) =>
          captured[
            Math.max(0, capturedTimestamps.findIndex((t) => t >= timestamp) - 1)
          ]
      })()

      const ffmpeg = createFFmpeg()
      await ffmpeg.load()

      try {
        for (let frame = 0; frame < frames; frame += 1) {
          const timestamp = firstTimestamp + (1000 * frame) / settings.fps
          const { data } = findFrame(timestamp)

          if (data) {
            const outputLocalPath = `frame-${frame
              .toString()
              .padStart(10, '0')}.png`

            ffmpeg.FS(
              'writeFile',
              outputLocalPath,
              Uint8Array.from(Buffer.from(data, 'base64'))
            )
          }
        }

        console.log('# Generating video...')

        await ffmpeg.run(
          '-framerate',
          settings.fps.toString(),
          '-i',
          'frame-%010d.png',
          '-c:v',
          'copy',
          'raw.mkv'
        )

        console.log('# Generating palette for GIF...')
        const scale = `scale=${settings.width}:${settings.height}:flags=lanczos`

        await ffmpeg.run(
          '-i',
          'raw.mkv',
          '-vf',
          `${scale},palettegen`,
          'palette.png'
        )

        console.log('# Generating animation GIF...')
        await ffmpeg.run(
          '-i',
          'raw.mkv',
          '-i',
          'palette.png',
          '-lavfi',
          `${scale},fps=${settings.fps} [x]; [x][1:v] paletteuse`,
          '-y',
          'animation.gif'
        )

        console.log(`# Outputting to ${transition}.gif...`)
        await fsPromise.writeFile(
          path.resolve(outDir, `${transition}.gif`),
          ffmpeg.FS('readFile', 'animation.gif')
        )
      } finally {
        ffmpeg.exit()
      }

      console.log(`# Done generating GIF for ${transition}.`)
    }
  } finally {
    // Cleaning up
    await fsPromise.rm(tmpDir, { recursive: true, force: true })
  }
})
