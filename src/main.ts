import * as core from '@actions/core'
import { createReadStream } from 'fs'
import walkSync from 'walk-sync'
import { WebClient } from '@slack/web-api'

async function getChannelId(
  channelName: string,
  slackInstance: WebClient
): Promise<string | undefined> {
  try {
    const result = await slackInstance.conversations.list()

    const channel = result.channels?.find(c => c.name === channelName)
    if (channel) {
      return channel.id
    } else {
      core.setFailed(`Channel '${channelName}' not found.`)
    }
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  } catch (error: any) {
    core.setFailed(`Failed to fetch channel ID: ${error.message}`)
  }
}

async function run(): Promise<void> {
  try {
    const action = core.getInput('action')
    const token = core.getInput('token')
    const channel = core.getInput('channel')
    const author = core.getInput('author')
    const screenshotsDir = core.getInput('screenshots') || 'cypress/screenshots'
    const videosDir = core.getInput('videos') || 'cypress/videos'
    const messageText = core.getInput('message-text')
    const previousMsgThreadId = core.getInput('thread-id') || ''

    core.info(`Action: ${action}`)
    core.info(`Channel: ${channel}`)
    core.info(`Message text: ${messageText}`)
    core.info(`Author: ${author}`)
    core.info(`Screenshots dir: ${screenshotsDir}`)
    core.info(`Videos dir: ${videosDir}`)
    core.info(`Thread ID: ${previousMsgThreadId}`)

    if (!['start', 'upload', 'finish'].includes(action.toLowerCase())) {
      core.setFailed(`Unknown action: ${action}`)
      return
    }

    if (
      ['upload', 'finish'].includes(action.toLowerCase()) &&
      previousMsgThreadId === ''
    ) {
      core.setFailed(`Action: ${action} requires thread-id.`)
      return
    }

    core.info('Initializing slack SDK')
    const slack = new WebClient(token)
    core.info('Slack SDK initialized successfully')

    const channelID = await getChannelId(channel, slack)
    if (!channelID) {
      return
    }

    const githubServerUrl = process.env.GITHUB_SERVER_URL || ''
    const githubRepository = process.env.GITHUB_REPOSITORY || ''
    const githubRunID = process.env.GITHUB_RUN_ID || ''

    if (action === 'start') {
      const result = await slack.chat.postMessage({
        channel: channelID,
        link_names: true,
        attachments: [
          {
            color: '#f2c744',
            blocks: [
              {
                type: 'header',
                text: {
                  type: 'plain_text',
                  text: `:rocket: ${messageText}`,
                  emoji: true
                }
              },
              {
                type: 'section',
                fields: [
                  {
                    type: 'mrkdwn',
                    text: `*Run URL:* <${githubServerUrl}/${githubRepository}/actions/runs/${githubRunID}|Click!>`
                  },
                  {
                    type: 'mrkdwn',
                    text: '*Status:* In progress'
                  },
                  {
                    type: 'mrkdwn',
                    text: `*Author:* @${author}`
                  }
                ]
              }
            ]
          }
        ]
      })
      const threadID = result.ts as string
      core.setOutput('thread-id', threadID)
      return
    } else if (action === 'finish') {
      const runStatus = core.getInput('status') || false
      const statusColor = runStatus === 'success' ? '#64f244' : '#e30d0d'
      const statusIcon = runStatus === 'success' ? ':ok_hand:' : ':poop:'
      await slack.chat.update({
        channel: channelID,
        link_names: true,
        ts: previousMsgThreadId,
        attachments: [
          {
            color: statusColor,
            blocks: [
              {
                type: 'header',
                text: {
                  type: 'plain_text',
                  text: `${statusIcon} ${messageText}`,
                  emoji: true
                }
              },
              {
                type: 'section',
                fields: [
                  {
                    type: 'mrkdwn',
                    text: `*Run URL:* <${githubServerUrl}/${githubRepository}/actions/runs/${githubRunID}|Click!>`
                  },
                  {
                    type: 'mrkdwn',
                    text: `*Status:* ${runStatus}`
                  },
                  {
                    type: 'mrkdwn',
                    text: `*Author:* @${author}`
                  }
                ]
              }
            ]
          }
        ]
      })
      return
    }

    core.info('Checking for videos and/or screenshots from cypress')
    const videos = walkSync(videosDir, { globs: ['**/*.mp4'] })
    const screenshots = walkSync(screenshotsDir, { globs: ['**/*.png'] })

    if (videos.length <= 0 && screenshots.length <= 0) {
      core.info('No videos or screenshots found. Exiting!')
      return
    }

    await slack.chat.postMessage({
      channel: channelID,
      link_names: true,
      thread_ts: previousMsgThreadId,
      text: `@${author} check this out :point_down:`,
      mrkdwn: true
    })

    core.info(
      `Found ${videos.length} videos and ${screenshots.length} screenshots`
    )

    if (screenshots.length > 0) {
      core.info(`Uploading ${screenshots.length} screenshots`)

      await Promise.all(
        screenshots.map(async screenshot => {
          core.info(`Uploading ${screenshot}`)

          await slack.files.upload({
            filename: screenshot,
            file: createReadStream(`${screenshotsDir}/${screenshot}`),
            thread_ts: previousMsgThreadId,
            channels: channelID
          })
        })
      )

      core.info('...done!')
    }

    if (videos.length > 0) {
      core.info(`Uploading ${videos.length} videos`)

      await Promise.all(
        videos.map(async video => {
          core.info(`Uploading ${video}`)

          await slack.files.upload({
            filename: video,
            file: createReadStream(`${videosDir}/${video}`),
            thread_ts: previousMsgThreadId,
            channels: channelID
          })
        })
      )

      core.info('...done!')
    }

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  } catch (error: any) {
    core.setFailed(error.message)
  }
}

run()
